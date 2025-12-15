const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { auth, requireAdmin } = require('../middleware/auth');
const { run, get } = require('../db');
const { sendInvitationEmail } = require('../services/email');
const { serverUrl, INVITE_EXPIRATION_HOURS } = require('../config/env');

const VALID_ROLES = new Set(['user', 'admin']);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildInviteLink(token, req) {
  const base = serverUrl || `${req.protocol}://${req.get('host')}`;
  const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalized}/invite/confirm?token=${encodeURIComponent(token)}`;
}

function formatEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isExpired(invite) {
  if (!invite.expires_at) return true;
  return new Date(invite.expires_at) < new Date();
}

function deriveName(inviteName, providedName, email) {
  if (providedName) return providedName.trim();
  if (inviteName) return inviteName.trim();
  return email.split('@')[0];
}

function ensureRole(role) {
  return VALID_ROLES.has(role) ? role : 'user';
}

function getCurrentTime() {
  return new Date().toISOString();
}

function getExpiration() {
  const ms = INVITE_EXPIRATION_HOURS * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

function registerInvitationRoutes(app) {
  app.post('/invitations', auth, requireAdmin, async (req, res) => {
    const email = formatEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const existingUser = await get('SELECT uuid FROM users WHERE login = ?', [email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }
    const role = ensureRole(req.body?.role);
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = getExpiration();
    const createdAt = getCurrentTime();
    await run(
      `INSERT INTO invitation_tokens
       (token_hash, email, role, name, created_at, expires_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tokenHash, email, role, req.body?.name || null, createdAt, expiresAt, 'pending']
    );
    const inviteLink = buildInviteLink(token, req);
    try {
      await sendInvitationEmail({ to: email, link: inviteLink });
    } catch (emailErr) {
      console.error('Failed to send invitation email', emailErr);
      await run(`DELETE FROM invitation_tokens WHERE token_hash = ?`, [tokenHash]);
      return res.status(500).json({ error: 'Не удалось отправить приглашение' });
    }
    res.status(201).json({ success: true, expires_at: expiresAt });
  });

  app.post('/invitations/confirm', async (req, res) => {
    const token = req.body?.token;
    const password = req.body?.password;
    if (!token || !password) {
      return res.status(400).json({ error: 'token и password обязательны' });
    }
    const tokenHash = hashToken(token);
    const invitation = await get('SELECT * FROM invitation_tokens WHERE token_hash = ?', [tokenHash]);
    if (!invitation) {
      return res.status(400).json({ error: 'Недействительный токен приглашения' });
    }
    if (invitation.status !== 'pending' || isExpired(invitation)) {
      return res.status(410).json({ error: 'Приглашение истекло или уже использовано' });
    }
    const existingUser = await get('SELECT uuid FROM users WHERE login = ?', [invitation.email]);
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь уже зарегистрирован' });
    }
    const uuid = uuidv4();
    const hashed = await bcrypt.hash(password, 10);
    const displayName = deriveName(invitation.name, req.body?.name, invitation.email);
    await run(
      'INSERT INTO users (uuid, name, login, password, avatar, role) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid, displayName, invitation.email, hashed, null, invitation.role]
    );
    await run(
      'UPDATE invitation_tokens SET status = ?, used_at = ? WHERE token_hash = ?',
      ['used', getCurrentTime(), tokenHash]
    );
    res.json({ success: true });
  });
}

module.exports = {
  registerInvitationRoutes,
};

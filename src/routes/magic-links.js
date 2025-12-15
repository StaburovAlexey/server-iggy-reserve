const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { auth, requireAdmin } = require('../middleware/auth');
const { run, get } = require('../db');
const { JWT_SECRET, serverUrl, MAGIC_LINK_TTL_MINUTES } = require('../config/env');
const { sanitizeUser } = require('../utils/users');

const STATUS_PENDING = 'pending';
const STATUS_APPROVED = 'approved';
const ALLOWED_ROLES = new Set(['admin', 'user']);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function stripApiSegment(value) {
  if (!value) return value;
  return value.replace(/\/api\/?$/i, '').replace(/\/+$/u, '');
}

function buildBaseUrl(req) {
  const origin = stripApiSegment(serverUrl) || stripApiSegment(`${req.protocol}://${req.get('host')}`);
  return origin || `${req.protocol}://${req.get('host')}`;
}

function getExpiration() {
  const minutes = Math.max(1, Number(MAGIC_LINK_TTL_MINUTES) || 5);
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function formatEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function ensureRole(value) {
  return ALLOWED_ROLES.has(value) ? value : 'user';
}

function createMagicResponse(token, expiresAt, req) {
  const baseUrl = buildBaseUrl(req);
  const magicLink = `${baseUrl}/magic/confirm?token=${encodeURIComponent(token)}`;
  return {
    token,
    magic_link: magicLink,
    expires_at: expiresAt,
  };
}

function generateJwt(user) {
  return jwt.sign(
    { uuid: user.uuid, role: user.role, login: user.login, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function isExpired(row) {
  if (!row || !row.expires_at) return true;
  return new Date(row.expires_at) < new Date();
}

async function createMagicLink(req, res) {
  const email = formatEmail(req.body?.email);
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const expiresAt = getExpiration();
  await run(
    `INSERT INTO magic_links (token_hash, status, created_at, expires_at, email, role)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tokenHash, STATUS_PENDING, now, expiresAt, email, ensureRole(req.body?.role)]
  );
  return res.status(201).json(createMagicResponse(token, expiresAt, req));
}

async function fetchMagicLink(req, res) {
  const token = req.params.token;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  const tokenHash = hashToken(token);
  const row = await get('SELECT * FROM magic_links WHERE token_hash = ?', [tokenHash]);
  if (!row) {
    return res.status(404).json({ status: 'invalid' });
  }
  if (isExpired(row)) {
    return res.json({ status: 'expired' });
  }
  if (row.status !== STATUS_APPROVED) {
    return res.json({ status: 'pending', expires_at: row.expires_at, email: row.email || null });
  }
  const user = await get('SELECT * FROM users WHERE uuid = ?', [row.user_uuid]);
  if (!user) {
    return res.status(404).json({ status: 'invalid' });
  }
  const authToken = generateJwt(user);
  await run('DELETE FROM magic_links WHERE token_hash = ?', [tokenHash]);
  return res.json({
    status: 'approved',
    token: authToken,
    user: sanitizeUser(user),
    expires_at: row.expires_at,
  });
}

async function confirmMagicLink(req, res) {
  const token = req.params.token;
  const email = formatEmail(req.body?.email);
  const password = req.body?.password;
  const name = req.body?.name;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const tokenHash = hashToken(token);
  const row = await get('SELECT * FROM magic_links WHERE token_hash = ?', [tokenHash]);
  if (!row) {
    return res.status(404).json({ error: 'Magic link not found' });
  }
  if (row.email && row.email !== email) {
    return res.status(400).json({ error: 'Email does not match the magic link' });
  }
  if (row.status === STATUS_APPROVED && row.user_uuid) {
    const existing = await get('SELECT * FROM users WHERE uuid = ?', [row.user_uuid]);
    if (existing) {
      const authToken = generateJwt(existing);
      return res.status(200).json({ success: true, token: authToken, user: sanitizeUser(existing) });
    }
    return res.status(200).json({ success: true });
  }
  if (isExpired(row)) {
    return res.status(410).json({ error: 'Magic link has expired' });
  }
  const hashed = await bcrypt.hash(password, 10);
  let user = await get('SELECT * FROM users WHERE login = ?', [email]);
  if (user) {
    const displayName = name?.trim() || user.name;
    await run(
      'UPDATE users SET password = ?, name = ? WHERE uuid = ?',
      [hashed, displayName, user.uuid]
    );
    user = await get('SELECT * FROM users WHERE uuid = ?', [user.uuid]);
  } else {
    const uuid = uuidv4();
    const displayName = name?.trim() || email.split('@')[0];
    await run(
      'INSERT INTO users (uuid, name, login, password, avatar, role) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid, displayName, email, hashed, null, row.role || 'user']
    );
    user = await get('SELECT * FROM users WHERE uuid = ?', [uuid]);
  }
  const now = new Date().toISOString();
  await run(
    `UPDATE magic_links SET status = ?, user_uuid = ?, approved_at = ? WHERE token_hash = ?`,
    [STATUS_APPROVED, user.uuid, now, tokenHash]
  );
  const authToken = generateJwt(user);
  return res.json({ success: true, token: authToken, user: sanitizeUser(user) });
}

function registerMagicLinkRoutes(app) {
  app.post('/magic-links', auth, requireAdmin, createMagicLink);
  app.get('/magic-links/:token', fetchMagicLink);
  app.post('/magic-links/:token/confirm', confirmMagicLink);
}

module.exports = {
  registerMagicLinkRoutes,
};

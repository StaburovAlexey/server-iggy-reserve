const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { auth } = require('../middleware/auth');
const { run, get } = require('../db');
const { JWT_SECRET, serverUrl, MAGIC_LINK_TTL_MINUTES } = require('../config/env');
const { sanitizeUser } = require('../utils/users');

const STATUS_PENDING = 'pending';
const STATUS_APPROVED = 'approved';

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

function createMagicResponse(token, expiresAt, req) {
  const baseUrl = buildBaseUrl(req);
  const magicLink = `${baseUrl}/magic/confirm?token=${encodeURIComponent(token)}`;
  return {
    token,
    magic_link: magicLink,
    expires_at: expiresAt,
  };
}

async function createMagicLink(req, res) {
  const token = crypto.randomBytes(20).toString('hex');
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();
  const expiresAt = getExpiration();
  await run(
    `INSERT INTO magic_links (token_hash, status, created_at, expires_at)
     VALUES (?, ?, ?, ?)`,
    [tokenHash, STATUS_PENDING, now, expiresAt]
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
    return res.json({ status: 'pending', expires_at: row.expires_at });
  }
  const user = await get('SELECT * FROM users WHERE uuid = ?', [row.user_uuid]);
  if (!user) {
    return res.status(404).json({ status: 'invalid' });
  }
  const authToken = generateJwt(user);
  return res.json({
    status: 'approved',
    token: authToken,
    user: sanitizeUser(user),
    expires_at: row.expires_at,
  });
}

async function confirmMagicLink(req, res) {
  const token = req.params.token;
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }
  const tokenHash = hashToken(token);
  const row = await get('SELECT * FROM magic_links WHERE token_hash = ?', [tokenHash]);
  if (!row) {
    return res.status(404).json({ error: 'Magic link not found' });
  }
  if (row.status === STATUS_APPROVED) {
    return res.status(200).json({ success: true });
  }
  if (isExpired(row)) {
    return res.status(410).json({ error: 'Magic link has expired' });
  }
  const now = new Date().toISOString();
  await run(
    `UPDATE magic_links SET status = ?, user_uuid = ?, approved_at = ? WHERE token_hash = ?`,
    [STATUS_APPROVED, req.user.uuid, now, tokenHash]
  );
  return res.json({ success: true });
}

function registerMagicLinkRoutes(app) {
  app.post('/magic-links', createMagicLink);
  app.get('/magic-links/:token', fetchMagicLink);
  app.post('/magic-links/:token/confirm', auth, confirmMagicLink);
}

module.exports = {
  registerMagicLinkRoutes,
};

const crypto = require('crypto');
const { get, run } = require('../db');

const CODE_LENGTH = 6;
const CODE_TTL_MINUTES = 15;

function generateCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

async function createLinkCode() {
  let code;
  // Keep trying until we get a unique code (low chance of collision).
  for (let i = 0; i < 5; i += 1) {
    const candidate = generateCode();
    // eslint-disable-next-line no-await-in-loop
    const existing = await get('SELECT 1 FROM telegram_link_codes WHERE code = ?', [candidate]);
    if (!existing) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    throw new Error('Не удалось сгенерировать код привязки');
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CODE_TTL_MINUTES * 60 * 1000);
  await run(
    'INSERT INTO telegram_link_codes(code, created_at, expires_at, used_at, chat_id) VALUES (?, ?, ?, NULL, NULL)',
    [code, createdAt.toISOString(), expiresAt.toISOString()]
  );

  return { code, expires_at: expiresAt.toISOString() };
}

async function consumeLinkCode(rawCode, chatId) {
  const code = (rawCode || '').trim().toUpperCase();
  if (!code) return { ok: false, error: 'code_required' };

  const record = await get('SELECT code, expires_at, used_at FROM telegram_link_codes WHERE code = ?', [code]);
  if (!record) return { ok: false, error: 'not_found' };

  const now = new Date();
  const expired = record.expires_at && new Date(record.expires_at) < now;
  if (expired) {
    await run('DELETE FROM telegram_link_codes WHERE code = ?', [code]);
    return { ok: false, error: 'expired' };
  }
  if (record.used_at) {
    return { ok: false, error: 'used' };
  }

  const usedAt = now.toISOString();
  const update = await run(
    `UPDATE telegram_link_codes
     SET used_at = ?, chat_id = ?
     WHERE code = ? AND used_at IS NULL AND expires_at >= ?`,
    [usedAt, chatId ? String(chatId) : null, code, usedAt]
  );

  if (!update.changes) {
    return { ok: false, error: 'stale' };
  }

  return { ok: true, code, used_at: usedAt };
}

module.exports = {
  createLinkCode,
  consumeLinkCode,
  CODE_LENGTH,
  CODE_TTL_MINUTES,
};

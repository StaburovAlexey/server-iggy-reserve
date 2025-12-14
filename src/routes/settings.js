const { get, run } = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');
const { encrypt, decrypt } = require('../utils/encryption');
const { createLinkCode, CODE_TTL_MINUTES } = require('../services/link-codes');

function registerSettingsRoutes(app, { botManager }) {
  app.post('/settings/add', auth, requireAdmin, async (req, res) => {
    try {
      const { bot_id, chat_id, admin_chat } = req.body;
      const existing = await get('SELECT * FROM settings WHERE id = 1');
      const updatedBot = bot_id ? encrypt(bot_id) : existing?.bot_id || null;
      const updatedChat = chat_id ? encrypt(chat_id) : existing?.chat_id || null;
      const updatedAdmin = admin_chat ? encrypt(admin_chat) : existing?.admin_chat || null;
      await run('UPDATE settings SET bot_id = ?, chat_id = ?, admin_chat = ? WHERE id = 1', [
        updatedBot,
        updatedChat,
        updatedAdmin,
      ]);
      const response = {
        bot_id: bot_id || (existing?.bot_id ? decrypt(existing.bot_id) : null),
        chat_id: chat_id || (existing?.chat_id ? decrypt(existing.chat_id) : null),
        admin_chat: admin_chat || (existing?.admin_chat ? decrypt(existing.admin_chat) : null),
      };
      await botManager.refresh(response.bot_id, response.admin_chat, response.chat_id);
      return res.json({ settings: response });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/settings/link-code', auth, requireAdmin, async (_req, res) => {
    try {
      const row = await get('SELECT bot_id FROM settings WHERE id = 1');
      const botToken = row?.bot_id ? decrypt(row.bot_id) : null;
      if (!botToken) {
        return res.status(400).json({ error: 'Configure bot_id before creating a link code' });
      }
      const { code, expires_at } = await createLinkCode();
      return res.json({ code, expires_at, ttl_minutes: CODE_TTL_MINUTES });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  app.get('/settings', auth, requireAdmin, async (_req, res) => {
    try {
      const row = await get('SELECT * FROM settings WHERE id = 1');
      const settings = {
        bot_id: row?.bot_id ? decrypt(row.bot_id) : null,
        chat_id: row?.chat_id ? decrypt(row.chat_id) : null,
        admin_chat: row?.admin_chat ? decrypt(row.admin_chat) : null,
      };
      return res.json({ settings });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });
}

module.exports = {
  registerSettingsRoutes,
};

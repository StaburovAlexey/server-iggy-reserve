const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { run } = require('../db');
const { encrypt } = require('../utils/encryption');
const { consumeLinkCode } = require('./link-codes');

class TelegramBotManager {
  constructor() {
    this.bot = null;
    this.token = null;
    this.adminChat = null;
    this.chatId = null;
  }

  async start(token, adminChat, chatId) {
    if (!token) return;
    if (this.bot && this.token === token) {
      this.adminChat = adminChat ? String(adminChat) : this.adminChat;
      this.chatId = chatId ? String(chatId) : this.chatId;
      return;
    }
    if (this.bot) {
      await this.stop();
    }
    this.token = token;
    this.adminChat = adminChat ? String(adminChat) : null;
    this.chatId = chatId ? String(chatId) : null;
    this.bot = new TelegramBot(token, { polling: true });
    this.bot.on('message', async (msg) => {
      try {
        await this.handleMessage(msg);
      } catch (err) {
        console.error('Telegram message handler error', err);
      }
    });
  }

  async stop() {
    if (this.bot) {
      await this.bot.stopPolling();
    }
    this.bot = null;
    this.token = null;
    this.adminChat = null;
    this.chatId = null;
  }

  async refresh(token, adminChat, chatId) {
    if (!token) {
      await this.stop();
      return;
    }
    await this.start(token, adminChat, chatId);
  }

  async sendBackup(filePath, caption) {
    if (!this.bot || !this.adminChat) return;
    try {
      await this.bot.sendDocument(this.adminChat, fs.createReadStream(filePath), {
        caption,
      });
    } catch (err) {
      console.error('Failed to send backup', err);
    }
  }

  async sendMessage(chatId, text) {
    if (!this.bot) {
      console.warn('Skip message: bot is not initialized');
      return;
    }
    const target = chatId || this.chatId || this.adminChat;
    if (!target) {
      console.warn('Skip message: chat_id is not configured');
      return;
    }
    try {
      await this.bot.sendMessage(target, text);
    } catch (err) {
      console.error('Failed to send Telegram message', err);
    }
  }

  async handleMessage(msg) {
    const text = (msg.text || '').trim();
    const [firstToken = ''] = text.split(/\s+/, 1);
    const isLinkCommand = /^\/link(@[A-Za-z0-9_]+)?$/i.test(firstToken);

    if (isLinkCommand) {
      await this.handleLinkCommand(msg);
      return;
    }

    const allowedChats = new Set([this.adminChat, this.chatId].filter(Boolean).map(String));
    if (allowedChats.size > 0 && !allowedChats.has(String(msg.chat.id))) {
      return;
    }
  }

  async handleLinkCommand(msg) {
    const parts = (msg.text || '').trim().split(/\s+/);
    const code = parts[1];

    if (!code) {
      await this.bot.sendMessage(msg.chat.id, 'Send /link <code> from the app to connect this chat.');
      return;
    }

    const result = await consumeLinkCode(code, msg.chat.id);
    if (!result.ok) {
      const errorMessages = {
        expired: 'Link code expired. Generate a new one in the app.',
        used: 'Link code was already used. Generate a new one in the app.',
        not_found: 'Link code is invalid. Check the code and try again.',
        stale: 'Link code is no longer valid. Generate a new one in the app.',
        code_required: 'Link code is required. Send /link <code>.',
      };
      const reply = errorMessages[result.error] || 'Link code is invalid. Generate a new one in the app.';
      await this.bot.sendMessage(msg.chat.id, reply);
      return;
    }

    try {
      await this.saveChatId(msg.chat.id);
      await this.bot.sendMessage(msg.chat.id, 'Chat linked. Notifications will be sent here.');
    } catch (err) {
      console.error('Failed to save chat_id after /link', err);
      await this.bot.sendMessage(msg.chat.id, 'Link code accepted, but saving chat_id failed. Try again.');
    }
  }

  async saveChatId(chatId) {
    this.chatId = String(chatId);
    await run('UPDATE settings SET chat_id = ? WHERE id = 1', [encrypt(this.chatId)]);
  }
}

module.exports = {
  TelegramBotManager,
};

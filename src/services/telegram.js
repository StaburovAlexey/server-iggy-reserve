const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

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
      this.adminChat = adminChat || this.adminChat;
      this.chatId = chatId || this.chatId;
      return;
    }
    if (this.bot) {
      await this.stop();
    }
    this.token = token;
    this.adminChat = adminChat || null;
    this.chatId = chatId || null;
    this.bot = new TelegramBot(token, { polling: true });
    this.bot.on('message', (msg) => {
      const text = (msg.text || '').toLowerCase();
      if (text.includes('привет бот')) {
        this.bot.sendMessage(msg.chat.id, 'О! Привет!');
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
}

module.exports = {
  TelegramBotManager,
};

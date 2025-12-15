const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const { run, all } = require('../db');
const { serverUrl } = require('../config/env');
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
    await this.registerCommands();
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

  async registerCommands() {
    if (!this.bot) return;
    const commands = [{ command: 'booking', description: 'Список броней на сегодня' }];
    try {
      await this.bot.setMyCommands(commands, { scope: { type: 'all_private_chats' } });
      await this.bot.setMyCommands(commands, { scope: { type: 'all_group_chats' } });
    } catch (err) {
      console.error('Не удалось выставить список команд бота', err);
    }
  }

  async handleMessage(msg) {
    const text = (msg.text || '').trim();
    const [firstToken = ''] = text.split(/\s+/, 1);
    const isLinkCommand = /^\/link(@[A-Za-z0-9_]+)?$/i.test(firstToken);
    const isBookingCommand = /^\/booking(@[A-Za-z0-9_]+)?$/i.test(firstToken);

    if (isLinkCommand) {
      await this.handleLinkCommand(msg);
      return;
    }
    if (isBookingCommand) {
      await this.handleBookingCommand(msg);
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
      await this.bot.sendMessage(msg.chat.id, 'Отправьте /link <код> из приложения, чтобы привязать чат.');
      return;
    }

    const result = await consumeLinkCode(code, msg.chat.id);
    if (!result.ok) {
      const errorMessages = {
        expired: 'Код привязки истёк. Сгенерируйте новый в приложении.',
        used: 'Код привязки уже использован. Сгенерируйте новый в приложении.',
        not_found: 'Код привязки недействителен. Проверьте код и попробуйте снова.',
        stale: 'Код привязки больше недействителен. Сгенерируйте новый в приложении.',
        code_required: 'Нужен код привязки. Отправьте /link <код>.',
      };
      const reply = errorMessages[result.error] || 'Код привязки недействителен. Сгенерируйте новый в приложении.';
      await this.bot.sendMessage(msg.chat.id, reply);
      return;
    }

    try {
      await this.saveChatId(msg.chat.id);
      await this.bot.sendMessage(msg.chat.id, 'Чат привязан. Уведомления будут приходить сюда.');
    } catch (err) {
      console.error('Не удалось сохранить chat_id после /link', err);
      await this.bot.sendMessage(
        msg.chat.id,
        'Код принят, но сохранить chat_id не удалось. Попробуйте ещё раз.'
      );
    }
  }

  async saveChatId(chatId) {
    this.chatId = String(chatId);
    await run('UPDATE settings SET chat_id = ? WHERE id = 1', [encrypt(this.chatId)]);
  }

  async handleBookingCommand(msg) {
    const today = new Date();
    const date = new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }).format(today);
    const bookings = await all(
      `SELECT time, date, [table], name, person, phone
       FROM tables
       WHERE date = ?
       ORDER BY time ASC`,
      [date]
    );

    const cleanUrl = serverUrl
    const replyOptions = cleanUrl
      ? {
          reply_markup: {
            inline_keyboard: [[{ text: 'Открыть приложение', url: cleanUrl }]],
          },
        }
      : undefined;

    if (!bookings.length) {
      const parts = [`Брони на сегодня (${date}) отсутствуют.`];
      await this.bot.sendMessage(msg.chat.id, parts.join('\n'), replyOptions);
      return;
    }

    const lines = bookings.map((item, idx) => {
      const time = item.time || '-';
      const name = item.name || '-';
      const phone = item.phone || '-';
      return `${idx + 1}. ${time} | ${name} | ${phone}`;
    });

    const textParts = [`Брони на сегодня (${date}):`, ...lines];
    await this.bot.sendMessage(msg.chat.id, textParts.join('\n'), replyOptions);
  }
}

module.exports = {
  TelegramBotManager,
};

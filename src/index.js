require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const crypto = require('crypto');
const cron = require('node-cron');
const archiver = require('archiver');
const TelegramBot = require('node-telegram-bot-api');
const { init, run, get, all, dbFile } = require('./db');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  throw new Error('ENCRYPTION_KEY must be a 64 char hex string (32 bytes)');
}

const encryptionKeyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');

const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

function extractHostname(value) {
  try {
    return new URL(value).hostname;
  } catch (_) {
    try {
      return new URL(`http://${value}`).hostname;
    } catch (_inner) {
      return value;
    }
  }
}

const corsAllowedList = (process.env.CORS_ALLOWED_IPS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const allowedCorsHosts = new Set(corsAllowedList.map(extractHostname));

if (isProd && allowedCorsHosts.size === 0) {
  throw new Error('CORS_ALLOWED_IPS is required when running in production mode (start:prod)');
}

const corsOptions = isProd
  ? {
      origin: (origin, callback) => {
        if (!origin) {
          return callback(null, true);
        }
        const hostname = extractHostname(origin);
        if (allowedCorsHosts.has(hostname)) {
          return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
      },
    }
  : undefined;

const app = express();
app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));

const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

const backupDir = path.join(__dirname, '..', 'data', 'backups');
fs.mkdirSync(backupDir, { recursive: true });

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKeyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(payload) {
  if (!payload) return null;
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKeyBuffer, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only jpeg and png are allowed'));
    }
    cb(null, true);
  },
});

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

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

const botManager = new TelegramBotManager();

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Login and password are required' });
    }
    const user = await get('SELECT * FROM users WHERE login = ?', [login]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { uuid: user.uuid, role: user.role, login: user.login, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    return res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/registration', auth, requireAdmin, async (req, res) => {
  try {
    const { name, login, password, role = 'user', avatar } = req.body;
    if (!login || !password) {
      return res.status(400).json({ error: 'Login and password are required' });
    }
    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const existing = await get('SELECT 1 FROM users WHERE login = ?', [login]);
    if (existing) {
      return res.status(409).json({ error: 'Login already exists' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const uuid = uuidv4();
    await run(
      'INSERT INTO users(uuid, name, login, password, avatar, role) VALUES (?, ?, ?, ?, ?, ?)',
      [uuid, name || '', login, hashed, avatar || null, role]
    );
    const created = await get('SELECT * FROM users WHERE uuid = ?', [uuid]);
    return res.status(201).json({ user: sanitizeUser(created) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/tables', auth, async (req, res) => {
  try {
    const dateFilter = (req.query.date || req.query.data || '').trim();
    let sql = `
      SELECT t.*, u.uuid AS user_uuid, u.name AS user_name, u.login AS user_login, u.avatar AS user_avatar, u.role AS user_role
      FROM tables t
      LEFT JOIN users u ON t.user_id = u.uuid
    `;
    const params = [];
    if (dateFilter) {
      sql += ' WHERE t.date = ?';
      params.push(dateFilter);
    }
    const rows = await all(sql, params);
    const items = rows.map(
      ({ user_uuid, user_name, user_login, user_avatar, user_role, ...table }) => ({
        ...table,
        user: user_uuid
          ? { uuid: user_uuid, name: user_name, login: user_login, avatar: user_avatar, role: user_role }
          : null,
      })
    );
    return res.json({ items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/tables/add', auth, async (req, res) => {
  try {
    const { table, name, person, time, phone, date, user_id } = req.body;
    const ownerId = user_id || req.user.uuid;
    const insert = await run(
      'INSERT INTO tables([table], name, person, time, phone, date, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [table || null, name || null, person || null, time || null, phone || null, date || null, ownerId]
    );
    const created = await get('SELECT * FROM tables WHERE id = ?', [insert.id]);
    const notifyText = `Новая бронь: ${created.time || '-'} (${created.date || '-'})
Стол: ${created.table || '-'}
Имя: ${created.name || '-'}
Гостей: ${created.person ?? '-'}
Телефон: ${created.phone || '-'}`;
    await botManager.sendMessage(null, notifyText);
    return res.status(201).json(created);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/tables/delete/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await run('DELETE FROM tables WHERE id = ?', [id]);
    if (!result.changes) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

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

app.post('/upload', auth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const status = err.message.includes('allowed') ? 400 : 413;
      return res.status(status).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }
    const host = process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
    const url = `${host}/uploads/${req.file.filename}`;
    return res.status(201).json({ url });
  });
});

app.put('/users/me', auth, async (req, res) => {
  try {
    const { name, login, password, avatar } = req.body;
    const current = await get('SELECT * FROM users WHERE uuid = ?', [req.user.uuid]);
    if (!current) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (login && login !== current.login) {
      const conflict = await get('SELECT 1 FROM users WHERE login = ?', [login]);
      if (conflict) {
        return res.status(409).json({ error: 'Login already exists' });
      }
    }
    let newPasswordHash = current.password;
    if (password) {
      newPasswordHash = await bcrypt.hash(password, 10);
    }
    await run(
      'UPDATE users SET name = ?, login = ?, password = ?, avatar = ? WHERE uuid = ?',
      [
        name !== undefined ? name : current.name,
        login !== undefined ? login : current.login,
        newPasswordHash,
        avatar !== undefined ? avatar : current.avatar,
        current.uuid,
      ]
    );
    const updated = await get('SELECT * FROM users WHERE uuid = ?', [current.uuid]);
    return res.json({ user: sanitizeUser(updated) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

async function ensureDefaultAdmin() {
  const login = process.env.ADMIN_LOGIN;
  const password = process.env.ADMIN_PASSWORD;
  if (!login || !password) {
    return;
  }
  const existing = await get('SELECT * FROM users WHERE login = ?', [login]);
  if (existing) return;
  const uuid = uuidv4();
  const hashed = await bcrypt.hash(password, 10);
  await run(
    'INSERT INTO users(uuid, name, login, password, avatar, role) VALUES (?, ?, ?, ?, ?, ?)',
    [uuid, 'Admin', login, hashed, null, 'admin']
  );
  console.log(`Created default admin user ${login}`);
}

function formatTimestampForBackup(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}${pad(date.getSeconds())}`;
}

async function createBackupArchive() {
  const filename = `backup-${formatTimestampForBackup()}.zip`;
  const zipPath = path.join(backupDir, filename);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = fs.createWriteStream(zipPath);

  return new Promise((resolve, reject) => {
    output.on('close', () => resolve(zipPath));
    archive.on('error', (err) => {
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      reject(err);
    });
    archive.pipe(output);

    if (fs.existsSync(dbFile)) {
      archive.file(dbFile, { name: 'database.sqlite' });
    }
    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, 'uploads');
    }

    archive.finalize();
  });
}

async function sendScheduledBackup(reason) {
  if (!botManager.bot || !botManager.adminChat) {
    console.warn('Skip backup: bot token or admin_chat not configured');
    return;
  }
  try {
    const zipPath = await createBackupArchive();
    await botManager.sendBackup(zipPath, reason);
    fs.unlink(zipPath, () => {});
  } catch (err) {
    console.error('Failed to create or send backup', err);
  }
}

function setupBackupSchedule() {
  // Server local time at 00:00 and 08:00 every day
  cron.schedule('0 0,8 * * *', () => {
    sendScheduledBackup('Автобэкап базы и файлов');
  });
}

async function loadBotFromSettings() {
  const row = await get('SELECT * FROM settings WHERE id = 1');
  const botId = row?.bot_id ? decrypt(row.bot_id) : null;
  const adminChat = row?.admin_chat ? decrypt(row.admin_chat) : null;
  const chatId = row?.chat_id ? decrypt(row.chat_id) : null;
  await botManager.refresh(botId, adminChat, chatId);
}

async function start() {
  await init();
  await ensureDefaultAdmin();
  await loadBotFromSettings();
  setupBackupSchedule();
  console.log('[BOOT] NODE_ENV:', process.env.NODE_ENV || '<undefined>');
  console.log('[BOOT] argv:', process.argv.slice(2).join(' ') || '<none>');
  console.log('[BOOT] isProd:', isProd);
  console.log(
    '[BOOT] CORS_ALLOWED_IPS raw:',
    process.env.CORS_ALLOWED_IPS || '<empty>',
    'parsed:',
    Array.from(allowedCorsHosts)
  );
  const corsMode = isProd
    ? `Restricted CORS to hosts: ${Array.from(allowedCorsHosts).join(', ')}`
    : 'CORS open to all origins';
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}. ${corsMode}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});

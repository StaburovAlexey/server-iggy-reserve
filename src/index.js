const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const { init, run, get } = require('./db');
const {
  PORT,
  HTTPS_KEY_PATH,
  HTTPS_CERT_PATH,
  isProd,
  allowedCorsHosts,
  extractHostname,
  serverUrl,
  adminLogin,
  adminPassword,
} = require('./config/env');
const { buildCorsOptions, isOriginAllowed } = require('./config/cors');
const { uploadsDir } = require('./config/paths');
const { decrypt } = require('./utils/encryption');
const { TelegramBotManager } = require('./services/telegram');
const { initSocket, emitSchemaUpdated, emitTableCreated, emitTableDeleted } = require('./services/socket');
const { setupBackupSchedule } = require('./services/backup');
const { registerAuthRoutes } = require('./routes/auth');
const { registerTableRoutes } = require('./routes/tables');
const { registerSchemaRoutes } = require('./routes/schema');
const { registerSettingsRoutes } = require('./routes/settings');
const { registerUploadRoutes } = require('./routes/upload');
const { registerUserRoutes } = require('./routes/users');

const app = express();

if (isProd && allowedCorsHosts.size === 0) {
  throw new Error('CORS_ALLOWED_IPS is required when running in production mode (start:prod)');
}

const originChecker = (origin) => isOriginAllowed(origin, allowedCorsHosts, extractHostname);
const corsOptions = buildCorsOptions({ isProd, allowedCorsHosts, extractHostname });

app.use(cors(corsOptions));
app.use(express.json({ limit: '5mb' }));
app.use('/uploads', express.static(uploadsDir));

const botManager = new TelegramBotManager();

function createServer() {
  if (HTTPS_KEY_PATH || HTTPS_CERT_PATH) {
    if (!HTTPS_KEY_PATH || !HTTPS_CERT_PATH) {
      throw new Error('Both HTTPS_KEY_PATH and HTTPS_CERT_PATH must be set to enable HTTPS');
    }
    const keyPath = path.resolve(HTTPS_KEY_PATH);
    const certPath = path.resolve(HTTPS_CERT_PATH);
    const httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    console.log(`[BOOT] HTTPS enabled with cert: ${certPath}`);
    return https.createServer(httpsOptions, app);
  }
  console.log('[BOOT] HTTPS disabled, using HTTP');
  return http.createServer(app);
}

async function ensureDefaultAdmin() {
  if (!adminLogin || !adminPassword) {
    return;
  }
  const existing = await get('SELECT * FROM users WHERE login = ?', [adminLogin]);
  if (existing) return;
  const uuid = require('uuid').v4();
  const hashed = await bcrypt.hash(adminPassword, 10);
  await run(
    'INSERT INTO users(uuid, name, login, password, avatar, role) VALUES (?, ?, ?, ?, ?, ?)',
    [uuid, 'Admin', adminLogin, hashed, null, 'admin']
  );
  console.log(`Created default admin user ${adminLogin}`);
}

async function loadBotFromSettings() {
  const row = await get('SELECT * FROM settings WHERE id = 1');
  const botId = row?.bot_id ? decrypt(row.bot_id) : null;
  const adminChat = row?.admin_chat ? decrypt(row.admin_chat) : null;
  const chatId = row?.chat_id ? decrypt(row.chat_id) : null;
  await botManager.refresh(botId, adminChat, chatId);
}

function registerRoutes() {
  app.get('/', (_req, res) => {
    res.json({ status: 'ok' });
  });

  registerAuthRoutes(app);
  registerTableRoutes(app, { botManager, emitTableCreated, emitTableDeleted });
  registerSchemaRoutes(app, { emitSchemaUpdated });
  registerSettingsRoutes(app, { botManager });
  registerUploadRoutes(app, serverUrl);
  registerUserRoutes(app);
}

async function start() {
  await init();
  await ensureDefaultAdmin();
  await loadBotFromSettings();
  setupBackupSchedule(botManager);

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

  const server = createServer();
  initSocket(server, { isProd, isOriginAllowed: originChecker });
  registerRoutes();

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}. ${corsMode}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});

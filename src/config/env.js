require('dotenv').config();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH;
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH;
const MAGIC_LINK_TTL_MINUTES = Number(process.env.MAGIC_LINK_TTL_MINUTES) || 5;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  throw new Error('ENCRYPTION_KEY must be a 64 char hex string (32 bytes)');
}

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

module.exports = {
  PORT,
  JWT_SECRET,
  ENCRYPTION_KEY,
  HTTPS_KEY_PATH,
  HTTPS_CERT_PATH,
  isProd,
  extractHostname,
  allowedCorsHosts,
  serverUrl: process.env.SERVER_URL,
  adminLogin: process.env.ADMIN_LOGIN,
  adminPassword: process.env.ADMIN_PASSWORD,
<<<<<<< HEAD
=======
  MAGIC_LINK_TTL_MINUTES,
>>>>>>> dev
};

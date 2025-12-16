const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const cron = require('node-cron');
const { backupDir, uploadsDir } = require('../config/paths');
const { dbFile } = require('../db');

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

function setupBackupSchedule(botManager) {
  // Server local time at 00:00 and 08:00 every day
  cron.schedule('0 0,8 * * *', () => {
    sendScheduledBackup(botManager, 'Автобэкап базы и файлов');
  });
}

async function sendScheduledBackup(botManager, reason) {
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

module.exports = {
  formatTimestampForBackup,
  createBackupArchive,
  setupBackupSchedule,
  sendScheduledBackup,
};

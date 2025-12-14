const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
const backupDir = path.join(__dirname, '..', '..', 'data', 'backups');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

module.exports = {
  uploadsDir,
  backupDir,
};

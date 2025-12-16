const fs = require('fs');
const path = require('path');
const multer = require('multer');
const os = require('os');
const { auth, requireAdmin } = require('../middleware/auth');
const { createBackupArchive, extractDatabaseFromArchive } = require('../services/backup');
const { dbFile, init, closeDatabase, reopenDatabase } = require('../db');

const tmpDir = path.join(os.tmpdir(), 'iggy-backup-imports');
fs.mkdirSync(tmpDir, { recursive: true });

const backupStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^\w.-]/g, '');
    cb(null, `${timestamp}-${sanitized}`);
  },
});

const backupUpload = multer({
  storage: backupStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only zip archives are allowed'));
    }
    cb(null, true);
  },
});

function registerBackupRoutes(app) {
  app.get('/backup/create', auth, requireAdmin, async (_req, res) => {
    try {
      const zipPath = await createBackupArchive();
      res.download(zipPath, path.basename(zipPath), (err) => {
        fs.unlink(zipPath, () => {});
        if (err && !res.headersSent) {
          res.status(500).json({ error: 'Failed to send backup' });
        }
      });
    } catch (err) {
      console.error('Backup creation failed', err);
      res.status(500).json({ error: 'Failed to create backup' });
    }
  });

  app.post('/backup/restore', auth, requireAdmin, (req, res) => {
    backupUpload.single('backup')(req, res, async (err) => {
      if (err) {
        const status = err.message.includes('Only zip') ? 400 : 413;
        return res.status(status).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Backup file is required' });
      }

      const uploadedPath = req.file.path;
      const extractedPath = path.join(tmpDir, `restore-${Date.now()}.sqlite`);
      try {
        await extractDatabaseFromArchive(uploadedPath, extractedPath);
        await closeDatabase();
        fs.copyFileSync(extractedPath, dbFile);
        reopenDatabase();
        await init();
        res.json({ success: true });
      } catch (restoreErr) {
        console.error('Failed to restore backup', restoreErr);
        res.status(500).json({ error: restoreErr.message || 'Failed to restore backup' });
      } finally {
        fs.unlink(uploadedPath, () => {});
        fs.unlink(extractedPath, () => {});
      }
    });
  });
}

module.exports = {
  registerBackupRoutes,
};

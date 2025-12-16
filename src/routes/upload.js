const { upload } = require('../services/upload');
const { auth } = require('../middleware/auth');

function registerUploadRoutes(app, serverUrl) {
  app.post('/upload', auth, (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        const status = err.message.includes('allowed') ? 400 : 413;
        return res.status(status).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'File is required' });
      }
      const host = serverUrl || `${req.protocol}://${req.get('host')}`;
      const url = `${host}/api/uploads/${req.file.filename}`;
      return res.status(201).json({ url });
    });
  });
}

module.exports = {
  registerUploadRoutes,
};

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { get, run } = require('../db');
const { JWT_SECRET } = require('../config/env');
const { auth, requireAdmin } = require('../middleware/auth');
const { sanitizeUser } = require('../utils/users');
const { v4: uuidv4 } = require('uuid');

function registerAuthRoutes(app) {
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
}

module.exports = {
  registerAuthRoutes,
};

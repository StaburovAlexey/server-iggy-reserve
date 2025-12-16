const bcrypt = require('bcryptjs');
const { auth, requireAdmin } = require('../middleware/auth');
const { get, run, all } = require('../db');
const { sanitizeUser } = require('../utils/users');

function registerUserRoutes(app) {
  app.get('/users', auth, requireAdmin, async (_req, res) => {
    try {
      const users = await all('SELECT * FROM users ORDER BY name COLLATE NOCASE');
      return res.json({ users: users.map(sanitizeUser) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
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
}

module.exports = {
  registerUserRoutes,
};

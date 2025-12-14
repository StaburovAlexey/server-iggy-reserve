const express = require('express');
const { all, get, run } = require('../db');
const { auth } = require('../middleware/auth');

function registerTableRoutes(app, { botManager, emitTableCreated, emitTableDeleted }) {
  const router = express.Router();

  router.get('/tables', auth, async (req, res) => {
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

  router.post('/tables/add', auth, async (req, res) => {
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
      emitTableCreated(created);
      return res.status(201).json(created);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  router.delete('/tables/delete/:id', auth, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await run('DELETE FROM tables WHERE id = ?', [id]);
      if (!result.changes) {
        return res.status(404).json({ error: 'Not found' });
      }
      emitTableDeleted(Number(id));
      return res.json({ success: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  app.use(router);
}

module.exports = {
  registerTableRoutes,
};

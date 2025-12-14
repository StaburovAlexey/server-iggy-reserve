const { get, run } = require('../db');
const { auth, requireAdmin } = require('../middleware/auth');

function registerSchemaRoutes(app, { emitSchemaUpdated }) {
  app.get('/schema', auth, requireAdmin, async (_req, res) => {
    try {
      const row = await get('SELECT payload, updated_at FROM schema_store WHERE id = 1');
      if (!row) {
        return res.json({ schema: null, updated_at: null });
      }
      try {
        const parsed = row.payload ? JSON.parse(row.payload) : null;
        return res.json({ schema: parsed, updated_at: row.updated_at });
      } catch (parseErr) {
        console.error('Failed to parse stored schema', parseErr);
        return res.status(500).json({ error: 'Stored schema is invalid' });
      }
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/schema', auth, requireAdmin, async (req, res) => {
    try {
      const { schema } = req.body || {};
      if (schema === undefined) {
        return res.status(400).json({ error: 'Schema is required' });
      }
      let serialized;
      try {
        serialized = JSON.stringify(schema);
      } catch (_) {
        return res.status(400).json({ error: 'Schema must be valid JSON' });
      }
      const updatedAt = new Date().toISOString();
      await run(
        `INSERT INTO schema_store (id, payload, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        [serialized, updatedAt]
      );
      emitSchemaUpdated(schema, updatedAt);
      return res.json({ schema, updated_at: updatedAt });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });
}

module.exports = {
  registerSchemaRoutes,
};

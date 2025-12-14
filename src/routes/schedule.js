const { auth, requireAdmin } = require('../middleware/auth');
const { all, run } = require('../db');

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function padNumber(value) {
  return String(value).padStart(2, '0');
}

function buildMonthRange(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(MONTH_PATTERN);
  if (!match) return null;
  const [year, month] = value.split('-').map((part) => parseInt(part, 10));
  if (!year || !month || month < 1 || month > 12) {
    return null;
  }
  const monthKey = padNumber(month);
  const start = `${year}-${monthKey}-01`;
  const endDay = new Date(year, month, 0).getDate();
  const end = `${year}-${monthKey}-${padNumber(endDay)}`;
  return { start, end };
}

function normalizeGroup(list = []) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item) return null;
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const hasName = Boolean(name);
      const id = item.id ? String(item.id).trim() : '';
      if (!hasName && !id) return null;
      const normalized = {};
      if (id) normalized.id = id;
      if (hasName) normalized.name = name;
      return normalized;
    })
    .filter(Boolean);
}

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch (err) {
      console.warn('Failed to parse schedule payload', err);
      return {};
    }
  }
  return payload;
}

function formatEntry(row) {
  const data = parsePayload(row.payload);
  return {
    date: row.date,
    opening: normalizeGroup(data.opening),
    closing: normalizeGroup(data.closing),
    helpers: normalizeGroup(data.helpers),
  };
}

function registerScheduleRoutes(app) {
  app.get('/schedule', auth, async (req, res) => {
    try {
      const range = buildMonthRange(req.query.month);
      let rows;
      if (range) {
        rows = await all(
          'SELECT date, payload FROM schedule_entries WHERE date BETWEEN ? AND ? ORDER BY date',
          [range.start, range.end]
        );
      } else {
        rows = await all('SELECT date, payload FROM schedule_entries ORDER BY date');
      }
      return res.json({ items: rows.map(formatEntry) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  app.post('/schedule/:date', auth, requireAdmin, async (req, res) => {
    const { date: dateKey } = req.params;
    if (!dateKey || !DATE_PATTERN.test(dateKey)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    try {
      const payload = {
        opening: normalizeGroup(req.body?.opening),
        closing: normalizeGroup(req.body?.closing),
        helpers: normalizeGroup(req.body?.helpers),
      };
      const timestamp = new Date().toISOString();
      await run(
        `INSERT INTO schedule_entries (date, payload, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        [dateKey, JSON.stringify(payload), timestamp]
      );
      return res.json({ date: dateKey, ...payload });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });
}

module.exports = {
  registerScheduleRoutes,
};

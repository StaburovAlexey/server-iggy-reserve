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
      const uuid = extractUuid(item);
      if (!uuid) return null;
      return { uuid };
    })
    .filter(Boolean);
}

function extractUuid(item) {
  if (!item) return null;
  const raw = typeof item === 'string' ? item : item.uuid;
  if (!raw) return null;
  const cleaned = String(raw).trim();
  return cleaned || null;
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

function collectUserIds(rowsWithPayload) {
  const uuids = new Set();
  rowsWithPayload.forEach(({ parsed }) => {
    ['opening', 'closing', 'helpers'].forEach((key) => {
      (parsed?.[key] || []).forEach((item) => {
        const uuid = extractUuid(item);
        if (uuid) uuids.add(uuid);
      });
    });
  });
  return Array.from(uuids);
}

async function buildUserMap(rowsWithPayload) {
  const uuids = collectUserIds(rowsWithPayload);
  if (uuids.length === 0) return new Map();
  const placeholders = uuids.map(() => '?').join(',');
  const users = await all(
    `SELECT uuid, name, login, avatar FROM users WHERE uuid IN (${placeholders})`,
    uuids
  );
  return new Map(users.map((user) => [user.uuid, user]));
}

function mapGroupWithUsers(list = [], userMap) {
  return normalizeGroup(list)
    .map((entry) => {
      const uuid = extractUuid(entry);
      const user = uuid ? userMap.get(uuid) : null;
      const avatar = user?.avatar || null;
      const name = user?.name || null;
      const login = user?.login || null;
      if (!uuid && !name && !login && !avatar) return null;
      return { uuid: uuid || null, name, login, avatar };
    })
    .filter(Boolean);
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
      const rowsWithPayload = rows.map((row) => ({
        date: row.date,
        parsed: parsePayload(row.payload),
      }));
      const userMap = await buildUserMap(rowsWithPayload);
      const items = rowsWithPayload.map((row) => ({
        date: row.date,
        opening: mapGroupWithUsers(row.parsed.opening, userMap),
        closing: mapGroupWithUsers(row.parsed.closing, userMap),
        helpers: mapGroupWithUsers(row.parsed.helpers, userMap),
      }));
      return res.json({ items });
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
      const userMap = await buildUserMap([{ parsed: payload }]);
      return res.json({
        date: dateKey,
        opening: mapGroupWithUsers(payload.opening, userMap),
        closing: mapGroupWithUsers(payload.closing, userMap),
        helpers: mapGroupWithUsers(payload.helpers, userMap),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
  });
}

module.exports = {
  registerScheduleRoutes,
};

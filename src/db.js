const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbFile = path.join(__dirname, '..', 'data', 'database.sqlite');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

const db = new sqlite3.Database(dbFile);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

async function init() {
  await run(
    `CREATE TABLE IF NOT EXISTS users (
      uuid TEXT PRIMARY KEY,
      name TEXT,
      login TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT,
      role TEXT NOT NULL CHECK(role IN ('admin','user'))
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      [table] TEXT,
      name TEXT,
      person INTEGER,
      time TEXT,
      phone TEXT,
      date TEXT,
      user_id TEXT,
      FOREIGN KEY(user_id) REFERENCES users(uuid)
    )`
  );

  await run(
    `CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      bot_id TEXT,
      chat_id TEXT,
      admin_chat TEXT
    )`
  );

  // Ensure admin_chat column exists for older databases.
  const columns = await all(`PRAGMA table_info(settings)`);
  const hasAdminChat = columns.some((col) => col.name === 'admin_chat');
  if (!hasAdminChat) {
    await run(`ALTER TABLE settings ADD COLUMN admin_chat TEXT`);
    await run(`UPDATE settings SET admin_chat = NULL WHERE id = 1`);
  }

  await run(`CREATE INDEX IF NOT EXISTS idx_tables_date ON tables(date)`);
  await run(`INSERT OR IGNORE INTO settings (id, bot_id, chat_id, admin_chat) VALUES (1, NULL, NULL, NULL)`);
}

module.exports = {
  db,
  run,
  get,
  all,
  init,
  dbFile,
};

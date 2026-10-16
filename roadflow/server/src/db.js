import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// One SQLite file. WAL mode lets the web process read while it writes; foreign keys keep sessions tied to users.
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

// Each entry runs once; PRAGMA user_version remembers how many have run.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id          INTEGER PRIMARY KEY,
    tg_id       INTEGER NOT NULL UNIQUE,
    username    TEXT,
    first_name  TEXT,
    last_name   TEXT,
    created_at  INTEGER NOT NULL,
    last_login  INTEGER NOT NULL
  );
  -- A browser session after login. Only the hash of the cookie value is stored.
  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    ip          TEXT,
    ua          TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE INDEX sessions_exp ON sessions(expires_at);
  -- One-time login links: the token goes into the Telegram deep link, the secret stays in the browser that asked.
  CREATE TABLE login_tokens (
    token        TEXT PRIMARY KEY,
    secret_hash  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | confirmed | used
    user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    ip           TEXT
  );
  CREATE INDEX login_tokens_exp ON login_tokens(expires_at);
  -- One row per game session: when it started, how long it ran and where the city stood at the last report.
  CREATE TABLE play_sessions (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL,
    ended_at    INTEGER,
    seconds     INTEGER NOT NULL DEFAULT 0,
    days        INTEGER NOT NULL DEFAULT 0,
    population  INTEGER NOT NULL DEFAULT 0,
    mood        INTEGER NOT NULL DEFAULT 0,
    delivered   INTEGER NOT NULL DEFAULT 0,
    money       INTEGER NOT NULL DEFAULT 0,
    districts   INTEGER NOT NULL DEFAULT 0,
    avg_trip    REAL,
    peak_cars   INTEGER NOT NULL DEFAULT 0,
    peak_pop    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX play_user ON play_sessions(user_id, started_at DESC);
  `,
];

function migrate(db) {
  let v = db.pragma('user_version', { simple: true });
  while (v < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      v++;
      db.pragma(`user_version = ${v}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

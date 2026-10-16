import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDb } from './db.js';

// ---- configuration (see deploy/server.env.example) ----
const cfg = {
  port: Number(process.env.PORT || 3333),
  host: process.env.HOST || '127.0.0.1',
  dbPath: process.env.DB_PATH || path.resolve('data/roadflow.db'),
  botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, ''),
  internalSecret: process.env.INTERNAL_SECRET || '',
  siteOrigin: (process.env.SITE_ORIGIN || 'https://roadflow.ru').replace(/\/$/, ''),
  extraOrigins: (process.env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  cookieSecure: process.env.COOKIE_SECURE !== '0',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  loginTtlSec: Number(process.env.LOGIN_TTL_SEC || 300),
  staticDir: process.env.STATIC_DIR || '',          // only for local development; nginx serves the files in production
};
const COOKIE = 'rf_session';

export function createApp(config = cfg, db = openDb(config.dbPath)) {
  if (config.internalSecret.length < 16) throw new Error('INTERNAL_SECRET must be at least 16 characters');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);                         // one proxy in front: nginx
  const now = () => Math.floor(Date.now() / 1000);
  const sha = s => crypto.createHash('sha256').update(s).digest('hex');
  const rand = n => crypto.randomBytes(n).toString('hex');
  const same = (a, b) => {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const allowedOrigins = new Set([config.siteOrigin, ...config.extraOrigins]);

  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' });
    next();
  });
  app.use(express.json({ limit: '20kb' }));
  app.use(express.text({ type: 'text/plain', limit: '20kb' }));    // navigator.sendBeacon sends text/plain

  // ---- tiny in-memory rate limiter (fixed window per IP and bucket) ----
  const hits = new Map();
  const limit = (bucket, max, windowSec) => (req, res, next) => {
    const key = bucket + '|' + req.ip, t = now(), h = hits.get(key);
    if (!h || h.until <= t) hits.set(key, { n: 1, until: t + windowSec });
    else if (++h.n > max) { res.set('Retry-After', String(h.until - t)); return res.status(429).json({ error: 'too_many_requests' }); }
    next();
  };
  const sweep = setInterval(() => { const t = now(); for (const [k, h] of hits) if (h.until <= t) hits.delete(k); }, 60000);
  sweep.unref();

  // A browser may only change data from our own pages. SameSite=Lax on the cookie is the second line of defence.
  const sameOrigin = (req, res, next) => {
    const o = req.get('origin');
    if (o && !allowedOrigins.has(o)) return res.status(403).json({ error: 'bad_origin' });
    next();
  };

  // ---- sessions ----
  const parseCookies = req => {
    const out = {};
    for (const part of (req.get('cookie') || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  };
  const setCookie = (res, value, maxAge) => {
    let c = `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
    if (config.cookieSecure) c += '; Secure';
    res.append('Set-Cookie', c);
  };
  const q = {
    sessionUser: db.prepare(`SELECT u.*, s.token_hash, s.last_seen AS s_seen, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`),
    touchSession: db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?'),
    newSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    upsertUser: db.prepare(`INSERT INTO users (tg_id, username, first_name, last_name, created_at, last_login) VALUES (@tg_id, @username, @first_name, @last_name, @t, @t)
      ON CONFLICT(tg_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, last_name = excluded.last_name, last_login = excluded.last_login`),
    userByTg: db.prepare('SELECT * FROM users WHERE tg_id = ?'),
    newLogin: db.prepare('INSERT INTO login_tokens (token, secret_hash, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)'),
    getLogin: db.prepare('SELECT * FROM login_tokens WHERE token = ?'),
    confirmLogin: db.prepare(`UPDATE login_tokens SET status = 'confirmed', user_id = ? WHERE token = ? AND status IN ('pending', 'confirmed') AND expires_at > ?`),
    useLogin: db.prepare(`UPDATE login_tokens SET status = 'used' WHERE token = ? AND status = 'confirmed'`),
    stats: db.prepare(`SELECT COUNT(*) AS sessions, COALESCE(SUM(seconds), 0) AS seconds, COALESCE(MAX(peak_pop), 0) AS best_pop,
      COALESCE(MAX(delivered), 0) AS best_delivered, COALESCE(MAX(days), 0) AS best_days FROM play_sessions WHERE user_id = ?`),
    history: db.prepare('SELECT id, started_at, ended_at, seconds, days, population, mood, delivered, districts, peak_pop FROM play_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 20'),
    playStart: db.prepare('INSERT INTO play_sessions (user_id, started_at, last_seen) VALUES (?, ?, ?)'),
    playGet: db.prepare('SELECT * FROM play_sessions WHERE id = ? AND user_id = ?'),
    playUpdate: db.prepare(`UPDATE play_sessions SET last_seen = @t, ended_at = CASE WHEN @end = 1 THEN @t ELSE ended_at END, seconds = @seconds, days = @days, population = @population,
      mood = @mood, delivered = @delivered, money = @money, districts = @districts, avg_trip = @avg_trip, peak_cars = MAX(peak_cars, @peak_cars), peak_pop = MAX(peak_pop, @population) WHERE id = @id`),
    closeOpen: db.prepare('UPDATE play_sessions SET ended_at = last_seen WHERE user_id = ? AND ended_at IS NULL AND last_seen < ?'),
    cleanTokens: db.prepare('DELETE FROM login_tokens WHERE expires_at < ?'),
    cleanSessions: db.prepare('DELETE FROM sessions WHERE expires_at < ?'),
  };

  // Attaches req.user when the cookie belongs to a live session; a used session is extended (sliding expiry).
  const auth = (req, res, next) => {
    const raw = parseCookies(req)[COOKIE];
    if (raw && /^[a-f0-9]{64}$/.test(raw)) {
      const t = now(), row = q.sessionUser.get(sha(raw), t);
      if (row) {
        if (t - row.s_seen > 3600) {
          q.touchSession.run(t, t + config.sessionDays * 86400, row.token_hash);
          setCookie(res, raw, config.sessionDays * 86400);
        }
        req.user = row;
        req.sessionHash = row.token_hash;
      }
    }
    next();
  };
  const need = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'unauthorized' }));
  app.use(auth);
  const publicUser = u => ({ id: u.id, name: u.first_name || u.username || 'Игрок', username: u.username || null });

  // ---- login through the Telegram bot ----
  // 1. The page asks for a login link; the server returns the bot link (token) and a secret that only this browser knows.
  app.post('/api/auth/start', sameOrigin, limit('start', 15, 600), (req, res) => {
    if (!config.botUsername) return res.status(503).json({ error: 'bot_not_configured' });
    const token = rand(24), secret = rand(24), t = now();
    q.newLogin.run(token, sha(secret), t, t + config.loginTtlSec, req.ip);
    res.json({ token, secret, botUrl: `https://t.me/${config.botUsername}?start=${token}`, expiresIn: config.loginTtlSec });
  });
  // 2. The bot reports who pressed Start. Only the bot knows INTERNAL_SECRET and nginx does not expose /internal.
  app.post('/internal/auth/confirm', (req, res) => {
    if (!same(req.get('x-internal-secret') || '', config.internalSecret)) return res.status(403).json({ error: 'forbidden' });
    const b = req.body || {};
    const token = String(b.token || ''), tgId = Number(b.tg_id);
    if (!/^[a-f0-9]{48}$/.test(token) || !Number.isSafeInteger(tgId) || tgId <= 0) return res.status(400).json({ error: 'bad_request' });
    const clean = (s, n) => (s == null ? null : String(s).slice(0, n));
    const row = q.getLogin.get(token), t = now();
    if (!row || row.expires_at <= t || row.status === 'used') return res.status(404).json({ error: 'expired' });
    q.upsertUser.run({ tg_id: tgId, username: clean(b.username, 64), first_name: clean(b.first_name, 64), last_name: clean(b.last_name, 64), t });
    q.confirmLogin.run(q.userByTg.get(tgId).id, token, t);
    res.json({ ok: true });
  });
  // 3. The page polls with token + secret. When the bot has confirmed, the browser gets its session cookie.
  app.get('/api/auth/poll', limit('poll', 150, 60), (req, res) => {
    const token = String(req.query.token || ''), secret = String(req.query.secret || '');
    const row = /^[a-f0-9]{48}$/.test(token) ? q.getLogin.get(token) : null;
    if (!row || !same(row.secret_hash, sha(secret))) return res.status(404).json({ status: 'unknown' });
    const t = now();
    if (row.expires_at <= t || row.status === 'used') return res.json({ status: 'expired' });
    if (row.status !== 'confirmed') return res.json({ status: 'pending' });
    if (!q.useLogin.run(token).changes) return res.json({ status: 'expired' });
    const raw = rand(32);
    q.newSession.run(sha(raw), row.user_id, t, t + config.sessionDays * 86400, t, req.ip, String(req.get('user-agent') || '').slice(0, 200));
    setCookie(res, raw, config.sessionDays * 86400);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    res.json({ status: 'ok', user: publicUser(user) });
  });
  app.post('/api/auth/logout', sameOrigin, (req, res) => {
    if (req.sessionHash) q.delSession.run(req.sessionHash);
    setCookie(res, '', 0);
    res.json({ ok: true });
  });
  // nginx asks this before it serves /play/
  app.get('/api/auth/check', (req, res) => res.status(req.user ? 204 : 401).end());

  app.get('/api/me', need, (req, res) => {
    res.json({ user: publicUser(req.user), stats: q.stats.get(req.user.id), history: q.history.all(req.user.id) });
  });

  // ---- game sessions: the game reports how the city is doing ----
  const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : 0; };
  const body = req => {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
    return b && typeof b === 'object' ? b : {};
  };
  const statsOf = b => ({
    seconds: num(b.seconds, 0, 10 ** 8), days: num(b.days, 0, 10 ** 5), population: num(b.population, 0, 10 ** 7), mood: num(b.mood, 0, 100),
    delivered: num(b.delivered, 0, 10 ** 9), money: num(b.money, -(10 ** 12), 10 ** 12), districts: num(b.districts, 0, 1000),
    avg_trip: Number.isFinite(Number(b.avg_trip)) && b.avg_trip !== null ? Math.min(10 ** 5, Math.max(0, Number(b.avg_trip))) : null,
    peak_cars: num(b.peak_cars, 0, 10 ** 5),
  });
  app.post('/api/play/start', sameOrigin, need, limit('pstart', 30, 600), (req, res) => {
    const t = now();
    q.closeOpen.run(req.user.id, t - 120);                    // sessions the browser never closed
    const id = Number(q.playStart.run(req.user.id, t, t).lastInsertRowid);
    res.json({ id });
  });
  const report = end => (req, res) => {
    const b = body(req), id = Number(b.id);
    if (!Number.isSafeInteger(id) || !q.playGet.get(id, req.user.id)) return res.status(404).json({ error: 'no_session' });
    q.playUpdate.run({ ...statsOf(b), id, t: now(), end: end ? 1 : 0 });
    res.json({ ok: true });
  };
  app.post('/api/play/ping', sameOrigin, need, limit('ping', 60, 60), report(false));
  app.post('/api/play/end', sameOrigin, need, limit('pend', 60, 60), report(true));

  // ---- development helper: serve the built site and guard /play the way nginx does in production ----
  if (config.staticDir) {
    const dir = path.resolve(config.staticDir);
    app.use('/play', (req, res, next) => (req.user ? next() : res.redirect('/#login')));
    app.use(express.static(dir, { setHeaders: r => r.set('Cache-Control', 'no-cache') }));
  }

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((err, req, res, next) => {                           // eslint-disable-line no-unused-vars
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });

  const clean = setInterval(() => { const t = now(); q.cleanTokens.run(t - 3600); q.cleanSessions.run(t); }, 3600 * 1000);
  clean.unref();
  app.close = () => { clearInterval(sweep); clearInterval(clean); db.close(); };
  return app;
}

// started directly (pm2) rather than imported by a test
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const app = createApp();
  const server = app.listen(cfg.port, cfg.host, () => console.log(`roadflow server on http://${cfg.host}:${cfg.port}, db ${cfg.dbPath}`));
  const stop = () => server.close(() => { app.close(); process.exit(0); });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

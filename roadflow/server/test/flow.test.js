import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { openDb } from '../src/db.js';

const SECRET = 'test-internal-secret-0123456789';
function boot(over = {}) {
  const config = { port: 0, host: '127.0.0.1', dbPath: ':memory:', botUsername: 'RoadFlowBot', internalSecret: SECRET, siteOrigin: 'https://roadflow.ru', extraOrigins: [], cookieSecure: true, sessionDays: 30, loginTtlSec: 300, staticDir: '', ...over };
  const app = createApp(config, openDb(':memory:'));
  return new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r({ app, s, base: `http://127.0.0.1:${s.address().port}` })); });
}
const J = { 'content-type': 'application/json', origin: 'https://roadflow.ru' };
const confirm = (base, token, from = { id: 777, first_name: 'Аня', username: 'anya' }) =>
  fetch(base + '/internal/auth/confirm', { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': SECRET }, body: JSON.stringify({ token, tg_id: from.id, ...from }) });
async function login(base) {
  const st = await (await fetch(base + '/api/auth/start', { method: 'POST', headers: J })).json();
  assert.match(st.botUrl, /^https:\/\/t\.me\/RoadFlowBot\?start=[a-f0-9]{48}$/);
  assert.equal((await confirm(base, st.token)).status, 200);
  const res = await fetch(`${base}/api/auth/poll?token=${st.token}&secret=${st.secret}`);
  const body = await res.json();
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { st, body, cookie, setCookie: res.headers.get('set-cookie') };
}

test('login through the bot, session cookie, me, logout', async () => {
  const { app, s, base } = await boot();
  try {
    assert.equal((await fetch(base + '/api/me')).status, 401);
    assert.equal((await fetch(base + '/api/auth/check')).status, 401);
    const st = await (await fetch(base + '/api/auth/start', { method: 'POST', headers: J })).json();
    // not confirmed yet
    assert.equal((await (await fetch(`${base}/api/auth/poll?token=${st.token}&secret=${st.secret}`)).json()).status, 'pending');
    // a wrong secret learns nothing
    assert.equal((await fetch(`${base}/api/auth/poll?token=${st.token}&secret=${'0'.repeat(48)}`)).status, 404);
    assert.equal((await confirm(base, st.token)).status, 200);
    const r = await fetch(`${base}/api/auth/poll?token=${st.token}&secret=${st.secret}`);
    const b = await r.json();
    assert.equal(b.status, 'ok');
    assert.equal(b.user.name, 'Аня');
    const sc = r.headers.get('set-cookie');
    assert.match(sc, /rf_session=[a-f0-9]{64}/);
    assert.match(sc, /HttpOnly/); assert.match(sc, /Secure/); assert.match(sc, /SameSite=Lax/);
    const cookie = sc.split(';')[0];
    const me = await (await fetch(base + '/api/me', { headers: { cookie } })).json();
    assert.equal(me.user.username, 'anya');
    assert.equal((await fetch(base + '/api/auth/check', { headers: { cookie } })).status, 204);
    // the link works once
    assert.equal((await (await fetch(`${base}/api/auth/poll?token=${st.token}&secret=${st.secret}`)).json()).status, 'expired');
    assert.equal((await confirm(base, st.token)).status, 404);
    // logout kills the session
    assert.equal((await fetch(base + '/api/auth/logout', { method: 'POST', headers: { ...J, cookie } })).status, 200);
    assert.equal((await fetch(base + '/api/me', { headers: { cookie } })).status, 401);
  } finally { s.close(); app.close(); }
});

test('internal endpoint needs the secret; foreign origins are refused', async () => {
  const { app, s, base } = await boot();
  try {
    const st = await (await fetch(base + '/api/auth/start', { method: 'POST', headers: J })).json();
    const bad = await fetch(base + '/internal/auth/confirm', { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': 'nope' }, body: JSON.stringify({ token: st.token, tg_id: 1 }) });
    assert.equal(bad.status, 403);
    const evil = await fetch(base + '/api/auth/start', { method: 'POST', headers: { ...J, origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    assert.equal((await confirm(base, 'z'.repeat(48))).status, 400);
    assert.equal((await confirm(base, 'a'.repeat(48))).status, 404);
  } finally { s.close(); app.close(); }
});

test('expired login links are refused', async () => {
  const { app, s, base } = await boot({ loginTtlSec: -5 });
  try {
    const st = await (await fetch(base + '/api/auth/start', { method: 'POST', headers: J })).json();
    assert.equal((await confirm(base, st.token)).status, 404);
    assert.equal((await (await fetch(`${base}/api/auth/poll?token=${st.token}&secret=${st.secret}`)).json()).status, 'expired');
  } finally { s.close(); app.close(); }
});

test('game session: start, ping, end, per-user isolation, beacon format', async () => {
  const { app, s, base } = await boot();
  try {
    assert.equal((await fetch(base + '/api/play/start', { method: 'POST', headers: J })).status, 401);
    const a = await login(base);
    const ha = { ...J, cookie: a.cookie };
    const { id } = await (await fetch(base + '/api/play/start', { method: 'POST', headers: ha })).json();
    assert.ok(id > 0);
    const stats = { id, seconds: 120, days: 1, population: 250, mood: 71, delivered: 40, money: 1500, districts: 5, avg_trip: 22.5, peak_cars: 31 };
    assert.equal((await fetch(base + '/api/play/ping', { method: 'POST', headers: ha, body: JSON.stringify(stats) })).status, 200);
    // sendBeacon posts text/plain with the cookie
    const end = await fetch(base + '/api/play/end', { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://roadflow.ru', cookie: a.cookie }, body: JSON.stringify({ ...stats, population: 300, id }) });
    assert.equal(end.status, 200);
    const me = await (await fetch(base + '/api/me', { headers: { cookie: a.cookie } })).json();
    assert.equal(me.stats.sessions, 1);
    assert.equal(me.stats.best_pop, 300);
    assert.equal(me.history[0].population, 300);
    assert.ok(me.history[0].ended_at);
    // a second player cannot touch the first one's session
    const bPlayer = await (async () => {
      const st = await (await fetch(base + '/api/auth/start', { method: 'POST', headers: J })).json();
      await confirm(base, st.token, { id: 888, first_name: 'Боб' });
      const r = await fetch(`${base}/api/auth/poll?token=${st.token}&secret=${st.secret}`);
      return r.headers.get('set-cookie').split(';')[0];
    })();
    assert.equal((await fetch(base + '/api/play/ping', { method: 'POST', headers: { ...J, cookie: bPlayer }, body: JSON.stringify(stats) })).status, 404);
    // junk values are clamped, not trusted
    assert.equal((await fetch(base + '/api/play/ping', { method: 'POST', headers: ha, body: JSON.stringify({ id, population: 1e30, mood: -50, seconds: 'x' }) })).status, 200);
    const me2 = await (await fetch(base + '/api/me', { headers: { cookie: a.cookie } })).json();
    assert.ok(me2.history[0].population <= 1e7 && me2.history[0].mood === 0 && me2.history[0].seconds === 0);
  } finally { s.close(); app.close(); }
});

test('rate limit on login starts', async () => {
  const { app, s, base } = await boot();
  try {
    let last = 0;
    for (let i = 0; i < 17; i++) last = (await fetch(base + '/api/auth/start', { method: 'POST', headers: J })).status;
    assert.equal(last, 429);
  } finally { s.close(); app.close(); }
});

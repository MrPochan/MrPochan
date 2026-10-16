// Runs the real bot against a fake Telegram API and a real RoadFlow server (in memory).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createApp } from '../../server/src/index.js';
import { openDb } from '../../server/src/db.js';

const SECRET = 'test-internal-secret-0123456789';
test('Start with a login token signs the user in', async () => {
  const config = { port: 0, host: '127.0.0.1', dbPath: ':memory:', botUsername: 'RoadFlowBot', internalSecret: SECRET, siteOrigin: 'https://roadflow.ru', extraOrigins: [], cookieSecure: true, sessionDays: 30, loginTtlSec: 300, staticDir: '' };
  const app = createApp(config, openDb(':memory:'));
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;

  const sent = [];
  let queue = [];
  const fake = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      const method = req.url.split('/').pop(), p = b ? JSON.parse(b) : {};
      const ok = r => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, result: r })); };
      if (method === 'getMe') return ok({ username: 'RoadFlowBot' });
      if (method === 'sendMessage') { sent.push(p); return ok({}); }
      if (method === 'getUpdates') { const q = queue; queue = []; return q.length ? ok(q) : setTimeout(() => ok([]), 200); }
      ok({});
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const bot = spawn(process.execPath, ['index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, BOT_TOKEN: '123:TEST', INTERNAL_SECRET: SECRET, SERVER_URL: base, SITE_URL: 'https://roadflow.ru', TELEGRAM_API: `http://127.0.0.1:${fake.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; bot.stdout.on('data', d => (log += d)); bot.stderr.on('data', d => (log += d));
  try {
    const J = { 'content-type': 'application/json', origin: 'https://roadflow.ru' };
    const st = await (await fetch(base + '/api/auth/start', { method: 'POST', headers: J })).json();
    const from = { id: 4242, first_name: 'Вера', username: 'vera' };
    queue.push({ update_id: 1, message: { chat: { id: 4242, type: 'private' }, from, text: '/start ' + st.token } });
    let status = 'pending';
    for (let i = 0; i < 40 && status === 'pending'; i++) {
      await new Promise(r => setTimeout(r, 150));
      status = (await (await fetch(`${base}/api/auth/poll?token=${st.token}&secret=${st.secret}`)).json()).status;
    }
    assert.equal(status, 'ok', log);
    assert.match(sent[0].text, /Вы вошли в RoadFlow/);
    // an old or invented link gets a friendly answer and signs nobody in
    queue.push({ update_id: 2, message: { chat: { id: 4242, type: 'private' }, from, text: '/start ' + 'a'.repeat(48) } });
    queue.push({ update_id: 3, message: { chat: { id: 4242, type: 'private' }, from, text: '/start' } });
    for (let i = 0; i < 40 && sent.length < 3; i++) await new Promise(r => setTimeout(r, 150));
    assert.match(sent[1].text, /устарела/);
    assert.match(sent[2].text, /Это RoadFlow/);
  } finally { bot.kill(); fake.close(); srv.close(); app.close(); }
});

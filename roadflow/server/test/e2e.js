// End to end in a real browser: landing page login dialog, bot confirmation (simulated), /play guard, game session report.
// Run:  node test/e2e.js   (needs playwright; development only)
import { createRequire } from 'node:module';
import { createApp } from '../src/index.js';
import { openDb } from '../src/db.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const req = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = req('playwright')); } catch { ({ chromium } = req(path.join(process.env.GLOBAL_NODE_MODULES || '', 'playwright'))); }
const SECRET = 'test-internal-secret-0123456789';
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');
const PORT = 3999, BASE = `http://localhost:${PORT}`;
const app = createApp({ port: PORT, host: '127.0.0.1', dbPath: ':memory:', botUsername: 'RoadFlowBot', internalSecret: SECRET, siteOrigin: BASE, extraOrigins: [], cookieSecure: false, sessionDays: 30, loginTtlSec: 300, staticDir: WEB }, openDb(':memory:'));
const srv = await new Promise(r => { const s = app.listen(PORT, '127.0.0.1', () => r(s)); });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
try {
  await page.goto(BASE + '/play/');
  await page.waitForURL(/\/#login/);
  ok(true, '/play/ without login goes to /#login');
  await page.waitForSelector('#auth[open]');
  ok(true, 'login dialog opens by itself');
  await page.click('#aStart');
  await page.waitForSelector('#aOpen:not([hidden])');
  const link = await page.getAttribute('#aOpen', 'href');
  const token = link.split('start=')[1];
  ok(/^[a-f0-9]{48}$/.test(token) && link.startsWith('https://t.me/RoadFlowBot'), 'bot link shown: ' + link.slice(0, 40) + '…');
  const r = await fetch(BASE + '/internal/auth/confirm', { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': SECRET }, body: JSON.stringify({ token, tg_id: 5150, first_name: 'Тест', username: 'tester' }) });
  ok(r.status === 200, 'bot confirms the login');
  await page.waitForSelector('#who:not([hidden])', { timeout: 10000 });
  ok((await page.textContent('#who')) === 'Тест', 'page shows the logged in name');
  await page.goto(BASE + '/play/?online=1');
  await page.waitForFunction(() => document.getElementById('whoami') && /Вы вошли как Тест/.test(document.getElementById('whoami').textContent), null, { timeout: 10000 });
  ok(true, 'game accepts the same login, no second sign-in');
  await page.waitForFunction(() => !document.getElementById('startBtn').disabled);
  await page.click('#startBtn');
  await page.waitForFunction(() => window.trafficArchitect && !window.trafficArchitect.S.demo && window.trafficArchitect.S.running);
  await page.evaluate(() => { const T = window.trafficArchitect; T.S.delivered = 12; T.S.money = 777; for (let i = 0; i < 400; i++) T.step(0.05); });
  await page.waitForTimeout(500);
  await page.goto(BASE + '/');                         // leaving the game sends the final report by beacon
  await page.waitForSelector('#who:not([hidden])');
  await page.waitForTimeout(800);
  const me = await (await page.context().request.get(BASE + '/api/me')).json();
  ok(me.stats.sessions === 1 && me.history[0].delivered === 12 && me.history[0].seconds >= 19 && me.history[0].ended_at, 'session saved on the server: ' + JSON.stringify(me.history[0]));
  await page.click('#logout');
  await page.waitForSelector('#openAuth:not([hidden])');
  await page.goto(BASE + '/play/');
  await page.waitForURL(/\/#login/);
  ok(true, 'after logout /play/ is closed again');
  ok(errors.length === 0, 'no page errors ' + errors.join('|'));
} catch (e) { console.log('FAIL', e.message); process.exitCode = 1; }
await browser.close(); srv.close(); app.close();

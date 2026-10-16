import 'dotenv/config';

// RoadFlow Telegram bot. It only does one job: when someone presses Start on a login link from the site,
// it tells the RoadFlow server who that is. Long polling, no webhook, no extra dependencies.
const TOKEN = process.env.BOT_TOKEN || '';
const SERVER = (process.env.SERVER_URL || 'http://127.0.0.1:3333').replace(/\/$/, '');
const SECRET = process.env.INTERNAL_SECRET || '';
const SITE = (process.env.SITE_URL || 'https://roadflow.ru').replace(/\/$/, '');
const API = `${(process.env.TELEGRAM_API || 'https://api.telegram.org').replace(/\/$/, '')}/bot${TOKEN}`;

if (!TOKEN || SECRET.length < 16) {
  console.error('BOT_TOKEN and INTERNAL_SECRET (16+ characters) must be set in bot/.env');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tg(method, payload, timeoutMs = 15000) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method}: ${res.status} ${data.description || ''}`);
  return data.result;
}
const say = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, ...extra }).catch(e => console.error('sendMessage failed:', e.message));
const siteButton = text => ({ reply_markup: { inline_keyboard: [[{ text, url: SITE }]] } });

async function confirmLogin(token, from) {
  const res = await fetch(`${SERVER}/internal/auth/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': SECRET },
    body: JSON.stringify({ token, tg_id: from.id, username: from.username || null, first_name: from.first_name || null, last_name: from.last_name || null }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return 'expired';
  if (!res.ok) throw new Error(`server answered ${res.status}`);
  return 'ok';
}

async function onMessage(msg) {
  if (!msg || !msg.from || msg.chat.type !== 'private' || typeof msg.text !== 'string') return;
  const m = msg.text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/);
  if (!m) {
    if (/^\/help\b/.test(msg.text)) await say(msg.chat.id, 'Я бот RoadFlow. Чтобы войти в игру, нажмите «Войти» на сайте и откройте ссылку, которую он покажет.', siteButton('Открыть сайт'));
    return;
  }
  const token = m[1];
  if (!token || !/^[a-f0-9]{48}$/.test(token)) {
    await say(msg.chat.id, 'Привет! Это RoadFlow. Чтобы войти в игру, нажмите «Войти» на сайте.', siteButton('Открыть сайт'));
    return;
  }
  try {
    const r = await confirmLogin(token, msg.from);
    if (r === 'ok') await say(msg.chat.id, `Готово, ${msg.from.first_name || 'мэр'}! Вы вошли в RoadFlow. Вернитесь на сайт: он откроется сам.`);
    else await say(msg.chat.id, 'Эта ссылка устарела. Нажмите «Войти» на сайте ещё раз, чтобы получить новую.', siteButton('Открыть сайт'));
  } catch (e) {
    console.error('confirm failed:', e.message);
    await say(msg.chat.id, 'Не получилось связаться с сервером игры. Попробуйте ещё раз через минуту.');
  }
}

let offset = 0, stopping = false;
const seen = new Set();
async function loop() {
  let failures = 0;
  while (!stopping) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] }, 40000);
      failures = 0;
      for (const u of updates) {
        offset = u.update_id + 1;
        if (seen.has(u.update_id)) continue;
        seen.add(u.update_id);
        if (seen.size > 500) seen.delete(seen.values().next().value);
        await onMessage(u.message);
      }
    } catch (e) {
      failures++;
      console.error(`getUpdates failed (${failures}):`, e.message);
      await sleep(Math.min(30000, 1000 * 2 ** Math.min(failures, 5)));
    }
  }
}

process.on('SIGINT', () => { stopping = true; setTimeout(() => process.exit(0), 200); });
process.on('SIGTERM', () => { stopping = true; setTimeout(() => process.exit(0), 200); });
tg('getMe', {}).then(me => console.log(`bot @${me.username} started`)).catch(e => console.error('getMe failed:', e.message));
loop();

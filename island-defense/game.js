(() => {
'use strict';

// ============================================================ basics
const W = 360, H = 640, HQX = 180, HQY = 330;
const $ = id => document.getElementById(id);
const cv = $('c'); cv.width = W; cv.height = H;
const ctx = cv.getContext('2d');
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const dist = (a, b, c, d) => Math.hypot(a - c, b - d);

function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function makeNoise(seed) {
  const r = mulberry(seed), N = 256, p = new Float32Array(N * N);
  for (let i = 0; i < p.length; i++) p[i] = r();
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = p[(yi & 255) * N + (xi & 255)], b = p[(yi & 255) * N + ((xi + 1) & 255)];
    const c = p[((yi + 1) & 255) * N + (xi & 255)], d = p[((yi + 1) & 255) * N + ((xi + 1) & 255)];
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  return (x, y, o = 4) => { let s = 0, a = .5, f = 1, n = 0;
    for (let i = 0; i < o; i++) { s += v(x * f, y * f) * a; n += a; a *= .5; f *= 2; } return s / n; };
}

// ============================================================ terrain (pixel art, pre-rendered)
const N1 = makeNoise(7), N2 = makeNoise(21), N3 = makeNoise(99);
const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - .5);
const land = new Uint8Array(W * H); // 0 water 1 sand 2 grass 3 forest
const terrain = mk(W, H);
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const C = {
  deep: hex('#10212d'), deep2: hex('#14293a'), mid: hex('#183446'), mid2: hex('#1b3b4d'), shal: hex('#235063'), shal2: hex('#2a5d70'),
  sand: hex('#c4b078'), sand2: hex('#b09e62'), wet: hex('#8f8a55'),
  g1: hex('#587432'), g2: hex('#5f7c36'), g3: hex('#536e2f'), g4: hex('#4d6a2c'),
  f1: hex('#2f4d22'), f2: hex('#27431d'), f3: hex('#365629'), path: hex('#aa9b62'),
};
(function buildTerrain() {
  const x = terrain.getContext('2d'), id = x.createImageData(W, H), d = id.data;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const dx = (xx - HQX) / 150, dy = (y - HQY) / 228, ds = Math.hypot(dx, dy);
    let h = 1 - ds + (N1(xx / 55, y / 55, 4) - .5) * .95;
    h = Math.max(h, .9 - Math.hypot((xx - 62) / 30, (y - 92) / 24) + (N1(xx / 30 + 9, y / 30, 3) - .5) * .6);
    h = Math.max(h, .85 - Math.hypot((xx - 300) / 22, (y - 566) / 20) + (N2(xx / 25, y / 25, 3) - .5) * .6);
    const b = BAY[(y & 3) * 4 + (xx & 3)] * .04, hh = h + b, i = y * W + xx;
    let c, l = 0;
    const v = N2(xx / 8, y / 8, 2) + b;
    if (hh < 0) {
      if (hh > -.06) c = v > .5 ? C.shal2 : C.shal;
      else if (hh > -.17) c = v > .52 ? C.mid2 : C.mid;
      else c = v > .55 ? C.deep2 : C.deep;
    } else if (hh < .05) { c = v > .45 ? C.sand : C.sand2; l = 1; }
    else if (hh < .08) { c = C.wet; l = 1; }
    else {
      l = 2;
      const g = N3(xx / 6, y / 6, 2) + b * .8;
      c = g > .56 ? C.g2 : g > .46 ? C.g1 : g > .36 ? C.g3 : C.g4;
      if (Math.abs(h - .33) < .011) c = C.path;
      else if (h > .16 && N2(xx / 15 + 3, y / 15, 3) > .55 + b * .4) { l = 3; c = g > .5 ? C.f3 : g > .4 ? C.f1 : C.f2; }
    }
    land[i] = l; d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  const r = mulberry(5);
  const on = (px, py) => px > 0 && py > 0 && px < W && py < H && land[(py | 0) * W + (px | 0)] === 2;
  // fields
  const cols = ['#7b8a3c', '#8b7b3c', '#6a8438', '#94874a'];
  for (let k = 0; k < 14; k++) {
    const px = 60 + r() * 240 | 0, py = 150 + r() * 360 | 0, w = 12 + r() * 14 | 0, h = 8 + r() * 10 | 0;
    if (Math.hypot(px - HQX, py - HQY) < 50) continue;
    if (!(on(px, py) && on(px + w, py) && on(px, py + h) && on(px + w, py + h))) continue;
    x.fillStyle = cols[(r() * cols.length) | 0]; x.globalAlpha = .75; x.fillRect(px, py, w, h); x.globalAlpha = 1;
  }
  // villages
  for (const [vx, vy] of [[238, 250], [105, 410], [250, 430]]) {
    for (let k = 0; k < 9; k++) {
      const px = vx + (r() * 24 | 0), py = vy + (r() * 16 | 0);
      if (!on(px, py) || !on(px + 3, py + 3)) continue;
      x.fillStyle = '#7c6a58'; x.fillRect(px, py, 3, 3); x.fillStyle = '#a5503c'; x.fillRect(px, py, 3, 1);
    }
  }
  // roads from the base to the coast
  x.fillStyle = '#a89a62';
  for (const a0 of [-.45, 1.75, 3.55]) {
    let px = HQX, py = HQY, a = a0;
    for (let s = 0; s < 400; s++) {
      a += (N1(s / 20, a0 * 9, 2) - .5) * .12; px += Math.cos(a); py += Math.sin(a);
      if (px < 0 || py < 0 || px >= W || py >= H || land[(py | 0) * W + (px | 0)] === 0) break;
      if (s > 20) x.fillRect(px | 0, py | 0, 2, 2);
    }
  }
  // tree dots
  for (let k = 0; k < 900; k++) {
    const px = r() * W | 0, py = r() * H | 0;
    if (land[py * W + px] === 3) { x.fillStyle = r() > .5 ? '#1e3517' : '#406a30'; x.fillRect(px, py, 1, 1); }
  }
})();
const landAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : land[(y | 0) * W + (x | 0)];

// scorch layer (persistent craters)
const scorch = mk(W, H), sctx = scorch.getContext('2d');
function addScorch(x, y, r) {
  for (let i = 0; i < r * 3; i++) {
    const a = rnd(0, 6.28), d = Math.random() * r;
    const px = x + Math.cos(a) * d | 0, py = y + Math.sin(a) * d | 0;
    if (landAt(px, py) < 1) continue;
    sctx.fillStyle = Math.random() > .3 ? 'rgba(20,16,12,.55)' : 'rgba(0,0,0,.8)';
    sctx.fillRect(px, py, 2, 2);
  }
}
// cloud shadows
const clouds = mk(W * 2, H * 2);
(function () {
  const x = clouds.getContext('2d'); x.fillStyle = 'rgba(2,10,18,.22)';
  for (let y = 0; y < H * 2; y += 4) for (let xx = 0; xx < W * 2; xx += 4)
    if (N3(xx / 70 + 40, y / 70 + 40, 3) > .6) x.fillRect(xx, y, 4, 4);
})();
const glints = Array.from({ length: 90 }, () => ({ x: rnd(0, W) | 0, y: rnd(0, H) | 0, p: rnd(0, 6.28), s: rnd(.4, 1.2) }))
  .filter(g => landAt(g.x, g.y) === 0);

// ============================================================ sprites
const PAL = { g: '#c9ced4', G: '#9aa1aa', d: '#6b727c', D: '#454b54', w: '#f2f4f6', k: '#1a1c20', r: '#c0392b', R: '#7a2a24',
  o: '#e8892b', y: '#f1c40f', b: '#3b6ea5', n: '#6b4f2e', l: '#6f8a3a', L: '#46602a', t: '#b8a36a', h: '#5a6a4a', H: '#3d4a33', c: '#4a90a4' };
const sym = rows => rows.map(r => r + r.slice(0, -1).split('').reverse().join(''));
class Spr {
  constructor(rows) {
    this.w = rows[0].length; this.h = rows.length;
    const c = mk(this.w, this.h), x = c.getContext('2d');
    rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') { x.fillStyle = PAL[ch]; x.fillRect(i, j, 1, 1); } }));
    this.src = x.getImageData(0, 0, this.w, this.h); this.c = c; this.m = [new Map(), new Map()];
  }
  frame(a, sh) {
    const N = 32, k = ((Math.round(a / (Math.PI * 2) * N) % N) + N) % N, m = this.m[sh ? 1 : 0];
    let f = m.get(k); if (f) return f;
    const ang = k / N * Math.PI * 2, d = Math.ceil(Math.hypot(this.w, this.h)) + 2, c = mk(d, d), x = c.getContext('2d');
    const out = x.createImageData(d, d), cs = Math.cos(ang), sn = Math.sin(ang), S = this.src.data;
    for (let j = 0; j < d; j++) for (let i = 0; i < d; i++) {
      const px = i - d / 2 + .5, py = j - d / 2 + .5;
      const ix = Math.floor(px * cs + py * sn + this.w / 2), iy = Math.floor(-px * sn + py * cs + this.h / 2);
      if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) continue;
      const o = (iy * this.w + ix) * 4; if (!S[o + 3]) continue; const p = (j * d + i) * 4;
      if (sh) { out.data[p] = 0; out.data[p + 1] = 8; out.data[p + 2] = 16; out.data[p + 3] = 85; }
      else { out.data[p] = S[o]; out.data[p + 1] = S[o + 1]; out.data[p + 2] = S[o + 2]; out.data[p + 3] = 255; }
    }
    x.putImageData(out, 0, 0); m.set(k, c); return c;
  }
  draw(px, py, a, sh = false) { const f = this.frame(a, sh); ctx.drawImage(f, Math.round(px - f.width / 2), Math.round(py - f.height / 2)); }
}
const SP = {
  bomber: new Spr(sym(['........g', '.......gg', '.......wg', '.......gg', '......ggg', '......ggg', '.....Gggg', '...GGGggg', '.GGGGgggg', 'GGGGggggg',
    'dGGgggggg', '.dGgggggg', '...dGgggg', '.....Gggg', '......ggg', '......ggg', '.....GGgg', '...GGGGgg', '.GGGGGGgg', '.....dGgg'])),
  trans: new Spr(sym(['.......h', '......hh', '......wh', '......hh', '.....hhh', 'DHHHHhhh', 'HhhhhHhh', 'DHHHHhhh', '.....hhh', '.....hhh', '.....hhh',
    '.....hhh', '.....hhh', '.....Hhh', '....HHhh', '..HHHHhh', '..HHHHhh', '......hh'])),
  boat: new Spr(sym(['....D', '...Dl', '..DlL', '.DllL', 'DllLL', 'DllLL', 'DlnLL', 'DlnLL', 'DllLL', 'DllLL', 'DllLL', 'DllLL', 'DllLL', 'DllLL', 'DllLL', 'DllLL',
    'DlLLL', 'DlLLL', 'DlLLL', 'DDDDD'])),
  tboat: new Spr(sym(['.....D', '....Dt', '...Dtt', '..Dttt', '.Dtttt', 'DttHHt'].concat(Array(14).fill('DttHHt'), ['DtHHHt', 'DtHHHt', 'DDDDDD']))),
  tank: new Spr(sym(['...D', '...D', 'kkrR', 'kkRR', 'kkrR', 'kkrr', 'kkRR', 'kkrR', 'kk.r'])),
  mgT: new Spr(sym(['..D', '..D', '.dG', 'dGG', 'dGG'])),
  gunT: new Spr(sym(['...D', '...D', '...D', '...D', '..dG', '.dGG', '.dGG', '..dd'])),
  aaT: new Spr(['D.D', 'D.D', 'DdD', 'dGd', 'GGG', 'GGG']),
  samT: new Spr(sym(['.w.D', '.r.D', '.G.D', '.GdD', '.GdD', '.dDD'])),
};

// ============================================================ audio (tiny synth, optional)
const AU = { ctx: null, on: true, last: {} };
function sfx(kind, vol = 1) {
  if (!AU.on || !AU.ctx) return;
  const t = AU.ctx.currentTime; if (AU.last[kind] && t - AU.last[kind] < .05) return; AU.last[kind] = t;
  const p = { boom: [.5, 500, .5], shot: [.03, 3000, .06], cannon: [.22, 700, .28], missile: [.3, 1500, .12], hit: [.04, 2000, .04], bomb: [.5, 300, .5] }[kind];
  const len = p[0], f = p[1], v = p[2] * vol, n = AU.ctx.sampleRate * len | 0, buf = AU.ctx.createBuffer(1, n, AU.ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2;
  const s = AU.ctx.createBufferSource(); s.buffer = buf;
  const fl = AU.ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = f;
  const g = AU.ctx.createGain(); g.gain.value = v * .5; s.connect(fl); fl.connect(g); g.connect(AU.ctx.destination); s.start();
}

// ============================================================ game data
const T = {
  mg:   { name: 'ПУЛЕМЁТ', cost: 60,  range: 72,  rate: 9,   dmg: 3,  hp: 90,  tg: 'ground', spr: SP.mgT },
  gun:  { name: 'ПУШКА',   cost: 120, range: 118, rate: .8,  dmg: 34, hp: 140, tg: 'ground', spr: SP.gunT, splash: 13 },
  aa:   { name: 'ЗЕНИТКА', cost: 90,  range: 96,  rate: 7,   dmg: 3.6, hp: 90, tg: 'air',    spr: SP.aaT },
  sam:  { name: 'ЗРК',     cost: 170, range: 180, rate: .55, dmg: 55, hp: 110, tg: 'air',    spr: SP.samT, noPara: true },
  pump: { name: 'КАЧАЛКА', cost: 80,  hp: 60, income: 1.6 },
};
const ORDER = ['mg', 'gun', 'aa', 'sam', 'pump'];
const E = {
  inf:   { hp: 12,  speed: 15, range: 22, dps: 3.5, reward: 3,  layer: 'ground' },
  tank:  { hp: 95,  speed: 11, range: 50, dps: 13,  reward: 20, layer: 'ground' },
  para:  { hp: 7,   speed: 0,  reward: 4, layer: 'air' },
  boat:  { hp: 150, speed: 24, reward: 15, layer: 'sea' },
  tboat: { hp: 280, speed: 19, reward: 30, layer: 'sea' },
  trans: { hp: 100, speed: 56, reward: 25, layer: 'air' },
  bomber:{ hp: 120, speed: 64, reward: 35, layer: 'air' },
};

const S = {};
function reset() {
  Object.assign(S, { oil: 260, kills: 0, wave: 0, state: 'break', countdown: 8, events: [], evT: 0, bld: [], en: [], proj: [], parts: [], tr: [],
    bombs: [], rings: [], falls: [], warns: [], t: 0, speed: 1, paused: false, sel: null, tool: null, ghost: null, best: +(localStorage.getItem('idBest') || 0), over: false, shake: 0 });
  S.hq = { k: 'hq', x: HQX, y: HQY, hp: 600, max: 600, lvl: 1 };
  S.bld.push(S.hq);
  sctx.clearRect(0, 0, W, H);
  // starter defences
  addB('mg', HQX - 34, HQY - 30); addB('aa', HQX + 34, HQY + 30); addB('pump', HQX + 38, HQY - 28);
  S.oil = 260; S.wave = 0; announce('ОБОРОНА ОСТРОВА', 'Построй защиту до начала первой волны');
  refreshUI();
}
function addB(k, x, y) {
  const sp = T[k], b = { k, x, y, hp: sp.hp, max: sp.hp, lvl: 1, cd: 0, ang: 0, flash: 0 };
  S.bld.push(b); return b;
}
const lvlMul = b => 1 + .45 * (b.lvl - 1);
const rangeOf = b => T[b.k].range * (1 + .08 * (b.lvl - 1));

// ============================================================ waves
function entryFrom(tx, ty, ang, margin = 16) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let x = tx, y = ty;
  for (let i = 0; i < 900 && x > -margin && y > -margin && x < W + margin && y < H + margin; i++) { x -= dx * 2; y -= dy * 2; }
  return { x, y, dx, dy };
}
function genWave(n) {
  const list = [];
  const add = t => list.push(t);
  if (n === 1) add('boat');
  else if (n === 2) { add('boat'); add('boat'); }
  else if (n === 3) { add('boat'); add('trans'); }
  else if (n === 4) { add('bomber'); add('boat'); }
  else {
    let budget = 3 + n * 1.7;
    const opts = [['boat', 1.2, 1], ['trans', 1.6, 3], ['bomber', 2, 4], ['tboat', 2.4, 6]];
    for (let g = 0; budget > 0 && g < 60; g++) {
      const av = opts.filter(o => n >= o[2] && o[1] <= budget + .5); if (!av.length) break;
      const o = pick(av); add(o[0]); budget -= o[1];
    }
    if (n % 5 === 0) { add('bomber'); add('bomber'); }
  }
  list.sort(() => Math.random() - .5);
  let t = 1.5; const ev = [];
  for (const type of list) {
    const e = { at: t, type, hpm: 1 + (n - 1) * .09 };
    if (type === 'boat' || type === 'tboat') {
      const a = rnd(0, 6.283), p = entryFrom(HQX, HQY, a + Math.PI, 10);
      // keep landings off the bottom (UI) side
      if (p.y > H - 70) { p.y = rnd(40, H - 120); p.x = Math.random() < .5 ? 8 : W - 8; }
      e.x = p.x; e.y = p.y;
    } else {
      const target = type === 'bomber' ? pick(Math.random() < .35 ? [{ x: HQX, y: HQY }] : [...S.bld.filter(b => b.k !== 'hq')].concat([S.hq]))
        : { x: HQX + rnd(-70, 70), y: HQY + rnd(-90, 90) };
      const p = entryFrom(target.x, target.y, rnd(0, 6.283));
      Object.assign(e, { x: p.x, y: p.y, dx: p.dx, dy: p.dy, tx: target.x, ty: target.y });
    }
    ev.push(e); t += rnd(2.5, 6.5);
  }
  return ev;
}
const WAVE_NAMES = { boat: 'десант с моря', tboat: 'танковый десант', trans: 'парашютисты', bomber: 'бомбардировщики' };
function startWave() {
  S.wave++; S.state = 'wave'; S.events = genWave(S.wave); S.evT = 0;
  const kinds = [...new Set(S.events.map(e => WAVE_NAMES[e.type]))];
  announce('ВОЛНА ' + S.wave, kinds.join(' · '));
  refreshUI();
}

// ============================================================ effects
function boom(x, y, r = 12, big = false) {
  const n = (r * 1.6) | 0;
  for (let i = 0; i < n; i++) { const a = rnd(0, 6.28), s = rnd(.1, 1) * r * 3.2;
    S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rnd(.3, .65), sz: rnd(2, 4) | 0, k: 'fire' }); }
  for (let i = 0; i < n * .7; i++) { const a = rnd(0, 6.28), s = rnd(.05, .6) * r * 1.6;
    S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 4, life: 0, max: rnd(1.1, 2.4) * (big ? 1.4 : 1), sz: rnd(3, 6) | 0, k: 'smoke' }); }
  S.rings.push({ x, y, r: 2, max: r * 1.5, life: 0 });
  sfx(big ? 'bomb' : 'boom', big ? 1 : .7); S.shake = Math.max(S.shake, big ? 3 : 1);
  if (landAt(x, y) > 0) addScorch(x, y, r * .8);
}
function puff(x, y, c = 'flak') { S.parts.push({ x, y, vx: rnd(-6, 6), vy: rnd(-6, 6), life: 0, max: .5, sz: 2, k: c }); }
function tracer(x1, y1, x2, y2, c = '#ffe58a', life = .07) { S.tr.push({ x1, y1, x2, y2, life, c }); }
function foam(x, y) { S.parts.push({ x, y, vx: rnd(-2, 2), vy: rnd(-2, 2), life: 0, max: 1.1, sz: 2, k: 'foam' }); }

// ============================================================ entities
function spawnEnemy(t, x, y, extra = {}) {
  const e = Object.assign({ t, x, y, hp: E[t].hp * (S.hpm || 1), max: E[t].hp * (S.hpm || 1), ang: 0, vx: 0, vy: 0, cd: 0, layer: E[t].layer }, extra);
  S.en.push(e); return e;
}
function runEvent(ev) {
  S.hpm = ev.hpm;
  if (ev.type === 'boat' || ev.type === 'tboat') {
    const e = spawnEnemy(ev.type, ev.x, ev.y, { state: 'sail', cargo: ev.type === 'boat' ? Array(5 + (S.wave > 8 ? 2 : 0)).fill('inf') : ['tank', 'tank', 'inf', 'inf', 'inf'], ut: 0, ft: 0 });
    e.ang = Math.atan2(HQX - e.x, -(HQY - e.y));
  } else {
    const e = spawnEnemy(ev.type, ev.x, ev.y, { dx: ev.dx, dy: ev.dy, tx: ev.tx, ty: ev.ty, drop: ev.type === 'trans' ? 6 + (S.wave > 8 ? 2 : 0) : 0, bt: 0 });
    e.ang = Math.atan2(ev.dx, -ev.dy); e.speed = E[ev.type].speed;
  }
}
function hurt(e, d) {
  if (e.dead) return; e.hp -= d; e.hitT = .08;
  if (e.hp <= 0) kill(e);
}
function kill(e) {
  e.dead = true; S.kills++; S.oil += E[e.t].reward;
  if (e.t === 'trans' || e.t === 'bomber') {
    S.falls.push({ x: e.x, y: e.y, vx: e.dx * E[e.t].speed * .7, vy: e.dy * E[e.t].speed * .7, ang: e.ang, spin: rnd(-1.5, 1.5), t: 0, k: e.t });
  } else if (e.layer === 'sea') boom(e.x, e.y, 16, true);
  else if (e.t === 'tank') boom(e.x, e.y, 10);
  else if (e.t === 'para') { puff(e.x, e.y, 'foam'); }
  else { for (let i = 0; i < 4; i++) S.parts.push({ x: e.x, y: e.y, vx: rnd(-14, 14), vy: rnd(-14, 14), life: 0, max: .4, sz: 1, k: 'blood' }); }
}
function hitBuilding(b, d) {
  if (b.dead) return; b.hp -= d; b.hitT = .1;
  if (b.hp <= 0) {
    b.dead = true; boom(b.x, b.y, b === S.hq ? 26 : 13, true); addScorch(b.x, b.y, 14);
    if (b === S.hq) gameOver();
    else { S.bld = S.bld.filter(q => q !== b); if (S.sel === b) select(null); }
  }
}
function splash(x, y, r, dmg, buildings = true, enemies = false) {
  if (buildings) for (const b of S.bld.slice()) if (dist(x, y, b.x, b.y) < r + (b === S.hq ? 14 : 6)) hitBuilding(b, dmg);
  if (enemies) for (const e of S.en) if (!e.dead && e.layer !== 'air' && dist(x, y, e.x, e.y) < r + 3) hurt(e, dmg);
}

// ============================================================ update
function nearestBuilding(x, y, maxD) {
  let best = null, bd = maxD;
  for (const b of S.bld) { const d = dist(x, y, b.x, b.y) - (b === S.hq ? 14 : 0); if (d < bd) { bd = d; best = b; } }
  return best;
}
function step(dt) {
  S.t += dt;
  if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 8);
  // income
  let inc = 1.2; for (const b of S.bld) if (b.k === 'pump') inc += T.pump.income * lvlMul(b);
  S.inc = inc; S.oil += inc * dt;

  // wave flow
  if (S.state === 'break') { S.countdown -= dt; if (S.countdown <= 0) startWave(); }
  else if (S.state === 'wave') {
    S.evT += dt;
    while (S.events.length && S.events[0].at <= S.evT) runEvent(S.events.shift());
    S.warns = S.events.filter(e => e.at - S.evT < 3).map(e => ({ x: e.x, y: e.y, air: e.type === 'trans' || e.type === 'bomber' }));
    if (!S.events.length && !S.en.length && !S.falls.length) {
      const bonus = 40 + S.wave * 12; S.oil += bonus; S.state = 'break'; S.countdown = 14; S.warns = [];
      announce('ВОЛНА ОТБИТА', '+' + bonus + ' нефти');
      if (S.wave > S.best) { S.best = S.wave; localStorage.setItem('idBest', S.best); }
    }
  }

  for (const b of S.bld) {
    if (b.hitT) b.hitT = Math.max(0, b.hitT - dt);
    if (b.hp < b.max * .4 && Math.random() < dt * 6) S.parts.push({ x: b.x + rnd(-4, 4), y: b.y + rnd(-4, 4), vx: rnd(-3, 3), vy: -8, life: 0, max: 1.4, sz: 3, k: 'smoke' });
    if (b.k === 'hq' || b.k === 'pump') continue;
    updTower(b, dt);
  }
  for (const e of S.en) updEnemy(e, dt);
  S.en = S.en.filter(e => !e.dead);

  for (const p of S.proj) updProj(p, dt);
  S.proj = S.proj.filter(p => !p.dead);

  for (const b of S.bombs) { b.t -= dt; if (b.t <= 0) { b.dead = true; boom(b.x, b.y, 15, true); splash(b.x, b.y, 17, 62); } }
  S.bombs = S.bombs.filter(b => !b.dead);

  for (const f of S.falls) {
    f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.ang += f.spin * dt;
    if (Math.random() < dt * 40) S.parts.push({ x: f.x, y: f.y, vx: rnd(-4, 4), vy: rnd(-4, 4), life: 0, max: 1.3, sz: 3, k: Math.random() < .4 ? 'fire' : 'smoke' });
    if (f.t > 1.1) { f.dead = true; boom(f.x, f.y, f.k === 'bomber' ? 20 : 16, true); splash(f.x, f.y, 14, 45); }
  }
  S.falls = S.falls.filter(f => !f.dead);

  for (const p of S.parts) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.k === 'smoke') { p.vx *= .97; p.vy *= .97; } else { p.vx *= .92; p.vy *= .92; } }
  S.parts = S.parts.filter(p => p.life < p.max);
  for (const r of S.rings) { r.life += dt; r.r += (r.max - r.r) * dt * 6; }
  S.rings = S.rings.filter(r => r.life < .5);
  for (const t of S.tr) t.life -= dt; S.tr = S.tr.filter(t => t.life > 0);
}

function inAir(e) { return e.layer === 'air'; }
function findTarget(b, sp, range) {
  let best = null, bd = range;
  for (const e of S.en) {
    if (e.dead) continue;
    if (sp.tg === 'air' ? !inAir(e) : inAir(e)) continue;
    if (sp.noPara && e.t === 'para') continue;
    const d = dist(b.x, b.y, e.x, e.y); if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function updTower(b, dt) {
  const sp = T[b.k], range = rangeOf(b); b.cd -= dt; if (b.flash) b.flash = Math.max(0, b.flash - dt);
  const t = findTarget(b, sp, range); if (!t) return;
  b.ang = Math.atan2(t.x - b.x, -(t.y - b.y));
  if (b.cd > 0) return; b.cd = 1 / sp.rate; b.flash = .06;
  const dmg = sp.dmg * lvlMul(b), mx = b.x + Math.sin(b.ang) * 7, my = b.y - Math.cos(b.ang) * 7;
  if (b.k === 'mg' || b.k === 'aa') {
    const hit = Math.random() < (b.k === 'mg' ? .85 : .6);
    const jx = hit ? 0 : rnd(-8, 8), jy = hit ? 0 : rnd(-8, 8);
    tracer(mx, my, t.x + jx, t.y + jy, b.k === 'mg' ? '#ffe58a' : '#fff3c0');
    if (hit) { hurt(t, dmg); if (b.k === 'aa') puff(t.x, t.y); }
    else if (b.k === 'aa') puff(t.x + jx, t.y + jy);
    sfx('shot', .5);
  } else if (b.k === 'gun') {
    const d = dist(b.x, b.y, t.x, t.y), T0 = d / 170;
    S.proj.push({ k: 'shell', x: mx, y: my, tx: t.x + t.vx * T0, ty: t.y + t.vy * T0, t: 0, T: T0, x0: mx, y0: my, dmg, r: sp.splash });
    puff(mx, my, 'foam'); sfx('cannon');
  } else if (b.k === 'sam') {
    S.proj.push({ k: 'sam', x: mx, y: my, a: b.ang, tg: t, t: 0, dmg });
    sfx('missile');
  }
}
function updProj(p, dt) {
  if (p.k === 'shell') {
    p.t += dt; const f = Math.min(1, p.t / p.T); p.x = p.x0 + (p.tx - p.x0) * f; p.y = p.y0 + (p.ty - p.y0) * f;
    if (f >= 1) { p.dead = true; boom(p.tx, p.ty, 9); splash(p.tx, p.ty, p.r, p.dmg, false, true); }
  } else if (p.k === 'sam') {
    p.t += dt; const t = p.tg;
    if (t.dead || p.t > 4) { p.dead = true; boom(p.x, p.y, 5); return; }
    const want = Math.atan2(t.x - p.x, -(t.y - p.y)); let da = want - p.a; da = Math.atan2(Math.sin(da), Math.cos(da));
    p.a += clamp(da, -5 * dt, 5 * dt);
    const sp = 150 + p.t * 60; p.x += Math.sin(p.a) * sp * dt; p.y -= Math.cos(p.a) * sp * dt;
    S.parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0, max: .6, sz: 2, k: 'trail' });
    if (dist(p.x, p.y, t.x, t.y) < 7) { p.dead = true; boom(p.x, p.y, 8); hurt(t, p.dmg); }
  } else if (p.k === 'ashell') { // enemy tank shell
    p.t += dt; const f = Math.min(1, p.t / p.T); p.x = p.x0 + (p.tx - p.x0) * f; p.y = p.y0 + (p.ty - p.y0) * f;
    if (f >= 1) { p.dead = true; boom(p.tx, p.ty, 6); splash(p.tx, p.ty, 7, p.dmg); }
  }
}
function moveGround(e, tx, ty, sp, dt) {
  const d = dist(e.x, e.y, tx, ty) || 1, vx = (tx - e.x) / d * sp, vy = (ty - e.y) / d * sp;
  let nx = e.x + vx * dt, ny = e.y + vy * dt;
  if (landAt(nx, ny) >= 1) { e.x = nx; e.y = ny; e.vx = vx; e.vy = vy; }
  else if (landAt(nx, e.y) >= 1) { e.x = nx; e.vx = vx; e.vy = 0; }
  else if (landAt(e.x, ny) >= 1) { e.y = ny; e.vy = vy; e.vx = 0; }
  else { e.vx = e.vy = 0; }
  e.ang = Math.atan2(vx, -vy);
}
function updEnemy(e, dt) {
  if (e.hitT) e.hitT = Math.max(0, e.hitT - dt);
  const sp = E[e.t];
  switch (e.t) {
    case 'boat': case 'tboat': {
      const bs = sp.speed;
      if (e.state === 'sail') {
        const d = dist(e.x, e.y, HQX, HQY) || 1, dx = (HQX - e.x) / d, dy = (HQY - e.y) / d;
        e.vx = dx * bs; e.vy = dy * bs; e.x += e.vx * dt; e.y += e.vy * dt;
        e.ft -= dt; if (e.ft <= 0) { e.ft = .12; foam(e.x - dx * 9, e.y - dy * 9); }
        if (landAt(e.x + dx * 9, e.y + dy * 9) >= 1) { e.state = 'unload'; e.vx = e.vy = 0; e.ut = .5; }
      } else if (e.state === 'unload') {
        e.ut -= dt;
        if (e.ut <= 0 && e.cargo.length) {
          const t = e.cargo.shift(), dx = Math.sin(e.ang), dy = -Math.cos(e.ang);
          let ux = e.x + dx * 11 + rnd(-3, 3), uy = e.y + dy * 11 + rnd(-3, 3);
          if (landAt(ux, uy) < 1) { ux = e.x + dx * 15; uy = e.y + dy * 15; }
          S.hpm = 1 + (S.wave - 1) * .09; spawnEnemy(t, ux, uy); e.ut = t === 'tank' ? 1.3 : .55;
        }
        if (!e.cargo.length && e.ut <= 0) { e.state = 'leave'; }
      } else { // leave
        const dx = Math.sin(e.ang), dy = -Math.cos(e.ang);
        e.x -= dx * bs * .8 * dt; e.y -= dy * bs * .8 * dt;
        e.ft -= dt; if (e.ft <= 0) { e.ft = .15; foam(e.x + dx * 9, e.y + dy * 9); }
        if (e.x < -30 || e.y < -30 || e.x > W + 30 || e.y > H + 30) e.dead = true;
      }
      break;
    }
    case 'inf': case 'tank': {
      let tg = nearestBuilding(e.x, e.y, e.t === 'tank' ? 85 : 55) || S.hq;
      const d = dist(e.x, e.y, tg.x, tg.y) - (tg === S.hq ? 14 : 4);
      if (d > sp.range) moveGround(e, tg.x, tg.y, sp.speed, dt);
      else {
        e.vx = e.vy = 0; e.ang = Math.atan2(tg.x - e.x, -(tg.y - e.y));
        e.cd -= dt;
        if (e.t === 'inf') { hitBuilding(tg, sp.dps * dt); if (e.cd <= 0) { e.cd = rnd(.25, .5); tracer(e.x, e.y, tg.x + rnd(-4, 4), tg.y + rnd(-4, 4), '#ff9f6a', .05); sfx('hit', .4); } }
        else if (e.cd <= 0) { e.cd = 1.3; const T0 = d / 150 + .1; S.proj.push({ k: 'ashell', x: e.x, y: e.y, x0: e.x, y0: e.y, tx: tg.x, ty: tg.y, t: 0, T: T0, dmg: sp.dps * 1.3 }); sfx('cannon', .6); puff(e.x, e.y, 'foam'); }
      }
      break;
    }
    case 'para': {
      e.t0 = (e.t0 || 0) + dt; e.x += e.dvx * dt; e.y += e.dvy * dt;
      if (e.t0 >= e.dur) {
        if (landAt(e.x, e.y) < 1) { e.dead = true; for (let i = 0; i < 6; i++) foam(e.x, e.y); }
        else { e.t = 'inf'; e.layer = 'ground'; e.hp = E.inf.hp * (S.hpm || 1); e.max = e.hp; }
      }
      break;
    }
    case 'trans': case 'bomber': {
      e.x += e.dx * sp.speed * dt; e.y += e.dy * sp.speed * dt;
      const along = (e.x - e.tx) * e.dx + (e.y - e.ty) * e.dy;
      e.bt -= dt;
      if (e.t === 'bomber' && Math.abs(along) < 38 && e.bt <= 0) {
        e.bt = .32; S.bombs.push({ x: e.x + e.dx * 22 + rnd(-3, 3), y: e.y + e.dy * 22 + rnd(-3, 3), t: .85, t0: .85 });
      }
      if (e.t === 'trans' && e.drop > 0 && Math.abs(along) < 34 && e.bt <= 0) {
        e.bt = .28; e.drop--; S.hpm = 1 + (S.wave - 1) * .09;
        const p = spawnEnemy('para', e.x, e.y, { dur: rnd(2.6, 3.4) });
        p.dvx = rnd(-7, 7) + e.dx * 6; p.dvy = rnd(-7, 7) + e.dy * 6;
      }
      if (along > 40 && (e.x < -50 || e.y < -50 || e.x > W + 50 || e.y > H + 50)) e.dead = true;
      break;
    }
  }
}

// ============================================================ rendering
const FIRE = ['#fff6c8', '#ffd45a', '#f39a2b', '#d4551f', '#7a2a18', '#3a2a28'];
function pline(x1, y1, x2, y2, c) {
  ctx.fillStyle = c; const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x1 + (x2 - x1) * i / n), Math.round(y1 + (y2 - y1) * i / n), 1, 1);
}
function ring(x, y, r, c, off = 0, a = 1) {
  ctx.fillStyle = c; ctx.globalAlpha = a; const n = Math.max(12, (r * 1.1) | 0);
  for (let i = 0; i < n; i += 2) { const an = i / n * 6.283 + off; ctx.fillRect(Math.round(x + Math.cos(an) * r), Math.round(y + Math.sin(an) * r), 2, 2); }
  ctx.globalAlpha = 1;
}
function hpbar(x, y, w, f) {
  ctx.fillStyle = '#000'; ctx.fillRect(x - w / 2 - 1 | 0, y - 1 | 0, w + 2, 4);
  ctx.fillStyle = f > .5 ? '#6fd06a' : f > .25 ? '#f0b840' : '#e0503c'; ctx.fillRect(x - w / 2 | 0, y | 0, Math.max(1, w * f | 0), 2);
}
// HQ sprite (oil depot)
const hqCv = mk(44, 36);
(function () {
  const x = hqCv.getContext('2d');
  x.fillStyle = '#3d424a'; x.fillRect(0, 0, 44, 36); x.fillStyle = '#5b616a'; x.fillRect(1, 1, 42, 34); x.fillStyle = '#6c737d'; x.fillRect(2, 2, 40, 32);
  const tank = (cx, cy, r) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) {
    x.fillStyle = i * i + j * j > (r - 1.5) ** 2 ? '#8a6a24' : (i + j < -r * .5 ? '#f4dc8a' : '#d6ae48'); x.fillRect(cx + i, cy + j, 1, 1); } };
  tank(11, 11, 6); tank(11, 25, 6); tank(25, 18, 5);
  x.fillStyle = '#2b2f36'; x.fillRect(32, 5, 9, 9); x.fillStyle = '#7a4a2a'; x.fillRect(33, 6, 7, 7); x.fillStyle = '#a56a3c'; x.fillRect(33, 6, 7, 2);
  x.fillStyle = '#2b2f36'; x.fillRect(32, 22, 9, 10); x.fillStyle = '#4b6a8a'; x.fillRect(33, 23, 7, 8);
  x.fillStyle = '#9aa1aa'; x.fillRect(17, 11, 1, 14); x.fillRect(17, 18, 5, 1);
  x.fillStyle = '#e8d84a'; x.fillRect(2, 2, 1, 1); x.fillRect(41, 2, 1, 1); x.fillRect(2, 33, 1, 1); x.fillRect(41, 33, 1, 1);
})();
function drawBuilding(b) {
  const x = b.x | 0, y = b.y | 0;
  if (b.k === 'hq') { ctx.drawImage(hqCv, x - 22, y - 18); if (b.hitT) { ctx.fillStyle = 'rgba(255,200,150,.3)'; ctx.fillRect(x - 22, y - 18, 44, 36); } }
  else if (b.k === 'pump') {
    ctx.fillStyle = '#2b2f36'; ctx.fillRect(x - 7, y - 7, 14, 14); ctx.fillStyle = '#6c737d'; ctx.fillRect(x - 6, y - 6, 12, 12);
    ctx.fillStyle = '#4a4f57'; ctx.fillRect(x - 6, y + 2, 12, 4);
    const ph = Math.sin(S.t * 3 + b.x) * 2.5 | 0;
    ctx.fillStyle = '#d6ae48'; ctx.fillRect(x - 5, y - 2 + ph, 8, 3); ctx.fillStyle = '#2b2f36'; ctx.fillRect(x + 2, y - 4, 2, 7);
    ctx.fillStyle = '#e8892b'; ctx.fillRect(x - 5, y - 3 + ph, 2, 5);
  } else {
    // sandbag ring
    ctx.fillStyle = '#4a3f28'; ctx.fillRect(x - 8, y - 8, 16, 16);
    ctx.fillStyle = '#8c7a4a'; ctx.fillRect(x - 7, y - 7, 14, 14);
    ctx.fillStyle = '#a89358'; ctx.fillRect(x - 7, y - 7, 14, 2); ctx.fillRect(x - 7, y - 7, 2, 14);
    ctx.fillStyle = '#3b3626'; ctx.fillRect(x - 5, y - 5, 10, 10);
    const sp = T[b.k]; sp.spr.draw(x, y, b.ang);
    if (b.flash) { const mx = x + Math.sin(b.ang) * 9, my = y - Math.cos(b.ang) * 9; ctx.fillStyle = '#fff3a0'; ctx.fillRect(mx - 1 | 0, my - 1 | 0, 3, 3); }
    if (b.hitT) { ctx.fillStyle = 'rgba(255,200,150,.35)'; ctx.fillRect(x - 8, y - 8, 16, 16); }
  }
  for (let i = 0; i < b.lvl - 1; i++) { ctx.fillStyle = '#f1c40f'; ctx.fillRect(x - 6 + i * 4, y + 9, 3, 2); }
  if (b.hp < b.max) hpbar(x, y - (b.k === 'hq' ? 24 : 13), b.k === 'hq' ? 30 : 12, b.hp / b.max);
}
function drawEnemy(e) {
  const x = e.x, y = e.y;
  switch (e.t) {
    case 'boat': SP.boat.draw(x, y, e.ang); break;
    case 'tboat': SP.tboat.draw(x, y, e.ang); break;
    case 'tank': SP.tank.draw(x, y, e.ang); break;
    case 'inf': ctx.fillStyle = e.hitT ? '#fff' : '#9c3a2c'; ctx.fillRect(x - 1 | 0, y - 1 | 0, 3, 3); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x - 1 | 0, y - 1 | 0, 3, 1); break;
    case 'para': {
      const f = 1 - e.t0 / e.dur, cy = y - 3 - f * 16;
      ctx.fillStyle = 'rgba(0,8,16,.35)'; ctx.fillRect(x + f * 5 - 2 | 0, y + f * 3 | 0, 4, 2);
      ctx.fillStyle = '#5a5a4a'; ctx.fillRect(x | 0, cy + 3 | 0, 1, 4); pline(x - 3, cy + 1, x, cy + 6, '#aaa'); pline(x + 3, cy + 1, x, cy + 6, '#aaa');
      ctx.fillStyle = e.hitT ? '#fff' : '#d9d9c4'; ctx.fillRect(x - 3 | 0, cy - 1 | 0, 7, 3); ctx.fillRect(x - 2 | 0, cy - 2 | 0, 5, 1);
      ctx.fillStyle = '#7a8a5a'; ctx.fillRect(x - 1 | 0, cy - 1 | 0, 1, 3); ctx.fillRect(x + 2 | 0, cy - 1 | 0, 1, 3);
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x | 0, cy + 6 | 0, 2, 2);
      break;
    }
  }
  if (e.hitT && (e.t === 'boat' || e.t === 'tboat' || e.t === 'tank')) { ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x - 4 | 0, y - 4 | 0, 8, 8); }
  if (e.hp < e.max && e.layer !== 'air' || e.hp < e.max && e.t !== 'para') hpbar(x, y - (e.layer === 'sea' ? 16 : 7), e.layer === 'sea' ? 16 : 8, e.hp / e.max);
}
function drawAir(e) {
  const sp = e.t === 'bomber' ? SP.bomber : SP.trans;
  sp.draw(e.x + 9, e.y + 14, e.ang, true); sp.draw(e.x, e.y, e.ang);
  if (e.hitT) { ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillRect(e.x - 5 | 0, e.y - 5 | 0, 10, 10); }
  if (e.hp < e.max) hpbar(e.x, e.y - 16, 14, e.hp / e.max);
}
function render() {
  ctx.save();
  if (S.shake > 0) ctx.translate((Math.random() - .5) * S.shake * 2 | 0, (Math.random() - .5) * S.shake * 2 | 0);
  ctx.drawImage(terrain, 0, 0);
  for (const g of glints) { const a = Math.sin(S.t * g.s + g.p); if (a > .6) { ctx.fillStyle = 'rgba(180,220,240,.28)'; ctx.fillRect(g.x, g.y, 2, 1); } }
  ctx.drawImage(scorch, 0, 0);

  // ranges for selection / ghost
  const selB = S.sel && S.bld.includes(S.sel) ? S.sel : null;
  if (selB && selB.k !== 'hq' && selB.k !== 'pump') ring(selB.x, selB.y, rangeOf(selB), '#9fe7ff', S.t * .3, .8);

  for (const b of S.bld) drawBuilding(b);
  if (selB) { ctx.strokeStyle = '#b04bff'; ctx.lineWidth = 1; const s = selB.k === 'hq' ? [24, 20] : [10, 10]; ctx.strokeRect(selB.x - s[0] + .5 | 0, selB.y - s[1] + .5 | 0, s[0] * 2, s[1] * 2); }

  for (const e of S.en) if (e.layer === 'sea') drawEnemy(e);
  for (const e of S.en) if (e.layer === 'ground') drawEnemy(e);
  for (const b of S.bombs) { const f = b.t / b.t0; ring(b.x, b.y, 4 + f * 12, '#ff7a5a', S.t * 3, .9); ctx.fillStyle = '#222'; ctx.fillRect(b.x - 1 | 0, b.y - (f * 40) | 0, 2, 4); }
  for (const p of S.proj) {
    if (p.k === 'sam') { ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 1 | 0, p.y - 1 | 0, 2, 2); }
    else { ctx.fillStyle = '#ffe9a8'; ctx.fillRect(p.x - 1 | 0, p.y - 1 | 0, 2, 2); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(p.x | 0, p.y + 3 | 0, 2, 1); }
  }
  for (const t of S.tr) pline(t.x1, t.y1, t.x2, t.y2, t.c);

  // particles
  for (const p of S.parts) {
    const f = p.life / p.max, px = Math.round(p.x), py = Math.round(p.y);
    if (p.k === 'fire') { ctx.fillStyle = FIRE[Math.min(5, (f * 6) | 0)]; ctx.globalAlpha = 1 - f * .5; const s = Math.max(1, p.sz * (1 - f * .5) | 0); ctx.fillRect(px, py, s, s); }
    else if (p.k === 'smoke') { ctx.fillStyle = f < .3 ? '#2a2623' : '#3b3a3a'; ctx.globalAlpha = (1 - f) * .85; const s = p.sz + (f * 4 | 0); ctx.fillRect(px - (s >> 1), py - (s >> 1), s, s); }
    else if (p.k === 'foam') { ctx.fillStyle = '#d8eef5'; ctx.globalAlpha = (1 - f) * .7; ctx.fillRect(px, py, 2, 2); }
    else if (p.k === 'trail') { ctx.fillStyle = '#e8e8e8'; ctx.globalAlpha = (1 - f) * .7; ctx.fillRect(px, py, 1, 1); }
    else if (p.k === 'flak') { ctx.fillStyle = '#2a2a2a'; ctx.globalAlpha = 1 - f; ctx.fillRect(px - 1, py - 1, 3, 3); }
    else if (p.k === 'blood') { ctx.fillStyle = '#7a1f1f'; ctx.globalAlpha = 1 - f; ctx.fillRect(px, py, 1, 1); }
    ctx.globalAlpha = 1;
  }
  for (const r of S.rings) ring(r.x, r.y, r.r, '#fff', r.life * 4, 1 - r.life * 2);
  // aircraft on top
  for (const f of S.falls) {
    const sp = f.k === 'bomber' ? SP.bomber : SP.trans, s = 1 - f.t / 1.2 * .15;
    sp.draw(f.x + 9, f.y + 14, f.ang, true); sp.draw(f.x, f.y, f.ang);
  }
  for (const e of S.en) if (e.layer === 'air' && e.t !== 'para') drawAir(e);
  for (const e of S.en) if (e.t === 'para') drawEnemy(e);
  ctx.globalAlpha = 1;
  // cloud shadows drift
  const ox = -(S.t * 5 % W), oy = -(S.t * 3 % H);
  ctx.drawImage(clouds, ox, oy); ctx.drawImage(clouds, ox + W * 2, oy); ctx.drawImage(clouds, ox, oy + H * 2); ctx.drawImage(clouds, ox + W * 2, oy + H * 2);

  // warnings
  for (const w of S.warns) {
    const x = clamp(w.x, 10, W - 10), y = clamp(w.y, 38, H - 100), on = (S.t * 4 | 0) % 2;
    ctx.fillStyle = on ? (w.air ? '#e0503c' : '#f0b840') : '#7a2a24';
    ctx.fillRect(x - 5 | 0, y - 5 | 0, 10, 10); ctx.fillStyle = '#0a1218'; ctx.fillRect(x - 1 | 0, y - 3 | 0, 2, 4); ctx.fillRect(x - 1 | 0, y + 2 | 0, 2, 2);
  }
  // build ghost
  if (S.tool && S.ghost) {
    const g = S.ghost, ok = canBuild(g.x, g.y) && S.oil >= T[S.tool].cost, sp = T[S.tool];
    if (sp.range) ring(g.x, g.y, sp.range, ok ? '#9fe7ff' : '#ff8a7a', S.t * .3, .8);
    ctx.globalAlpha = .75; ctx.fillStyle = ok ? '#6fd06a' : '#e0503c'; ctx.fillRect(g.x - 8 | 0, g.y - 8 | 0, 16, 16);
    ctx.globalAlpha = 1; ctx.fillStyle = '#3b3626'; ctx.fillRect(g.x - 6 | 0, g.y - 6 | 0, 12, 12);
    if (sp.spr) sp.spr.draw(g.x, g.y, 0);
    else { ctx.fillStyle = '#d6ae48'; ctx.fillRect(g.x - 5 | 0, g.y - 2 | 0, 8, 3); }
  }
  ctx.restore();
}

// ============================================================ placement & selection
function canBuild(x, y) {
  for (const [dx, dy] of [[0, 0], [-8, -8], [8, -8], [-8, 8], [8, 8]]) if (landAt(x + dx, y + dy) < 1) return false;
  if (Math.abs(x - HQX) < 32 && Math.abs(y - HQY) < 28) return false;
  if (y < 36 || y > H - 66) return false;
  for (const b of S.bld) if (dist(x, y, b.x, b.y) < 17) return false;
  return true;
}
function place(x, y) {
  const sp = T[S.tool];
  if (S.oil < sp.cost) return toast('Не хватает нефти');
  if (!canBuild(x, y)) return toast('Сюда строить нельзя');
  S.oil -= sp.cost; const b = addB(S.tool, x | 0, y | 0); S.ghost = null;
  for (let i = 0; i < 6; i++) S.parts.push({ x, y, vx: rnd(-14, 14), vy: rnd(-14, 14), life: 0, max: .5, sz: 2, k: 'foam' });
  if (S.oil < sp.cost) S.tool = null;
  refreshUI();
}
function select(b) { S.sel = b; if (b) S.tool = null; refreshUI(); }
const upCost = b => Math.round(T[b.k].cost * .7 * b.lvl);
const repCost = b => Math.ceil((b.max - b.hp) * (b === S.hq ? .35 : T[b.k].cost / b.max * .5));
const sellVal = b => Math.round(T[b.k].cost * .6 + (b.lvl - 1) * T[b.k].cost * .3);

// ============================================================ UI
const cards = $('cards'), selEl = $('sel');
const cardEls = {};
ORDER.forEach(k => {
  const d = document.createElement('button'); d.className = 'card';
  const c = mk(32, 32); const x = c.getContext('2d'); x.fillStyle = '#4a3f28'; x.fillRect(4, 4, 24, 24); x.fillStyle = '#8c7a4a'; x.fillRect(5, 5, 22, 22); x.fillStyle = '#3b3626'; x.fillRect(8, 8, 16, 16);
  if (T[k].spr) { const s = T[k].spr, f = s.frame(0); x.imageSmoothingEnabled = false; x.drawImage(f, 16 - f.width / 2 | 0, 16 - f.height / 2 | 0); }
  else { x.fillStyle = '#6c737d'; x.fillRect(8, 8, 16, 16); x.fillStyle = '#d6ae48'; x.fillRect(9, 14, 11, 4); x.fillStyle = '#2b2f36'; x.fillRect(20, 11, 3, 10); x.fillStyle = '#e8892b'; x.fillRect(9, 13, 3, 6); }
  d.appendChild(c); d.insertAdjacentHTML('beforeend', `<span class="nm">${T[k].name}</span><span class="co">${T[k].cost}</span>`);
  d.onclick = () => { if (S.over) return; S.sel = null; S.tool = S.tool === k ? null : k; S.ghost = null; refreshUI(); };
  cards.appendChild(d); cardEls[k] = d;
});
function refreshUI() {
  ORDER.forEach(k => { cardEls[k].classList.toggle('sel', S.tool === k); cardEls[k].classList.toggle('no', S.oil < T[k].cost); });
  const b = S.sel && S.bld.includes(S.sel) ? S.sel : null; if (!b) S.sel = null;
  cards.style.display = b ? 'none' : 'flex'; selEl.style.display = b ? 'flex' : 'none';
  if (b) {
    const nm = b.k === 'hq' ? 'НЕФТЕБАЗА' : T[b.k].name, rc = repCost(b);
    let h = `<div class="act info">${nm}${b.k !== 'hq' ? ' · УР.' + b.lvl : ''}<b>${Math.ceil(b.hp)}/${b.max | 0}</b></div>`;
    if (b.k !== 'hq' && b.lvl < 3) h += `<button class="act ${S.oil < upCost(b) ? 'no' : ''}" data-a="up">УЛУЧШИТЬ<b>${upCost(b)}</b></button>`;
    if (b.hp < b.max) h += `<button class="act ${S.oil < rc ? 'no' : ''}" data-a="rep">ЧИНИТЬ<b>${rc}</b></button>`;
    if (b.k !== 'hq') h += `<button class="act" data-a="sell">ПРОДАТЬ<b>+${sellVal(b)}</b></button>`;
    h += `<button class="act" data-a="x" style="min-width:calc(var(--u)*34)">✕</button>`;
    selEl.innerHTML = h; selEl.__b = b;
  }
}
selEl.addEventListener('click', ev => {
  const a = ev.target.closest('[data-a]'); if (!a) return; const b = selEl.__b, k = a.dataset.a;
  if (k === 'up' && S.oil >= upCost(b)) { S.oil -= upCost(b); b.lvl++; b.max = Math.round(b.max * 1.2); b.hp = b.max; sfx('hit'); }
  else if (k === 'rep' && S.oil >= repCost(b)) { S.oil -= repCost(b); b.hp = b.max; }
  else if (k === 'sell') { S.oil += sellVal(b); S.bld = S.bld.filter(q => q !== b); S.sel = null; }
  else if (k === 'x') S.sel = null;
  else toast('Не хватает нефти');
  refreshUI();
});
let toastT = 0;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 1200); }
let annT = 0;
function announce(t, s) { $('aT').textContent = t; $('aS').textContent = s || ''; $('announce').classList.add('show'); clearTimeout(annT); annT = setTimeout(() => $('announce').classList.remove('show'), 2600); }
function gameOver() {
  S.over = true; if (S.wave - 1 > S.best) { S.best = S.wave - 1; localStorage.setItem('idBest', S.best); }
  $('overTxt').innerHTML = `Волн отбито: <b>${Math.max(0, S.wave - 1)}</b><br>Уничтожено врагов: <b>${S.kills}</b><br>Рекорд: <b>${S.best}</b>`;
  $('over').style.display = 'flex';
}
let lastHud = '';
function hud() {
  const s = `${S.oil | 0}|${S.inc && S.inc.toFixed(1)}|${S.kills}|${S.wave}|${S.state}|${S.countdown | 0}`;
  if (s === lastHud) return; lastHud = s;
  $('oil').textContent = S.oil | 0; $('inc').textContent = '+' + (S.inc || 0).toFixed(1) + '/с'; $('kills').textContent = S.kills;
  $('waveLbl').textContent = S.state === 'break' ? 'ВОЛНА ' + (S.wave + 1) + ' ЧЕРЕЗ' : 'ВОЛНА ' + S.wave;
  $('tm').textContent = S.state === 'break' ? Math.max(0, Math.ceil(S.countdown)) + ' с' : 'ВРАГ ' + (S.en.length + S.events.length);
  $('skip').style.display = S.state === 'break' ? 'inline-block' : 'none';
  ORDER.forEach(k => cardEls[k].classList.toggle('no', S.oil < T[k].cost));
}
$('skip').onclick = () => { if (S.state === 'break') { S.oil += Math.ceil(S.countdown); startWave(); } };
$('bSpeed').onclick = () => { S.speed = S.speed === 1 ? 2 : 1; $('bSpeed').textContent = S.speed === 1 ? '▶' : '▶▶'; $('bSpeed').classList.toggle('on', S.speed === 2); };
$('bPause').onclick = () => { S.paused = !S.paused; $('bPause').classList.toggle('on', S.paused); };

// input
function toWorld(ev) { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * W, y: (ev.clientY - r.top) / r.height * H }; }
cv.addEventListener('pointermove', ev => { if (S.tool && ev.pointerType !== 'touch') { const p = toWorld(ev); S.ghost = { x: p.x | 0, y: p.y | 0 }; } });
cv.addEventListener('pointerdown', ev => {
  if (S.over || S.paused) return; const p = toWorld(ev);
  if (S.tool) {
    if (ev.pointerType === 'touch') {
      if (S.ghost && dist(p.x, p.y, S.ghost.x, S.ghost.y) < 16) place(S.ghost.x, S.ghost.y); else S.ghost = { x: p.x | 0, y: p.y | 0 };
    } else place(p.x | 0, p.y | 0);
    return;
  }
  let best = null, bd = 14;
  for (const b of S.bld) { const d = dist(p.x, p.y, b.x, b.y) - (b === S.hq ? 12 : 0); if (d < bd) { bd = d; best = b; } }
  select(best);
});
addEventListener('keydown', ev => {
  if (ev.key >= '1' && ev.key <= '5') { S.sel = null; S.tool = ORDER[+ev.key - 1]; refreshUI(); }
  else if (ev.key === 'Escape') { S.tool = null; S.sel = null; refreshUI(); }
  else if (ev.key === ' ') $('bPause').click();
});

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H), wr = $('wrap');
  wr.style.width = W * s + 'px'; wr.style.height = H * s + 'px'; document.documentElement.style.setProperty('--u', s + 'px');
}
addEventListener('resize', fit); fit();

// loop
let last = 0, started = false;
function frame(ts) {
  const dt = Math.min(.05, (ts - last) / 1000 || 0); last = ts;
  if (started && !S.over && !S.paused) { for (let i = 0; i < S.speed; i++) step(dt); }
  else if (!S.paused) { S.t += dt; }
  render(); hud();
  requestAnimationFrame(frame);
}
function begin() {
  started = true; $('intro').style.display = 'none'; $('over').style.display = 'none';
  try { if (!AU.ctx) AU.ctx = new (window.AudioContext || window.webkitAudioContext)(); AU.ctx.resume(); } catch (e) { }
}
$('bStart').onclick = begin;
$('bAgain').onclick = () => { reset(); begin(); };
reset();
requestAnimationFrame(frame);
window.__G = { S, step, begin, addB, startWave, place, T };
})();

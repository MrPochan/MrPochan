import { Game } from './game';
import { Input } from './input';

const required = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
};

const hpEl = required('hp');
const roomEl = required('room');
const overEl = required('over');

const game = new Game(required('game'));
const input = new Input();

const syncHud = (): void => {
  const { hp, maxHp, room } = game.hud;
  hpEl.textContent = '♥'.repeat(hp) + '♡'.repeat(maxHp - hp);
  roomEl.textContent = `Комната ${room}`;
  overEl.hidden = !game.over;
};

let last = performance.now();
const frame = (now: number): void => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  const controls = input.getControls();
  if (game.over && controls.fire) game.restart();
  game.update(dt, controls);
  game.render();
  syncHud();

  requestAnimationFrame(frame);
};

window.addEventListener('resize', () => game.resize(window.innerWidth, window.innerHeight));
requestAnimationFrame(frame);

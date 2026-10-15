// Phaser arena for the battle view. Draws placeholder shapes only and renders the events of the core
// battle through ArenaModel. Playback time and the pause for a resurrection decision are driven here.
import Phaser from 'phaser';
import type { BattleEvent, EnemySpec, HeroStats } from '@cupquest/core';
import { ArenaModel, type ArenaEffect, type UnitState } from './arenaModel.ts';
import { Playback } from '../lib/playback.ts';
import { enemyName, heroName } from '../i18n.ts';

export interface BattleGameOptions {
  readonly team: readonly HeroStats[];
  readonly enemies: readonly EnemySpec[];
  readonly events: readonly BattleEvent[];
  readonly speed: 1 | 2;
  /** Called for each event after it is drawn. Return 'pause' to stop until resumeWith is called. */
  readonly onEvent: (event: BattleEvent, index: number) => 'continue' | 'pause';
  readonly onFinished: () => void;
}

export interface BattleGameHandle {
  setSpeed(speed: 1 | 2): void;
  /** Continues playback with a (possibly new) event list that is identical up to `index`. */
  resumeWith(events: readonly BattleEvent[], index: number): void;
  destroy(): void;
}

const WIDTH = 360;
const HEIGHT = 300;
const ENEMY_Y = 86;
const HERO_Y = 226;
const FROG_Y = 158;

const HERO_COLORS: Record<string, number> = { knight: 0x4f8cff, archer: 0x59c17a, mage: 0xa86bff, druid: 0x2fb7b0 };
const ENEMY_COLORS: Record<string, number> = { grunt: 0xe0584f, brute: 0xb23b3b, captain: 0xf08a3c, boss: 0x6b2d6b };

interface Visual {
  readonly body: Phaser.GameObjects.Shape;
  readonly bar: Phaser.GameObjects.Shape | null;
  readonly x: number;
  readonly y: number;
}

class BattleScene extends Phaser.Scene {
  private model: ArenaModel | null = null;
  private playback: Playback<BattleEvent> | null = null;
  private visuals = new Map<string, Visual>();
  private finished = false;

  constructor(private readonly opts: BattleGameOptions) {
    super({ key: 'battle' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1b1d2a');
    this.model = new ArenaModel(this.opts.team, this.opts.enemies);
    this.playback = new Playback<BattleEvent>(this.opts.events, this.opts.speed);
    this.model.enemies.forEach((u) =>
      this.drawUnit(u, enemyX(u.slot), ENEMY_Y, ENEMY_COLORS[u.type] ?? 0xe0584f, 52, enemyName(u.type)),
    );
    this.model.heroes.forEach((u, i) => this.drawUnit(u, heroX(i), HERO_Y, HERO_COLORS[u.type] ?? 0x4f8cff, 48, heroName(u.type)));
  }

  update(_time: number, delta: number): void {
    const model = this.model;
    const playback = this.playback;
    if (!model || !playback || this.finished) return;
    const emitted = playback.advance(delta);
    for (const { index, event } of emitted) {
      const effect = model.apply(event);
      this.render(effect, model);
      if (event.e === 'death' && this.opts.onEvent(event, index) === 'pause') {
        playback.pause();
        return;
      }
    }
    if (playback.done && !this.finished) {
      this.finished = true;
      this.opts.onFinished();
    }
  }

  setSpeed(speed: 1 | 2): void {
    this.playback?.setSpeed(speed);
  }

  resumeWith(events: readonly BattleEvent[], index: number): void {
    this.playback?.resumeWith(events, index);
  }

  private drawUnit(u: UnitState, x: number, y: number, color: number, size: number, label: string): void {
    const body = this.add.rectangle(x, y, size, size, color).setStrokeStyle(2, 0xffffff, 0.15);
    const bar = this.add.rectangle(x - size / 2, y + size / 2 + 6, size, 5, 0x59c17a).setOrigin(0, 0.5);
    this.add.text(x, y - size / 2 - 8, label, { fontSize: '10px', color: '#f4f1e8' }).setOrigin(0.5);
    this.visuals.set(u.id, { body, bar, x, y });
  }

  private render(effect: ArenaEffect, model: ArenaModel): void {
    switch (effect.k) {
      case 'hit': {
        const from = this.visuals.get(effect.from);
        const to = this.visuals.get(effect.to);
        if (from && to) this.projectile(from, to, effect.splash);
        if (to) {
          const unit = model.unit(effect.to);
          if (unit) this.updateBar(to, unit);
          this.damageText(to, effect.dmg);
        }
        return;
      }
      case 'death': {
        const v = this.visuals.get(effect.id);
        if (v) {
          v.body.setAlpha(0.25);
          v.bar?.setVisible(false);
        }
        return;
      }
      case 'res': {
        const v = this.visuals.get(effect.id);
        const unit = model.unit(effect.id);
        if (v && unit) {
          v.body.setAlpha(1);
          this.updateBar(v, unit);
          v.bar?.setVisible(true);
        }
        return;
      }
      case 'summon': {
        const index = model.frogs.size - 1;
        const x = index % 2 === 0 ? 70 : 290;
        const body = this.add.circle(x, FROG_Y, 12, 0x7ee08a).setScale(0.2);
        this.tweens.add({ targets: body, scale: 1, duration: 200 });
        this.visuals.set(effect.id, { body, bar: null, x, y: FROG_Y });
        return;
      }
      case 'expire': {
        const v = this.visuals.get(effect.id);
        if (v) {
          this.tweens.add({ targets: v.body, alpha: 0, duration: 200, onComplete: () => v.body.destroy() });
          this.visuals.delete(effect.id);
        }
        return;
      }
      case 'phase': {
        const v = this.visuals.get(effect.id);
        if (v) this.floating(v.x, v.y - 34, `${effect.n}`, '#f5b942');
        return;
      }
      case 'end':
        return;
    }
  }

  private updateBar(v: Visual, unit: UnitState): void {
    const ratio = unit.maxKnown && unit.maxHp > 0 ? Math.max(0, unit.hp) / unit.maxHp : 1;
    v.bar?.setScale(Math.max(0, Math.min(1, ratio)), 1);
  }

  private projectile(from: Visual, to: Visual, splash: boolean): void {
    const dot = this.add.circle(from.x, from.y, splash ? 4 : 5, splash ? 0xffd166 : 0xffffff);
    this.tweens.add({
      targets: dot,
      x: to.x,
      y: to.y,
      duration: 160 / this.opts.speed,
      onComplete: () => dot.destroy(),
    });
  }

  private damageText(v: Visual, dmg: number): void {
    this.floating(v.x, v.y - 26, `-${dmg}`, '#ff8a80');
  }

  private floating(x: number, y: number, text: string, color: string): void {
    const label = this.add.text(x, y, text, { fontSize: '12px', color, fontStyle: 'bold' }).setOrigin(0.5);
    this.tweens.add({ targets: label, y: y - 16, alpha: 0, duration: 500, onComplete: () => label.destroy() });
  }
}

function enemyX(slot: number): number {
  return 36 + slot * 72;
}

function heroX(index: number): number {
  return 90 + index * 90;
}

/** Creates the battle game inside `parent`. The parent must be attached to the document. */
export function createBattleGame(parent: HTMLElement, opts: BattleGameOptions): BattleGameHandle {
  const scene = new BattleScene(opts);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: '#1b1d2a',
    audio: { noAudio: true },
    banner: false,
    disableContextMenu: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY, width: WIDTH, height: HEIGHT },
    scene: [scene],
  });
  return {
    setSpeed: (speed) => scene.setSpeed(speed),
    resumeWith: (events, index) => scene.resumeWith(events, index),
    destroy: () => game.destroy(true),
  };
}

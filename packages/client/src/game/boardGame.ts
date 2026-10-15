// Phaser board for the drop step (spec 6.5, UI-004, UI-005). The path of every column is drawn before the drop;
// the gate types are hidden until the ball lands. The ball moves along the path given by the core's drop event.
import Phaser from 'phaser';
import type { Board, FieldEvent, GateType } from '@cupquest/core';
import { columnForGridX, GRID_STEP } from '../lib/columns.ts';

export interface BoardGameOptions {
  readonly board: Board;
  readonly initialColumn: number;
  /** Fired when the cup changes column by drag or tap. */
  readonly onColumn: (column: number) => void;
}

export interface BoardGameHandle {
  setColumn(column: number): void;
  /** Plays the drop events of the core; `onLanded` runs when the gate event time has passed. */
  playDrop(events: readonly FieldEvent[], onLanded: (gate: GateType, balls: number) => void): void;
  destroy(): void;
}

const WIDTH = 360;
const HEIGHT = 330;
const CELLS = 9;
const CELL = 36;
const LEFT = (WIDTH - CELLS * CELL) / 2;
const CUP_Y = 22;
const GRID_TOP = 56;
const ROW_H = 26;
const GATE_Y = GRID_TOP + CELLS * ROW_H + 14;

const GATE_COLORS: Record<GateType, number> = { x0: 0x8a8fa3, x1: 0x7fb3ff, x2: 0x7ee08a, x3: 0xf5b942, x5: 0xff6b6b };

function cellX(gridX: number): number {
  return LEFT + (gridX + 0.5) * CELL;
}

function rowY(row: number): number {
  return GRID_TOP + (row + 0.5) * ROW_H;
}

interface Drop {
  readonly column: number;
  readonly path: readonly number[];
  readonly gate: GateType;
  readonly balls: number;
  readonly durationMs: number;
  readonly onLanded: (gate: GateType, balls: number) => void;
}

class BoardScene extends Phaser.Scene {
  private column: number;
  private cup: Phaser.GameObjects.Rectangle | null = null;
  private ball: Phaser.GameObjects.Arc | null = null;
  private routes: Phaser.GameObjects.Graphics | null = null;
  private gateLabels: Phaser.GameObjects.Text[] = [];
  private pending: Drop | null = null;
  private elapsedMs = 0;
  private landed = false;

  constructor(private readonly opts: BoardGameOptions) {
    super({ key: 'board' });
    this.column = opts.initialColumn;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1b1d2a');
    this.routes = this.add.graphics();
    this.drawRoutes();
    this.drawGateSlots();
    this.cup = this.add.rectangle(cellX(this.column * 2), CUP_Y, 30, 14, 0xf5b942).setStrokeStyle(2, 0xffffff, 0.3);
    this.ball = this.add.circle(cellX(this.column * 2), CUP_Y, 7, 0xffffff).setVisible(false);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerAt(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown) this.pointerAt(p);
    });
  }

  update(_time: number, delta: number): void {
    const drop = this.pending;
    if (!drop || this.landed || !this.ball) return;
    this.elapsedMs += delta;
    const progress = Math.min(1, this.elapsedMs / Math.max(1, drop.durationMs));
    const points = this.pathPoints(drop);
    const seg = Math.min(points.length - 2, Math.floor(progress * (points.length - 1)));
    const local = progress * (points.length - 1) - seg;
    const a = points[seg] ?? [cellX(0), CUP_Y];
    const b = points[seg + 1] ?? a;
    this.ball.setPosition(a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local);
    if (progress >= 1) {
      this.landed = true;
      this.revealGate(drop);
      drop.onLanded(drop.gate, drop.balls);
    }
  }

  setColumn(column: number): void {
    this.column = column;
    if (!this.cup) return;
    this.cup.setPosition(cellX(column * GRID_STEP), CUP_Y);
    this.ball?.setPosition(cellX(column * GRID_STEP), CUP_Y);
    this.drawRoutes();
  }

  playDrop(drop: Drop): void {
    this.pending = drop;
    this.elapsedMs = 0;
    this.landed = false;
    this.ball?.setVisible(true).setPosition(cellX(drop.column * GRID_STEP), CUP_Y);
    this.drawRoutes();
  }

  private pointerAt(p: Phaser.Input.Pointer): void {
    if (this.pending) return;
    const gridX = (p.x - LEFT) / CELL - 0.5;
    const column = columnForGridX(gridX);
    if (column !== this.column) {
      this.setColumn(column);
      this.opts.onColumn(column);
    }
  }

  private pathPoints(drop: Drop): [number, number][] {
    const points: [number, number][] = [[cellX(drop.column * GRID_STEP), CUP_Y]];
    drop.path.forEach((x, row) => points.push([cellX(x), rowY(row)]));
    const last = drop.path[drop.path.length - 1] ?? drop.column * GRID_STEP;
    points.push([cellX(last), GATE_Y]);
    return points;
  }

  private drawRoutes(): void {
    const g = this.routes;
    if (!g) return;
    g.clear();
    const { board } = this.opts;
    board.paths.forEach((path, col) => {
      const selected = col === this.column;
      g.lineStyle(selected ? 3 : 1.5, selected ? 0xf5b942 : 0x5b6280, selected ? 0.95 : 0.55);
      g.beginPath();
      g.moveTo(cellX(col * GRID_STEP), CUP_Y);
      path.forEach((x, row) => g.lineTo(cellX(x), rowY(row)));
      g.strokePath();
    });
  }

  private drawGateSlots(): void {
    this.gateLabels = this.opts.board.slots.map((slot) => {
      const text = this.add.text(cellX(slot), GATE_Y, '?', { fontSize: '14px', color: '#9aa0b8', fontStyle: 'bold' }).setOrigin(0.5);
      return text;
    });
  }

  private revealGate(drop: Drop): void {
    const label = this.gateLabels[drop.column];
    if (!label) return;
    label.setText(drop.gate).setColor(`#${GATE_COLORS[drop.gate].toString(16).padStart(6, '0')}`);
  }
}

/** Creates the board game inside `parent` (must be attached to the document). */
export function createBoardGame(parent: HTMLElement, opts: BoardGameOptions): BoardGameHandle {
  const scene = new BoardScene(opts);
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
    setColumn: (column) => scene.setColumn(column),
    playDrop: (events, onLanded) => {
      const drop = events.find((e) => e.e === 'drop');
      const gate = events.find((e) => e.e === 'gate');
      if (drop?.e !== 'drop' || gate?.e !== 'gate') return;
      scene.playDrop({
        column: drop.col,
        path: drop.path,
        gate: gate.gate,
        balls: gate.balls,
        durationMs: gate.ms,
        onLanded,
      });
    },
    destroy: () => game.destroy(true),
  };
}

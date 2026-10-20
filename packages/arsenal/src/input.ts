export interface Vec2 {
  x: number;
  y: number;
}

export interface Controls {
  /** Длина не больше 1. Ось y указывает вниз по экрану, то есть в сторону +z мира. */
  move: Vec2;
  /** Единичный вектор направления стрельбы, сохраняется между нажатиями. */
  aim: Vec2;
  fire: boolean;
}

const STICK_RADIUS = 56;
const STICK_DEAD_ZONE = 0.15;
const MOUSE_DEAD_ZONE = 10;

const MOVE_KEYS: Record<string, Vec2> = {
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

const AIM_KEYS: Record<string, Vec2> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

const addDirection = (acc: Vec2, x: number, y: number, minLength: number): void => {
  const length = Math.hypot(x, y);
  if (length === 0 || length <= minLength) return;
  acc.x += x / length;
  acc.y += y / length;
};

class Stick {
  readonly value: Vec2 = { x: 0, y: 0 };
  active = false;
  private pointerId = -1;
  private originX = 0;
  private originY = 0;
  private readonly ui: HTMLElement;
  private readonly knob: HTMLElement;

  constructor(private readonly zone: HTMLElement) {
    this.ui = document.createElement('div');
    this.ui.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.ui.append(this.knob);
    document.body.append(this.ui);

    zone.addEventListener('pointerdown', (e) => this.start(e));
    zone.addEventListener('pointermove', (e) => this.move(e));
    zone.addEventListener('pointerup', (e) => this.end(e));
    zone.addEventListener('pointercancel', (e) => this.end(e));
  }

  private start(e: PointerEvent): void {
    if (this.active) return;
    this.active = true;
    this.pointerId = e.pointerId;
    this.zone.setPointerCapture(e.pointerId);
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.ui.style.transform = `translate(${e.clientX - STICK_RADIUS}px, ${e.clientY - STICK_RADIUS}px)`;
    this.knob.style.transform = 'translate(0px, 0px)';
    this.ui.style.display = 'block';
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;
    const length = Math.hypot(dx, dy);
    const scale = length > STICK_RADIUS ? STICK_RADIUS / length : 1;
    const kx = dx * scale;
    const ky = dy * scale;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    this.value.x = kx / STICK_RADIUS;
    this.value.y = ky / STICK_RADIUS;
  }

  private end(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId) return;
    this.active = false;
    this.pointerId = -1;
    this.value.x = 0;
    this.value.y = 0;
    this.ui.style.display = 'none';
  }
}

export class Input {
  private readonly moveStick: Stick;
  private readonly aimStick: Stick;
  private readonly keys = new Set<string>();
  private readonly lastAim: Vec2 = { x: 0, y: -1 };
  private mouseX = 0;
  private mouseY = 0;
  private mouseFiring = false;

  constructor() {
    this.moveStick = new Stick(this.createZone('left'));
    this.aimStick = new Stick(this.createZone('right'));

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFiring = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.mouseFiring = true;
    });
    window.addEventListener('pointerup', () => {
      this.mouseFiring = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  getControls(): Controls {
    const move: Vec2 = { x: this.moveStick.value.x, y: this.moveStick.value.y };
    const aim: Vec2 = { x: 0, y: 0 };
    let fire = this.mouseFiring || this.aimStick.active || this.keys.has('Space');

    if (this.mouseFiring) {
      addDirection(aim, this.mouseX - window.innerWidth / 2, this.mouseY - window.innerHeight / 2, MOUSE_DEAD_ZONE);
    }
    if (this.aimStick.active) {
      addDirection(aim, this.aimStick.value.x, this.aimStick.value.y, STICK_DEAD_ZONE);
    }
    for (const code of this.keys) {
      const m = MOVE_KEYS[code];
      if (m) {
        move.x += m.x;
        move.y += m.y;
      }
      const a = AIM_KEYS[code];
      if (a) {
        addDirection(aim, a.x, a.y, 0);
        fire = true;
      }
    }

    const moveLength = Math.hypot(move.x, move.y);
    if (moveLength > 1) {
      move.x /= moveLength;
      move.y /= moveLength;
    }
    const aimLength = Math.hypot(aim.x, aim.y);
    if (aimLength > 0) {
      this.lastAim.x = aim.x / aimLength;
      this.lastAim.y = aim.y / aimLength;
    }
    return { move, aim: { ...this.lastAim }, fire };
  }

  private createZone(side: 'left' | 'right'): HTMLElement {
    const zone = document.createElement('div');
    zone.className = `zone ${side}`;
    document.body.append(zone);
    return zone;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!(e.code in MOVE_KEYS) && !(e.code in AIM_KEYS) && e.code !== 'Space') return;
    e.preventDefault();
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
  }
}

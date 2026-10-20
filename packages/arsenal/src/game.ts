import * as THREE from 'three';
import type { Controls } from './input';

const ROOM_HALF = 8;
const WALL_HEIGHT = 1.2;
const WALL_THICKNESS = 0.6;
const PLAYER_SPEED = 6;
const PLAYER_RADIUS = 0.5;
const MAX_HP = 5;
const FIRE_INTERVAL = 0.25;
const SHOT_SPEED = 16;
const SHOT_LIFE = 1.2;
const SHOT_RADIUS = 0.16;
const SHOT_DAMAGE = 1;
const ENEMY_RADIUS = 0.5;
const CONTACT_COOLDOWN = 0.8;
const CLEAR_DELAY = 1.2;

interface Enemy {
  mesh: THREE.Mesh;
  hp: number;
  speed: number;
}

interface Shot {
  mesh: THREE.Mesh;
  vx: number;
  vz: number;
  life: number;
}

export interface HudState {
  hp: number;
  maxHp: number;
  room: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class Game {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private readonly player: THREE.Mesh;
  private readonly enemyGeometry = new THREE.IcosahedronGeometry(ENEMY_RADIUS, 0);
  private readonly enemyMaterial = new THREE.MeshStandardMaterial({ color: 0xe0484f, flatShading: true });
  private readonly shotGeometry = new THREE.SphereGeometry(SHOT_RADIUS, 8, 6);
  private readonly shotMaterial = new THREE.MeshBasicMaterial({ color: 0xffd166 });
  private readonly pos = { x: 0, z: 0 };
  private enemies: Enemy[] = [];
  private shots: Shot[] = [];
  private hp = MAX_HP;
  private room = 1;
  private cooldown = 0;
  private invuln = 0;
  private clearTimer = 0;
  private time = 0;
  private isOver = false;

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x0d0e16);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(4, 10, 6);
    this.scene.add(sun);

    this.buildRoom();

    this.player = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 0.6, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x4cc9f0, flatShading: true }),
    );
    this.player.position.y = 0.7;
    this.scene.add(this.player);

    this.resize(window.innerWidth, window.innerHeight);
    this.spawnWave();
  }

  get over(): boolean {
    return this.isOver;
  }

  get hud(): HudState {
    return { hp: this.hp, maxHp: MAX_HP, room: this.room };
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Камера смотрит на центр комнаты и отодвигается, пока вся комната не влезет в кадр, в том числе на узком экране телефона.
    const distance = 24 * Math.max(1, 1 / this.camera.aspect);
    const k = distance / Math.hypot(16, 11);
    this.camera.position.set(0, 16 * k, 11 * k);
    this.camera.lookAt(0, 0, 0);
  }

  restart(): void {
    for (const enemy of this.enemies) this.scene.remove(enemy.mesh);
    for (const shot of this.shots) this.scene.remove(shot.mesh);
    this.enemies = [];
    this.shots = [];
    this.pos.x = 0;
    this.pos.z = 0;
    this.hp = MAX_HP;
    this.room = 1;
    this.cooldown = 0;
    this.invuln = 0;
    this.clearTimer = 0;
    this.isOver = false;
    this.spawnWave();
  }

  update(dt: number, c: Controls): void {
    if (this.isOver) return;
    this.time += dt;
    this.updatePlayer(dt, c.move);
    this.updateFire(dt, c);
    this.updateShots(dt);
    this.updateEnemies(dt);
    this.updateWaves(dt);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private buildRoom(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x2b2d42 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(ROOM_HALF * 2, ROOM_HALF * 2, 0x4a4e69, 0x3a3d56);
    grid.position.y = 0.01;
    this.scene.add(grid);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x566079 });
    const edge = ROOM_HALF + WALL_THICKNESS / 2;
    const span = edge * 2;
    const addWall = (x: number, z: number, w: number, d: number): void => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), wallMaterial);
      wall.position.set(x, WALL_HEIGHT / 2, z);
      this.scene.add(wall);
    };
    addWall(0, -edge, span, WALL_THICKNESS);
    addWall(0, edge, span, WALL_THICKNESS);
    addWall(-edge, 0, WALL_THICKNESS, span);
    addWall(edge, 0, WALL_THICKNESS, span);
  }

  private updatePlayer(dt: number, move: Controls['move']): void {
    const limit = ROOM_HALF - PLAYER_RADIUS;
    this.pos.x = clamp(this.pos.x + move.x * PLAYER_SPEED * dt, -limit, limit);
    this.pos.z = clamp(this.pos.z + move.y * PLAYER_SPEED * dt, -limit, limit);
    this.player.position.x = this.pos.x;
    this.player.position.z = this.pos.z;

    this.invuln = Math.max(0, this.invuln - dt);
    this.player.visible = this.invuln <= 0 || Math.floor(this.time * 16) % 2 === 0;
  }

  private updateFire(dt: number, c: Controls): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!c.fire || this.cooldown > 0) return;

    this.cooldown = FIRE_INTERVAL;
    const mesh = new THREE.Mesh(this.shotGeometry, this.shotMaterial);
    mesh.position.set(this.pos.x, 0.8, this.pos.z);
    this.scene.add(mesh);
    this.shots.push({ mesh, vx: c.aim.x * SHOT_SPEED, vz: c.aim.y * SHOT_SPEED, life: SHOT_LIFE });
  }

  private updateShots(dt: number): void {
    this.shots = this.shots.filter((shot) => {
      const p = shot.mesh.position;
      p.x += shot.vx * dt;
      p.z += shot.vz * dt;
      shot.life -= dt;

      const hit = this.enemies.find(
        (e) => Math.hypot(e.mesh.position.x - p.x, e.mesh.position.z - p.z) < ENEMY_RADIUS + SHOT_RADIUS,
      );
      if (hit) hit.hp -= SHOT_DAMAGE;

      const outside = Math.abs(p.x) > ROOM_HALF || Math.abs(p.z) > ROOM_HALF;
      if (hit || outside || shot.life <= 0) {
        this.scene.remove(shot.mesh);
        return false;
      }
      return true;
    });
  }

  private updateEnemies(dt: number): void {
    this.enemies = this.enemies.filter((enemy) => {
      if (enemy.hp <= 0) {
        this.scene.remove(enemy.mesh);
        return false;
      }
      const m = enemy.mesh.position;
      const dx = this.pos.x - m.x;
      const dz = this.pos.z - m.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0) {
        m.x += (dx / dist) * enemy.speed * dt;
        m.z += (dz / dist) * enemy.speed * dt;
      }
      enemy.mesh.rotation.y += dt * 2;
      return true;
    });

    const touching = this.enemies.some(
      (e) => Math.hypot(e.mesh.position.x - this.pos.x, e.mesh.position.z - this.pos.z) < PLAYER_RADIUS + ENEMY_RADIUS,
    );
    if (touching && this.invuln <= 0) {
      this.hp -= 1;
      this.invuln = CONTACT_COOLDOWN;
      if (this.hp <= 0) this.isOver = true;
    }
  }

  private updateWaves(dt: number): void {
    if (this.enemies.length > 0) {
      this.clearTimer = 0;
      return;
    }
    this.clearTimer += dt;
    if (this.clearTimer < CLEAR_DELAY) return;

    this.clearTimer = 0;
    this.room += 1;
    this.hp = Math.min(MAX_HP, this.hp + 1);
    this.spawnWave();
  }

  private spawnWave(): void {
    const count = 2 + this.room;
    const hp = 1 + Math.floor(this.room / 3);
    const speed = Math.min(1.8 + this.room * 0.15, 4);
    for (let i = 0; i < count; i++) {
      const p = this.randomSpawnPoint();
      const mesh = new THREE.Mesh(this.enemyGeometry, this.enemyMaterial);
      mesh.position.set(p.x, ENEMY_RADIUS, p.z);
      mesh.scale.setScalar(1 + 0.15 * (hp - 1));
      this.scene.add(mesh);
      this.enemies.push({ mesh, hp, speed });
    }
  }

  private randomSpawnPoint(): { x: number; z: number } {
    const range = ROOM_HALF - 1;
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = (Math.random() * 2 - 1) * range;
      const z = (Math.random() * 2 - 1) * range;
      if (Math.hypot(x - this.pos.x, z - this.pos.z) > 4) return { x, z };
    }
    return { x: range, z: range };
  }
}

import * as THREE from 'three';
import {
  BUILDING_DEFS,
  BuildingType,
  CELL_SIZE,
  getEffectiveSize,
  isRoad,
  type CityState,
  type PlacedBuilding,
} from '@cityzen/shared';
import type { SceneManager } from '../scene/SceneManager.js';
import type { CameraController } from '../scene/CameraController.js';
import { createCarMesh, disposeCarMesh, type CarManager } from './CarManager.js';

// All distances in cells, speeds in cells per second, angles in radians.
const PLAYER_COLOR = 0xf4511e;
const CAR_Y = 0.03;
const HALF_LEN = 0.24;
const HALF_WIDTH = 0.11;
/** Traffic cars are pushed apart from the player's below this centre distance. */
const BUMP_DIST = 0.42;

const ACCEL = 3.2;
const BRAKE = 9;
const HANDBRAKE = 12;
const COAST = 1.1;
const MAX_REVERSE = 1.8;
const OFFROAD_MAX = 1.4;
const OFFROAD_DRAG = 5;
/** Top speed on a road with speed multiplier m is BASE_TOP + m * TOP_PER_MULT. */
const BASE_TOP = 3.2;
const TOP_PER_MULT = 1.3;
const WHEELBASE = 0.45;
const MAX_STEER = 0.6;
const STEER_RATE = 6;
/** Largest distance moved per collision substep. */
const SUBSTEP = 0.08;
/** How far from a clicked spot, in cells, the car may be placed on a road. */
const MAX_PICK_DISTANCE = 6;
/** Displayed speed: one cell is roughly 5 m. */
const KMH_PER_CELL_S = 18;

/** Minimap: pixels per cell in the cached city image, and cells from centre to rim. */
const MAP_PX_PER_CELL = 4;
const MAP_RADIUS_CELLS = 14;
const MAP_COLORS = {
  outside: '#2b3a30',
  ground: '#b9cc98',
  road: '#4d5157',
  residential: '#79b46a',
  commercial: '#5b8fd4',
  industrial: '#d4ae4a',
  service: '#c98d6b',
  water: '#5c9fd2',
  steep: '#a88f63',
};

type Surface = 'road' | 'ground' | 'solid';
type CameraMode = 'chase' | 'hood' | 'high';
const CAMERA_MODES: CameraMode[] = ['chase', 'hood', 'high'];

interface Controls {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
}

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, select, textarea, [contenteditable="true"]');

/**
 * Drive mode: the player takes a car through their own city. Arcade handling,
 * buildings and water are solid, grass is slow, and traffic queues behind you.
 */
export class DriveMode {
  private active = false;
  private mesh: THREE.Group | null = null;
  private x = 0;
  private z = 0;
  /** Heading; the car's nose points along (cos yaw, -sin yaw). */
  private yaw = 0;
  private v = 0;
  private steer = 0;
  private surface: Surface = 'road';
  private keys: Controls = { up: false, down: false, left: false, right: false, brake: false };
  private touch: Controls = { up: false, down: false, left: false, right: false, brake: false };

  private cameraMode: CameraMode = 'chase';
  private camYaw = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private snapCamera = true;

  private state: CityState | null = null;
  private typeById = new Map<string, BuildingType>();
  private indexedBuildings: readonly PlacedBuilding[] | null = null;
  private indexedCount = -1;

  private hud: HTMLDivElement;
  private speedEl: HTMLSpanElement;
  private minimap: HTMLCanvasElement;
  private cityImage = document.createElement('canvas');

  /** Called whenever drive mode ends. */
  onExit: (() => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private sceneManager: SceneManager,
    private cameraController: CameraController,
    private carManager: CarManager,
    parent: HTMLElement,
  ) {
    this.hud = document.createElement('div');
    this.hud.className = 'drive-hud';
    this.hud.hidden = true;

    const gauge = document.createElement('div');
    gauge.className = 'drive-gauge';
    this.speedEl = document.createElement('span');
    this.speedEl.className = 'drive-speed';
    this.speedEl.textContent = '0';
    const unit = document.createElement('span');
    unit.className = 'drive-unit';
    unit.textContent = 'km/h';
    gauge.append(this.speedEl, unit);

    const hint = document.createElement('div');
    hint.className = 'drive-hint';
    hint.textContent = 'W/S or ↑/↓ drive · A/D or ←/→ steer · Space brake · V camera · Esc exit';

    const exit = document.createElement('button');
    exit.className = 'hud-button drive-exit';
    exit.textContent = 'Exit car';
    exit.addEventListener('click', () => this.stop());

    const pad = document.createElement('div');
    pad.className = 'drive-touch';
    const button = (label: string, key: keyof Controls, cls: string) => {
      const b = document.createElement('button');
      b.className = `drive-touch-button ${cls}`;
      b.textContent = label;
      b.setAttribute('aria-label', key);
      const set = (on: boolean) => (e: PointerEvent) => {
        e.preventDefault();
        this.touch[key] = on;
        if (on) b.setPointerCapture(e.pointerId);
      };
      b.addEventListener('pointerdown', set(true));
      b.addEventListener('pointerup', set(false));
      b.addEventListener('pointercancel', set(false));
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };
    pad.append(
      button('◀', 'left', 'drive-touch-left'),
      button('▶', 'right', 'drive-touch-right'),
      button('▼', 'down', 'drive-touch-down'),
      button('▲', 'up', 'drive-touch-up'),
    );

    this.minimap = document.createElement('canvas');
    this.minimap.className = 'drive-minimap';
    this.minimap.setAttribute('aria-hidden', 'true');

    this.hud.append(this.minimap, gauge, hint, exit, pad);
    parent.appendChild(this.hud);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseControls());
  }

  isActive(): boolean {
    return this.active;
  }

  /**
   * Puts a car on the road nearest a ground point (in cells), or nearest the
   * view without one. Returns false if there is no road close enough.
   */
  start(state: CityState, at?: { x: number; z: number }): boolean {
    if (this.active) return true;
    this.state = state;
    this.indexBuildings(state);

    const start = this.findStart(state, at);
    if (!start) return false;
    this.x = start.x;
    this.z = start.z;
    this.yaw = start.yaw;
    this.v = 0;
    this.steer = 0;
    this.releaseControls();

    this.mesh = createCarMesh(PLAYER_COLOR);
    this.scene.add(this.mesh);
    this.placeMesh();

    this.active = true;
    this.cameraMode = 'chase';
    this.camYaw = this.yaw;
    this.snapCamera = true;
    this.sceneManager.setCloseUp(true);
    this.carManager.setPlayer({ x: this.x, z: this.z, yaw: this.yaw, v: this.v });
    this.hud.hidden = false;
    document.body.classList.add('driving');
    return true;
  }

  /** Parks the car and hands the view back to the city camera, over where the car stopped. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.releaseControls();
    if (this.mesh) {
      this.scene.remove(this.mesh);
      disposeCarMesh(this.mesh);
      this.mesh = null;
    }
    this.carManager.setPlayer(null);
    this.sceneManager.setCloseUp(false);
    this.sceneManager.setPerspective(this.cameraController.isPerspectiveView());
    this.cameraController.lookAt(this.x * CELL_SIZE, this.z * CELL_SIZE);
    this.hud.hidden = true;
    document.body.classList.remove('driving');
    this.state = null;
    this.onExit?.();
  }

  update(deltaTime: number, state: CityState | null): void {
    if (!this.active) return;
    if (!state) {
      this.stop();
      return;
    }
    this.state = state;
    this.indexBuildings(state);

    const dt = Math.min(deltaTime, 0.05);
    this.drive(dt);
    this.bumpTraffic();
    this.placeMesh();
    this.carManager.setPlayer({ x: this.x, z: this.z, yaw: this.yaw, v: this.v });
    this.updateCamera(dt);
    this.drawMinimap();
    this.speedEl.textContent = String(Math.round(Math.abs(this.v) * KMH_PER_CELL_S));
  }

  cycleCamera(): void {
    this.cameraMode = CAMERA_MODES[(CAMERA_MODES.indexOf(this.cameraMode) + 1) % CAMERA_MODES.length];
    this.snapCamera = true;
  }

  // ── Input ─────────────────────────────────────────────────

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.active) return;
    if (down && (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey)) return;
    const k = this.keys;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': k.up = down; break;
      case 'KeyS': case 'ArrowDown': k.down = down; break;
      case 'KeyA': case 'ArrowLeft': k.left = down; break;
      case 'KeyD': case 'ArrowRight': k.right = down; break;
      case 'Space': k.brake = down; break;
      case 'KeyV':
        if (down && !e.repeat) this.cycleCamera();
        break;
      default: return;
    }
    // Keep arrows/space from scrolling or pressing a focused button.
    e.preventDefault();
  }

  private releaseControls(): void {
    for (const c of [this.keys, this.touch]) c.up = c.down = c.left = c.right = c.brake = false;
  }

  // ── World ─────────────────────────────────────────────────

  private indexBuildings(state: CityState): void {
    if (state.buildings === this.indexedBuildings && state.buildings.length === this.indexedCount) return;
    this.indexedBuildings = state.buildings;
    this.indexedCount = state.buildings.length;
    this.typeById.clear();
    for (const b of state.buildings) this.typeById.set(b.id, b.type);
    this.paintCityImage(state);
  }

  private surfaceAt(x: number, z: number): Surface {
    const grid = this.state?.grid;
    if (!grid) return 'solid';
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= grid.length || cz >= grid[cx].length) return 'solid';
    const cell = grid[cx][cz];
    if (cell.terrain === 'water') return 'solid';
    if (cell.buildingId) {
      const type = this.typeById.get(cell.buildingId);
      if (type) return isRoad(type) ? 'road' : 'solid';
    }
    return cell.terrain ? 'solid' : 'ground';
  }

  private roadSpeedAt(x: number, z: number): number {
    const grid = this.state?.grid;
    const id = grid?.[Math.floor(x)]?.[Math.floor(z)]?.buildingId;
    const type = id ? this.typeById.get(id) : undefined;
    const mult = type ? BUILDING_DEFS[type].speedMultiplier ?? 1 : 1;
    return BASE_TOP + mult * TOP_PER_MULT;
  }

  /** Whether the car's footprint at this pose touches anything solid. */
  private blocked(x: number, z: number, yaw: number): boolean {
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const rx = -fz, rz = fx;
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0]]) {
      const px = x + fx * HALF_LEN * a + rx * HALF_WIDTH * b;
      const pz = z + fz * HALF_LEN * a + rz * HALF_WIDTH * b;
      if (this.surfaceAt(px, pz) === 'solid') return true;
    }
    return false;
  }

  private findStart(state: CityState, at?: { x: number; z: number }): { x: number; z: number; yaw: number } | null {
    const target = this.cameraController.getTarget();
    const tx = at ? at.x : target.x / CELL_SIZE;
    const tz = at ? at.z : target.z / CELL_SIZE;
    let best: { x: number; z: number; yaw: number } | null = null;
    // A picked spot has to be near a road; otherwise any road will do.
    let bestDist = at ? MAX_PICK_DISTANCE ** 2 : Infinity;
    for (const b of state.buildings) {
      if (!isRoad(b.type)) continue;
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      const x = b.position.x + w / 2;
      const z = b.position.z + d / 2;
      const dist = (x - tx) ** 2 + (z - tz) ** 2;
      if (dist >= bestDist) continue;
      // Pointing along the road: an NS road runs along z.
      const yaw = b.orientation === 'NS' ? -Math.PI / 2 : 0;
      if (this.blocked(x, z, yaw)) continue;
      best = { x, z, yaw };
      bestDist = dist;
    }
    return best;
  }

  // ── Physics ───────────────────────────────────────────────

  private drive(dt: number): void {
    const up = this.keys.up || this.touch.up;
    const down = this.keys.down || this.touch.down;
    const brake = this.keys.brake || this.touch.brake;
    const steerInput = Number(this.keys.left || this.touch.left) - Number(this.keys.right || this.touch.right);

    this.surface = this.surfaceAt(this.x, this.z);
    const top = this.surface === 'road' ? this.roadSpeedAt(this.x, this.z) : OFFROAD_MAX;

    let v = this.v;
    const toward = (target: number, rate: number) => {
      v = v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);
    };
    if (brake) toward(0, HANDBRAKE);
    else if (up) v < 0 ? toward(0, BRAKE) : toward(top, ACCEL);
    else if (down) v > 0 ? toward(0, BRAKE) : toward(-MAX_REVERSE, ACCEL * 0.7);
    else toward(0, COAST);
    // Over the limit (left a highway, or ran onto the grass): bleed speed off.
    if (v > top) v = Math.max(top, v - (this.surface === 'road' ? COAST * 3 : OFFROAD_DRAG) * dt);
    if (v < -MAX_REVERSE) v = -MAX_REVERSE;
    this.v = v;

    // Less lock at speed keeps the car on a one-cell street.
    const maxSteer = MAX_STEER / (1 + Math.abs(v) * 0.25);
    const steerTarget = steerInput * maxSteer;
    const steerStep = STEER_RATE * maxSteer * dt;
    this.steer += THREE.MathUtils.clamp(steerTarget - this.steer, -steerStep, steerStep);

    const yawRate = (v * Math.tan(this.steer)) / WHEELBASE;
    const distance = Math.abs(v * dt);
    const steps = Math.max(1, Math.ceil(distance / SUBSTEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, yawRate);
  }

  private step(h: number, yawRate: number): void {
    const yaw = this.yaw + yawRate * h;
    if (!this.blocked(this.x, this.z, yaw)) this.yaw = yaw;

    const dx = Math.cos(this.yaw) * this.v * h;
    const dz = -Math.sin(this.yaw) * this.v * h;
    if (!this.blocked(this.x + dx, this.z + dz, this.yaw)) {
      this.x += dx;
      this.z += dz;
      return;
    }
    // Scrape along the wall on whichever axis is free.
    const slideX = Math.abs(dx) > 1e-5 && !this.blocked(this.x + dx, this.z, this.yaw);
    const slideZ = !slideX && Math.abs(dz) > 1e-5 && !this.blocked(this.x, this.z + dz, this.yaw);
    if (slideX) this.x += dx;
    else if (slideZ) this.z += dz;
    if (slideX || slideZ) {
      this.v *= 0.96;
    } else {
      // Head-on: bounce back a little.
      this.v *= -0.25;
    }
  }

  /** Shove apart from traffic cars rather than driving through them. */
  private bumpTraffic(): void {
    for (const car of this.carManager.getCars()) {
      if (car.leaving >= 0) continue;
      let nx = this.x - car.x;
      let nz = this.z - car.z;
      const d = Math.hypot(nx, nz);
      if (d >= BUMP_DIST || d < 1e-6) continue;
      nx /= d;
      nz /= d;
      const push = BUMP_DIST - d;
      if (!this.blocked(this.x + nx * push, this.z + nz * push, this.yaw)) {
        this.x += nx * push;
        this.z += nz * push;
      }
      // Moving into the other car: lose most of the speed.
      const vx = Math.cos(this.yaw) * this.v;
      const vz = -Math.sin(this.yaw) * this.v;
      if (vx * nx + vz * nz < 0) this.v *= -0.3;
    }
  }

  // ── Presentation ──────────────────────────────────────────

  private placeMesh(): void {
    if (!this.mesh) return;
    this.mesh.position.set(this.x * CELL_SIZE, CAR_Y, this.z * CELL_SIZE);
    this.mesh.rotation.y = this.yaw;
  }

  /** One pixel block per cell; redrawn only when the city changes. */
  private paintCityImage(state: CityState): void {
    const size = state.grid.length;
    const img = this.cityImage;
    img.width = img.height = size * MAP_PX_PER_CELL;
    const ctx = img.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = MAP_COLORS.ground;
    ctx.fillRect(0, 0, img.width, img.height);
    for (let x = 0; x < size; x++) {
      for (let z = 0; z < size; z++) {
        const cell = state.grid[x][z];
        let color: string | null = null;
        if (cell.terrain) color = MAP_COLORS[cell.terrain];
        else if (cell.buildingId) {
          const type = this.typeById.get(cell.buildingId);
          if (!type) continue;
          if (isRoad(type)) color = MAP_COLORS.road;
          else if (type === BuildingType.ZONE_RESIDENTIAL) color = MAP_COLORS.residential;
          else if (type === BuildingType.ZONE_COMMERCIAL) color = MAP_COLORS.commercial;
          else if (type === BuildingType.ZONE_INDUSTRIAL) color = MAP_COLORS.industrial;
          else color = MAP_COLORS.service;
        }
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * MAP_PX_PER_CELL, z * MAP_PX_PER_CELL, MAP_PX_PER_CELL, MAP_PX_PER_CELL);
      }
    }
  }

  /** Heading-up map around the car, with traffic and a north marker. */
  private drawMinimap(): void {
    const canvas = this.minimap;
    const css = canvas.clientWidth;
    if (!css) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(css * dpr);
    if (canvas.width !== px) canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const r = css / 2;
    const scale = r / MAP_RADIUS_CELLS;
    // Turn the map so the car's nose, (cos yaw, -sin yaw) on the canvas, points up.
    const turn = this.yaw - Math.PI / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = MAP_COLORS.outside;
    ctx.fillRect(0, 0, css, css);

    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(turn);
    ctx.scale(scale, scale);
    ctx.translate(-this.x, -this.z);
    const size = this.state?.grid.length ?? 0;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.cityImage, 0, 0, size, size);
    ctx.fillStyle = '#f5f5f0';
    for (const car of this.carManager.getCars()) {
      if (Math.abs(car.x - this.x) > MAP_RADIUS_CELLS * 1.5 || Math.abs(car.z - this.z) > MAP_RADIUS_CELLS * 1.5) continue;
      ctx.beginPath();
      ctx.arc(car.x, car.z, 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // The player's car: an arrow pointing up.
    ctx.translate(r, r);
    ctx.fillStyle = '#ff6d3a';
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(6, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // North (-z) sits at canvas angle -90° before the map is turned.
    const north = -Math.PI / 2 + turn;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const nx = r + Math.cos(north) * (r - 10);
    const ny = r + Math.sin(north) * (r - 10);
    ctx.fillStyle = '#192720';
    ctx.beginPath();
    ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8a80';
    ctx.fillText('N', nx, ny + 0.5);
  }

  private updateCamera(dt: number): void {
    const camera = this.sceneManager.camera;
    const cx = this.x * CELL_SIZE;
    const cz = this.z * CELL_SIZE;
    this.camYaw += angleDelta(this.camYaw, this.yaw) * (this.snapCamera ? 1 : 1 - Math.exp(-dt * 5));
    const fx = Math.cos(this.camYaw), fz = -Math.sin(this.camYaw);

    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    if (this.cameraMode === 'hood') {
      const hx = Math.cos(this.yaw), hz = -Math.sin(this.yaw);
      pos.set(cx + hx * 0.06, 0.24, cz + hz * 0.06);
      look.set(cx + hx * 3, 0.16, cz + hz * 3);
      this.camPos.copy(pos);
      this.camLook.copy(look);
    } else {
      const [back, height, ahead] = this.cameraMode === 'chase' ? [1.25, 0.5, 1.1] : [3.2, 3.2, 0.6];
      pos.set(cx - fx * back * CELL_SIZE, height * CELL_SIZE, cz - fz * back * CELL_SIZE);
      look.set(cx + fx * ahead * CELL_SIZE, 0.12, cz + fz * ahead * CELL_SIZE);
      const ease = this.snapCamera ? 1 : 1 - Math.exp(-dt * 10);
      this.camPos.lerp(pos, ease);
      this.camLook.lerp(look, ease);
    }
    this.snapCamera = false;

    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    camera.updateMatrixWorld();
  }
}

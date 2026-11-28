import * as THREE from 'three';
import { BuildingType, CELL_SIZE, isRoad, type CityState } from '@cityzen/shared';
import type { SceneManager } from '../../scene/SceneManager.js';
import type { CameraController } from '../../scene/CameraController.js';
import type { CarManager } from '../CarManager.js';
import type { BoatManager } from '../BoatManager.js';
import type { ObstacleMap } from './ObstacleMap.js';
import { ExploreWorld } from './ExploreWorld.js';
import { CarTraveller } from './CarTraveller.js';
import { WalkTraveller } from './WalkTraveller.js';
import { FlyTraveller } from './FlyTraveller.js';
import { BoatTraveller } from './BoatTraveller.js';
import { RideTraveller } from './RideTraveller.js';
import type { CameraShot, ExploreInput, ExploreKind, Handoff, Traveller } from './types.js';

export type { ExploreKind } from './types.js';

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

interface ModeInfo {
  hint: string;
  exit: string;
  /** Extra touch buttons beside the arrows: [label, control]. */
  touch: Array<[string, 'action' | 'shift' | 'use']>;
}

export const EXPLORE_MODES: Record<ExploreKind, ModeInfo & { label: string; key: string; pick: string; none: string }> = {
  drive: {
    label: 'Drive', key: 'C', pick: 'Click a road on the map to start driving', none: 'No road there. Click closer to a road',
    hint: 'W/S or ↑/↓ drive · A/D or ←/→ steer · Space brake · V camera · Esc exit',
    exit: 'Exit car', touch: [['Brake', 'action']],
  },
  walk: {
    label: 'Walk', key: 'G', pick: 'Click anywhere on the map to start walking', none: 'Nowhere to stand there. Click somewhere else',
    hint: 'W/S walk · A/D turn · drag to look · Shift run · Space jump · E ride a passing car · V camera · Esc exit',
    exit: 'Stop walking', touch: [['Run', 'shift'], ['Jump', 'action'], ['Ride', 'use']],
  },
  fly: {
    label: 'Fly', key: 'H', pick: 'Click anywhere on the map to take off', none: 'Cannot take off there',
    hint: 'W/S fly · A/D turn · Space climb · Shift descend · V camera · Esc exit',
    exit: 'Land and exit', touch: [['Up', 'action'], ['Down', 'shift']],
  },
  boat: {
    label: 'Boat', key: 'N', pick: 'Click on water to launch the boat', none: 'No open water there. Click closer to water',
    hint: 'W/S throttle · A/D steer · Space stop · V camera · Esc exit',
    exit: 'Leave boat', touch: [['Stop', 'action']],
  },
  ride: {
    label: 'Ride along', key: 'J', pick: 'Click a car, bus, truck or boat to ride along', none: 'No vehicle there. Click right on one',
    hint: 'Drag to look · Space jump to the next vehicle · E get out · V camera · Esc exit',
    exit: 'Stop riding', touch: [['Jump', 'action'], ['Get out', 'use']],
  },
};

const isTyping = (target: EventTarget | null) =>
  target instanceof Element && !!target.closest('input, select, textarea, [contenteditable="true"]');

type Held = Omit<ExploreInput, 'lookX' | 'lookY' | 'use'>;
const idle = (): Held => ({ forward: false, back: false, left: false, right: false, action: false, shift: false });

/**
 * Explore mode: the player takes a car, goes on foot, flies a helicopter or
 * steers a boat through their own city.
 */
export class ExploreMode {
  private traveller: Traveller | null = null;
  private world: ExploreWorld;
  private keys = idle();
  private touch = idle();
  private look = { x: 0, y: 0 };
  /** E was pressed (or the touch button tapped) since the last frame. */
  private usePending = false;
  private dragging: number | null = null;
  private dragFrom = { x: 0, y: 0 };

  private view = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private shot: CameraShot = { position: new THREE.Vector3(), look: new THREE.Vector3(), rigid: false };
  private snapCamera = true;

  private hud: HTMLDivElement;
  private speedEl: HTMLSpanElement;
  private unitEl: HTMLSpanElement;
  private hintEl: HTMLDivElement;
  private exitEl: HTMLButtonElement;
  private extraTouch: HTMLDivElement;
  private minimap: HTMLCanvasElement;
  private cityImage = document.createElement('canvas');

  /** Called whenever explore mode ends. */
  onExit: (() => void) | null = null;
  /** Called when the trip changes kind mid-way (getting into or out of a vehicle). */
  onChange: ((kind: ExploreKind) => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private sceneManager: SceneManager,
    private cameraController: CameraController,
    carManager: CarManager,
    boatManager: BoatManager,
    loadObstacles: () => ObstacleMap,
    parent: HTMLElement,
    private canvas: HTMLCanvasElement,
  ) {
    this.world = new ExploreWorld(carManager, boatManager, loadObstacles);
    this.hud = document.createElement('div');
    this.hud.className = 'drive-hud';
    this.hud.hidden = true;

    const gauge = document.createElement('div');
    gauge.className = 'drive-gauge';
    this.speedEl = document.createElement('span');
    this.speedEl.className = 'drive-speed';
    this.speedEl.textContent = '0';
    this.unitEl = document.createElement('span');
    this.unitEl.className = 'drive-unit';
    gauge.append(this.speedEl, this.unitEl);

    this.hintEl = document.createElement('div');
    this.hintEl.className = 'drive-hint';

    this.exitEl = document.createElement('button');
    this.exitEl.className = 'hud-button drive-exit';
    this.exitEl.addEventListener('click', () => this.stop());

    const pad = document.createElement('div');
    pad.className = 'drive-touch';
    pad.append(
      this.touchButton('◀', 'left', 'drive-touch-left'),
      this.touchButton('▶', 'right', 'drive-touch-right'),
      this.touchButton('▼', 'back', 'drive-touch-down'),
      this.touchButton('▲', 'forward', 'drive-touch-up'),
    );
    this.extraTouch = document.createElement('div');
    this.extraTouch.className = 'drive-touch-extra';
    pad.append(this.extraTouch);

    this.minimap = document.createElement('canvas');
    this.minimap.className = 'drive-minimap';
    this.minimap.setAttribute('aria-hidden', 'true');

    this.hud.append(this.minimap, gauge, this.hintEl, this.exitEl, pad);
    parent.appendChild(this.hud);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseControls());
    // Drag on the view to look around on foot.
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.traveller || this.dragging !== null) return;
      this.dragging = e.pointerId;
      this.dragFrom = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.dragging) return;
      this.look.x += e.clientX - this.dragFrom.x;
      this.look.y += e.clientY - this.dragFrom.y;
      this.dragFrom = { x: e.clientX, y: e.clientY };
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId === this.dragging) this.dragging = null;
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  private touchButton(label: string, key: keyof Held | 'use', cls: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `drive-touch-button ${cls}`;
    b.textContent = label;
    b.setAttribute('aria-label', key === 'use' ? label : key);
    const set = (on: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      if (key === 'use') this.usePending ||= on;
      else this.touch[key] = on;
      if (on) b.setPointerCapture(e.pointerId);
    };
    b.addEventListener('pointerdown', set(true));
    b.addEventListener('pointerup', set(false));
    b.addEventListener('pointercancel', set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  isActive(): boolean {
    return !!this.traveller;
  }

  getKind(): ExploreKind | null {
    return this.traveller?.kind ?? null;
  }

  /** Whether this kind of trip is possible in the city at all. */
  canStart(kind: ExploreKind, state: CityState): boolean {
    if (kind === 'drive') return state.buildings.some(b => isRoad(b.type));
    if (kind === 'boat') return state.grid.some(column => column.some(cell => cell.terrain === 'water'));
    if (kind === 'ride') return this.world.traffic.getCars().length > 0 || this.world.boats.getBoats().length > 0;
    return true;
  }

  /**
   * Sets off near a ground point (in cells), or near the view without one.
   * Returns false if there is nowhere suitable close enough.
   */
  start(kind: ExploreKind, state: CityState, at?: { x: number; z: number }): boolean {
    if (this.traveller) this.stop();
    this.world.sync(state);
    this.paintCityImage(state);

    const traveller = this.create(kind);
    const target = this.cameraController.getTarget();
    const tx = at ? at.x : target.x / CELL_SIZE;
    const tz = at ? at.z : target.z / CELL_SIZE;
    if (!traveller.place(this.world, tx, tz, !!at)) {
      traveller.dispose();
      return false;
    }
    this.mount(traveller);
    this.releaseControls();
    this.sceneManager.setCloseUp(true);
    this.hud.hidden = false;
    document.body.classList.add('driving');
    return true;
  }

  private create(kind: ExploreKind): Traveller {
    switch (kind) {
      case 'drive': return new CarTraveller();
      case 'walk': return new WalkTraveller();
      case 'fly': return new FlyTraveller();
      case 'boat': return new BoatTraveller();
      case 'ride': return new RideTraveller();
    }
  }

  private mount(traveller: Traveller): void {
    this.traveller = traveller;
    this.scene.add(traveller.object);
    const info = EXPLORE_MODES[traveller.kind];
    this.hintEl.textContent = info.hint;
    this.exitEl.textContent = info.exit;
    this.extraTouch.replaceChildren(...info.touch.map(([label, key], i) =>
      this.touchButton(label, key, `drive-touch-extra-${i}`)));
    this.setView(0);
    this.hud.dataset.mode = traveller.kind;
  }

  /** Swaps traveller mid-trip, keeping the camera where it is so the cut eases over. */
  private switchTo(handoff: Handoff): void {
    const old = this.traveller!;
    old.handoff = null;
    let next: Traveller | null = null;
    for (const kind of [handoff.kind, handoff.fallback]) {
      if (!kind) continue;
      const candidate = this.create(kind);
      const ok = candidate instanceof RideTraveller && handoff.target
        ? (candidate.board(this.world, handoff.target, !!handoff.vessel), true)
        : candidate.place(this.world, handoff.x, handoff.z, true);
      if (ok) {
        next = candidate;
        break;
      }
      candidate.dispose();
    }
    if (!next) return;
    this.scene.remove(old.object);
    old.dispose();
    this.world.traffic.setPlayer(null);
    // Step out facing the way the car was going.
    if (next instanceof WalkTraveller) next.yaw = handoff.yaw;
    this.mount(next);
    this.snapCamera = false;
    this.onChange?.(next.kind);
  }

  /** Parks and hands the view back to the city camera, over where the trip ended. */
  stop(): void {
    const traveller = this.traveller;
    if (!traveller) return;
    this.traveller = null;
    this.releaseControls();
    this.scene.remove(traveller.object);
    traveller.dispose();
    this.world.traffic.setPlayer(null);
    this.sceneManager.setCloseUp(false);
    this.sceneManager.setPerspective(this.cameraController.isPerspectiveView());
    this.cameraController.lookAt(traveller.x * CELL_SIZE, traveller.z * CELL_SIZE);
    this.hud.hidden = true;
    document.body.classList.remove('driving');
    this.onExit?.();
  }

  update(deltaTime: number, state: CityState | null): void {
    const traveller = this.traveller;
    if (!traveller) return;
    if (!state) {
      this.stop();
      return;
    }
    if (this.world.sync(state)) this.paintCityImage(state);

    const dt = Math.min(deltaTime, 0.05);
    const k = this.keys, t = this.touch;
    traveller.update(dt, {
      forward: k.forward || t.forward,
      back: k.back || t.back,
      left: k.left || t.left,
      right: k.right || t.right,
      action: k.action || t.action,
      shift: k.shift || t.shift,
      use: this.usePending,
      lookX: this.look.x,
      lookY: this.look.y,
    }, this.world);
    this.look.x = this.look.y = 0;
    this.usePending = false;
    if (traveller.handoff) {
      this.switchTo(traveller.handoff);
      // A failed handoff stays put; the traveller cleared nothing, so drop the request.
      if (this.traveller) this.traveller.handoff = null;
    }
    const current = this.traveller!;
    const prompt = current.prompt?.() ?? EXPLORE_MODES[current.kind].hint;
    if (this.hintEl.textContent !== prompt) this.hintEl.textContent = prompt;
    this.updateCamera(dt);
    this.drawMinimap();
    const [value, unit] = current.gauge();
    this.speedEl.textContent = value;
    this.unitEl.textContent = unit;
  }

  cycleCamera(): void {
    if (!this.traveller) return;
    this.setView((this.view + 1) % this.traveller.views.length);
  }

  private setView(view: number): void {
    this.view = view;
    this.snapCamera = true;
    this.traveller?.setView?.(view);
  }

  // ── Input ─────────────────────────────────────────────────

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.traveller) return;
    if (down && (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey)) return;
    const k = this.keys;
    switch (e.code) {
      case 'KeyW': case 'ArrowUp': k.forward = down; break;
      case 'KeyS': case 'ArrowDown': k.back = down; break;
      case 'KeyA': case 'ArrowLeft': k.left = down; break;
      case 'KeyD': case 'ArrowRight': k.right = down; break;
      case 'Space': k.action = down; break;
      case 'ShiftLeft': case 'ShiftRight': k.shift = down; break;
      case 'KeyE':
        if (down && !e.repeat) this.usePending = true;
        break;
      case 'KeyV':
        if (down && !e.repeat) this.cycleCamera();
        break;
      default: return;
    }
    // Keep arrows/space from scrolling or pressing a focused button.
    e.preventDefault();
  }

  private releaseControls(): void {
    this.keys = idle();
    this.touch = idle();
    this.look.x = this.look.y = 0;
    this.usePending = false;
    this.dragging = null;
  }

  // ── Presentation ──────────────────────────────────────────

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
          const type = this.world.typeOf(cell.buildingId);
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

  /** Heading-up map around the player, with traffic, boats and a north marker. */
  private drawMinimap(): void {
    const me = this.traveller!;
    const canvas = this.minimap;
    const css = canvas.clientWidth;
    if (!css) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.round(css * dpr);
    if (canvas.width !== px) canvas.width = canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const r = css / 2;
    // Zoom out with altitude when flying.
    const radius = MAP_RADIUS_CELLS * (me instanceof FlyTraveller ? 1 + Math.min(2, me.y / 8) : me.kind === 'walk' ? 0.6 : 1);
    const scale = r / radius;
    // Turn the map so the nose, (cos yaw, -sin yaw) on the canvas, points up.
    const turn = me.yaw - Math.PI / 2;

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
    ctx.translate(-me.x, -me.z);
    const size = this.world.size;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.cityImage, 0, 0, size, size);
    const near = (x: number, z: number) => Math.abs(x - me.x) <= radius * 1.5 && Math.abs(z - me.z) <= radius * 1.5;
    ctx.fillStyle = '#f5f5f0';
    for (const car of this.world.traffic.getCars()) {
      if (!near(car.x, car.z)) continue;
      ctx.beginPath();
      ctx.arc(car.x, car.z, 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    for (const boat of this.world.boats.getBoats()) {
      if (!near(boat.x, boat.z)) continue;
      ctx.beginPath();
      ctx.arc(boat.x, boat.z, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // The player: an arrow pointing up.
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
    this.traveller!.shot(this.view, this.shot);
    const { position, look, rigid } = this.shot;
    const ease = this.snapCamera || rigid ? 1 : 1 - Math.exp(-dt * 10);
    this.camPos.lerp(position, ease);
    this.camLook.lerp(look, ease);
    this.snapCamera = false;
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    camera.updateMatrixWorld();
  }
}

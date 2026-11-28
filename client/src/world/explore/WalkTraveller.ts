import * as THREE from 'three';
import { CELL_SIZE } from '@cityzen/shared';
import { createContactShadow } from '../CarManager.js';
import type { ExploreWorld } from './ExploreWorld.js';
import type { Rideable } from '../CarManager.js';
import { METRES_PER_CELL, approach, type CameraShot, type ExploreInput, type Handoff, type Traveller } from './types.js';

const WALK = 0.55;
const RUN = 1.35;
const BACKWARD = 0.35;
const ACCEL = 4;
const TURN_RATE = 2.6;
/** Radians turned per pixel dragged. */
const LOOK_RATE = 0.005;
const RADIUS = 0.05;
const EYE = 0.18;
const JUMP_SPEED = 1.05;
const GRAVITY = 4.2;
/** How high a kerb the walker steps straight up. */
const STEP_UP = 0.06;
const MAX_PICK_DISTANCE = 4;
/** How close a car (or a boat, from the quay) must be to climb in. */
const BOARD_CAR = 0.7;
const BOARD_BOAT = 1.6;
const SHIRTS = [0x2f6fb0, 0xc2453a, 0x3c8d5a, 0xe0a23a, 0x6b4fa0, 0x2d2f33];

/** A pedestrian on foot: sidewalks, parks, plazas and crossings. Traffic stops for you. */
export class WalkTraveller implements Traveller {
  readonly kind = 'walk';
  readonly views = ['Behind', 'Eyes'] as const;
  readonly object = new THREE.Group();
  handoff: Handoff | null = null;
  private reach: { target: Rideable; vessel: boolean } | null = null;
  x = 0;
  z = 0;
  yaw = 0;
  v = 0;
  private y = 0;
  private vy = 0;
  private ground = 0;
  private airborne = false;
  private pitch = -0.08;
  private stride = 0;
  private distance = 0;
  private view = 0;
  private legs: THREE.Object3D[] = [];
  private arms: THREE.Object3D[] = [];
  private figure = new THREE.Group();

  constructor() {
    const shirt = SHIRTS[Math.floor(Math.random() * SHIRTS.length)];
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const skin = mat(0xd9a77f), cloth = mat(shirt), trousers = mat(0x30353d), shoe = mat(0x1d1d1f), hair = mat(0x3a2a1f);
    const box = (w: number, h: number, d: number, m: THREE.Material, y: number, parent: THREE.Object3D, x = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    // The figure faces +x like the vehicles do.
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.09, side * 0.017);
      box(0.026, 0.085, 0.026, trousers, -0.042, hip);
      box(0.04, 0.012, 0.026, shoe, -0.084, hip, 0.007);
      this.figure.add(hip);
      this.legs.push(hip);
      const shoulder = new THREE.Group();
      shoulder.position.set(0, 0.155, side * 0.04);
      box(0.018, 0.07, 0.018, cloth, -0.032, shoulder);
      box(0.016, 0.014, 0.016, skin, -0.072, shoulder);
      this.figure.add(shoulder);
      this.arms.push(shoulder);
    }
    box(0.038, 0.075, 0.064, cloth, 0.125, this.figure);
    box(0.034, 0.036, 0.032, skin, 0.183, this.figure);
    box(0.036, 0.012, 0.034, hair, 0.204, this.figure, -0.002);
    this.figure.traverse(child => {
      if (child instanceof THREE.Mesh) child.castShadow = false;
    });
    const shadow = createContactShadow();
    shadow.scale.set(0.3, 1, 0.5);
    this.object.add(shadow, this.figure);
  }

  place(world: ExploreWorld, tx: number, tz: number, strict: boolean): boolean {
    const limit = strict ? MAX_PICK_DISTANCE : world.size;
    // Spiral out from the spot to the nearest place a person can stand, preferring sidewalks.
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    // Look one ring past the first standable spot, so a sidewalk beside the road wins over the road itself.
    let stopAt = limit;
    for (let r = 0; r <= stopAt; r++) {
      if (best) stopAt = Math.min(stopAt, r);
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          for (const [ox, oz] of [[0.5, 0.5], [0.12, 0.5], [0.88, 0.5], [0.5, 0.12], [0.5, 0.88]]) {
            const x = Math.floor(tx) + dx + ox, z = Math.floor(tz) + dz + oz;
            if (this.blocked(world, x, z, 0)) continue;
            const score = Math.hypot(x - tx, z - tz) - (world.onSidewalk(x, z) ? 0.6 : 0)
              + (world.surfaceAt(x, z) === 'road' ? 0.5 : 0);
            if (score < bestScore) {
              bestScore = score;
              best = [x, z];
            }
          }
        }
      }
    }
    if (!best) return false;
    [this.x, this.z] = best;
    // Face along the street if there is one next to us.
    this.yaw = world.surfaceAt(this.x + 1, this.z) === 'road' || world.surfaceAt(this.x - 1, this.z) === 'road' ? -Math.PI / 2 : 0;
    this.y = this.ground = world.groundY(this.x, this.z);
    this.v = this.vy = 0;
    this.airborne = false;
    this.pose();
    return true;
  }

  private blocked(world: ExploreWorld, x: number, z: number, y: number): boolean {
    for (const [ox, oz] of [[RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS]]) {
      const s = world.surfaceAt(x + ox, z + oz);
      if (s === 'water' || s === 'outside') return true;
    }
    return world.obstacles.hits(x, z, RADIUS, y + STEP_UP);
  }

  /** A traffic car or boat close enough to climb into. */
  private inReach(world: ExploreWorld): { target: Rideable; vessel: boolean } | null {
    const car = world.traffic.nearestRideable(this.x, this.z, BOARD_CAR);
    if (car) return { target: car, vessel: false };
    const boat = world.boats.nearestRideable(this.x, this.z, BOARD_BOAT);
    return boat ? { target: boat, vessel: true } : null;
  }

  prompt(): string | null {
    if (!this.reach) return null;
    return `E: ride this ${this.reach.vessel ? 'boat' : 'car'}`;
  }

  setView(view: number): void {
    this.view = view;
    this.figure.visible = view !== 1;
  }

  update(dt: number, input: ExploreInput, world: ExploreWorld): void {
    this.reach = this.inReach(world);
    if (input.use && this.reach) {
      this.handoff = { kind: 'ride', x: this.x, z: this.z, yaw: this.yaw, ...this.reach };
      return;
    }
    this.yaw += (Number(input.left) - Number(input.right)) * TURN_RATE * dt - input.lookX * LOOK_RATE;
    this.pitch = THREE.MathUtils.clamp(this.pitch - input.lookY * LOOK_RATE, -1.2, 1.1);

    const steep = world.surfaceAt(this.x, this.z) === 'steep';
    const target = input.forward ? (input.shift ? RUN : WALK) * (steep ? 0.6 : 1) : input.back ? -BACKWARD : 0;
    this.v = approach(this.v, target, ACCEL * dt);

    const dx = Math.cos(this.yaw) * this.v * dt;
    const dz = -Math.sin(this.yaw) * this.v * dt;
    const x0 = this.x, z0 = this.z;
    if (!this.blocked(world, this.x + dx, this.z + dz, this.y)) {
      this.x += dx;
      this.z += dz;
    } else if (!this.blocked(world, this.x + dx, this.z, this.y)) {
      this.x += dx;
    } else if (!this.blocked(world, this.x, this.z + dz, this.y)) {
      this.z += dz;
    } else {
      this.v = 0;
    }
    this.avoidTraffic(world);
    this.distance += Math.hypot(this.x - x0, this.z - z0);

    // Kerbs are stepped onto; jumps arc under gravity.
    const ground = this.ground = world.groundY(this.x, this.z);
    if (input.action && !this.airborne) {
      this.vy = JUMP_SPEED;
      this.airborne = true;
    }
    if (this.airborne) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.vy = 0;
        this.airborne = false;
      }
    } else {
      this.y += (ground - this.y) * (1 - Math.exp(-dt * 25));
    }

    const speed = Math.abs(this.v);
    this.stride += speed * dt * (input.shift ? 16 : 20);
    const swing = Math.sin(this.stride) * Math.min(1, speed / WALK) * (input.shift && speed > WALK ? 0.75 : 0.5);
    this.legs[0].rotation.z = swing;
    this.legs[1].rotation.z = -swing;
    this.arms[0].rotation.z = -swing * 0.8;
    this.arms[1].rotation.z = swing * 0.8;
    this.pose();

    // Cars stop for a pedestrian in the road.
    const onRoad = world.surfaceAt(this.x, this.z) === 'road';
    world.traffic.setPlayer(onRoad ? { x: this.x, z: this.z, yaw: this.yaw, v: 0 } : null);
  }

  /** Step out of the way of a car rather than walking through it. */
  private avoidTraffic(world: ExploreWorld): void {
    for (const car of world.traffic.getCars()) {
      const nx = this.x - car.x, nz = this.z - car.z;
      const d = Math.hypot(nx, nz);
      if (d >= 0.26 || d < 1e-6) continue;
      const push = 0.26 - d;
      const px = this.x + (nx / d) * push, pz = this.z + (nz / d) * push;
      if (!this.blocked(world, px, pz, this.y)) {
        this.x = px;
        this.z = pz;
      }
    }
  }

  private pose(): void {
    this.object.position.set(this.x * CELL_SIZE, this.y, this.z * CELL_SIZE);
    this.object.rotation.y = this.yaw;
    // The shadow stays on the ground through a jump.
    this.object.children[0].position.y = this.ground - this.y + 0.006;
  }

  gauge(): [string, string] {
    const m = this.distance * METRES_PER_CELL;
    return m < 1000 ? [String(Math.round(m)), 'm walked'] : [(m / 1000).toFixed(2), 'km walked'];
  }

  shot(view: number, out: CameraShot): void {
    const cx = this.x * CELL_SIZE, cz = this.z * CELL_SIZE;
    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const bob = this.airborne ? 0 : Math.abs(Math.sin(this.stride)) * 0.004 * Math.min(1, Math.abs(this.v));
    if (view === 1) {
      const eye = this.y + EYE + bob;
      out.position.set(cx + fx * 0.02, eye, cz + fz * 0.02);
      out.look.set(cx + fx * cp * 2, eye + sp * 2, cz + fz * cp * 2);
      out.rigid = true;
      return;
    }
    // Over the shoulder, orbiting with the look pitch.
    const back = 0.62, head = this.y + 0.2;
    const height = Math.max(0.06, 0.18 - sp * 0.5);
    out.position.set(cx - fx * back * cp, head + height - 0.1, cz - fz * back * cp);
    out.look.set(cx + fx * 0.6, head + sp * 0.6, cz + fz * 0.6);
    out.rigid = false;
  }

  dispose(): void {
    this.object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    });
  }
}


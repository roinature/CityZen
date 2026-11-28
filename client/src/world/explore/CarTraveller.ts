import * as THREE from 'three';
import { CELL_SIZE, getEffectiveSize, isRoad } from '@cityzen/shared';
import { createCarMesh, disposeCarMesh } from '../CarManager.js';
import type { ExploreWorld } from './ExploreWorld.js';
import { METRES_PER_CELL, angleDelta, approach, type CameraShot, type ExploreInput, type Traveller } from './types.js';

// All distances in cells, speeds in cells per second, angles in radians.
const PLAYER_COLOR = 0xf2f4f8;
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
/** Body lean: radians of pitch per cell/s² and of roll per cell/s² of cornering. */
const PITCH_PER_ACCEL = 0.006;
const ROLL_PER_LATERAL = 0.008;

/** The player's car: arcade handling, buildings and water are solid, grass is slow. */
export class CarTraveller implements Traveller {
  readonly kind = 'drive';
  readonly views = ['Chase', 'Hood', 'High'] as const;
  readonly object = new THREE.Group();
  private body = createCarMesh(PLAYER_COLOR, { hero: true });
  x = 0;
  z = 0;
  yaw = 0;
  v = 0;
  private steer = 0;
  private pitch = 0;
  private roll = 0;
  private camYaw = 0;
  private blinkTime = 0;

  constructor() {
    this.object.add(this.body);
  }

  place(world: ExploreWorld, tx: number, tz: number, strict: boolean): boolean {
    let best: { x: number; z: number; yaw: number } | null = null;
    let bestDist = strict ? MAX_PICK_DISTANCE ** 2 : Infinity;
    for (const b of world.state.buildings) {
      if (!isRoad(b.type)) continue;
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      const x = b.position.x + w / 2;
      const z = b.position.z + d / 2;
      const dist = (x - tx) ** 2 + (z - tz) ** 2;
      if (dist >= bestDist) continue;
      // Pointing along the road: an NS road runs along z.
      const yaw = b.orientation === 'NS' ? -Math.PI / 2 : 0;
      if (this.blocked(world, x, z, yaw)) continue;
      best = { x, z, yaw };
      bestDist = dist;
    }
    if (!best) return false;
    ({ x: this.x, z: this.z, yaw: this.yaw } = best);
    this.camYaw = this.yaw;
    this.v = this.steer = 0;
    this.pose();
    return true;
  }

  private solid(world: ExploreWorld, x: number, z: number): boolean {
    const s = world.surfaceAt(x, z);
    return s !== 'road' && s !== 'ground';
  }

  /** Whether the car's footprint at this pose touches anything solid. */
  private blocked(world: ExploreWorld, x: number, z: number, yaw: number): boolean {
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const rx = -fz, rz = fx;
    for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0]]) {
      if (this.solid(world, x + fx * HALF_LEN * a + rx * HALF_WIDTH * b, z + fz * HALF_LEN * a + rz * HALF_WIDTH * b)) return true;
    }
    return false;
  }

  update(dt: number, input: ExploreInput, world: ExploreWorld): void {
    const steerInput = Number(input.left) - Number(input.right);
    const onRoad = world.surfaceAt(this.x, this.z) === 'road';
    const top = onRoad ? BASE_TOP + world.roadSpeedAt(this.x, this.z) * TOP_PER_MULT : OFFROAD_MAX;

    let v = this.v;
    const toward = (target: number, rate: number) => { v = approach(v, target, rate * dt); };
    if (input.action) toward(0, HANDBRAKE);
    else if (input.forward) v < 0 ? toward(0, BRAKE) : toward(top, ACCEL);
    else if (input.back) v > 0 ? toward(0, BRAKE) : toward(-MAX_REVERSE, ACCEL * 0.7);
    else toward(0, COAST);
    // Over the limit (left a highway, or ran onto the grass): bleed speed off.
    if (v > top) v = Math.max(top, v - (onRoad ? COAST * 3 : OFFROAD_DRAG) * dt);
    if (v < -MAX_REVERSE) v = -MAX_REVERSE;
    const accel = (v - this.v) / Math.max(dt, 1e-4);
    this.v = v;

    // Less lock at speed keeps the car on a one-cell street.
    const maxSteer = MAX_STEER / (1 + Math.abs(v) * 0.25);
    const steerStep = STEER_RATE * maxSteer * dt;
    this.steer += THREE.MathUtils.clamp(steerInput * maxSteer - this.steer, -steerStep, steerStep);

    const yawRate = (v * Math.tan(this.steer)) / WHEELBASE;
    const steps = Math.max(1, Math.ceil(Math.abs(v * dt) / SUBSTEP));
    for (let i = 0; i < steps; i++) this.step(world, dt / steps, yawRate);
    this.bumpTraffic(world);

    // The body squats under power, dives under braking and leans out of turns.
    const ease = 1 - Math.exp(-dt * 8);
    this.pitch += (THREE.MathUtils.clamp(accel * PITCH_PER_ACCEL, -0.06, 0.04) - this.pitch) * ease;
    this.roll += (THREE.MathUtils.clamp(yawRate * this.v * ROLL_PER_LATERAL, -0.07, 0.07) - this.roll) * ease;
    this.camYaw += angleDelta(this.camYaw, this.yaw) * (1 - Math.exp(-dt * 5));
    // Dynamic brake lights & blinking amber turn signals
    this.blinkTime += dt;
    const blinkOn = Math.sin(this.blinkTime * 11) > 0;
    const braking = input.action || (input.back && this.v > 0.15);
    const tl = this.body.userData.taillightMat as THREE.MeshStandardMaterial | undefined;
    if (tl) tl.emissiveIntensity = braking ? 3.8 : 1.5;
    const ls = this.body.userData.leftSignalMat as THREE.MeshStandardMaterial | undefined;
    const rs = this.body.userData.rightSignalMat as THREE.MeshStandardMaterial | undefined;
    if (ls) ls.emissiveIntensity = steerInput > 0 && blinkOn ? 4.8 : 0.12;
    if (rs) rs.emissiveIntensity = steerInput < 0 && blinkOn ? 4.8 : 0.12;

    this.pose();
    world.traffic.setPlayer({ x: this.x, z: this.z, yaw: this.yaw, v: this.v });
  }

  private step(world: ExploreWorld, h: number, yawRate: number): void {
    const yaw = this.yaw + yawRate * h;
    if (!this.blocked(world, this.x, this.z, yaw)) this.yaw = yaw;

    const dx = Math.cos(this.yaw) * this.v * h;
    const dz = -Math.sin(this.yaw) * this.v * h;
    if (!this.blocked(world, this.x + dx, this.z + dz, this.yaw)) {
      this.x += dx;
      this.z += dz;
      return;
    }
    // Scrape along the wall on whichever axis is free.
    const slideX = Math.abs(dx) > 1e-5 && !this.blocked(world, this.x + dx, this.z, this.yaw);
    const slideZ = !slideX && Math.abs(dz) > 1e-5 && !this.blocked(world, this.x, this.z + dz, this.yaw);
    if (slideX) this.x += dx;
    else if (slideZ) this.z += dz;
    // Head-on: bounce back a little.
    this.v *= slideX || slideZ ? 0.96 : -0.25;
  }

  /** Shove apart from traffic cars rather than driving through them. */
  private bumpTraffic(world: ExploreWorld): void {
    for (const car of world.traffic.getCars()) {
      if (car.leaving >= 0) continue;
      let nx = this.x - car.x;
      let nz = this.z - car.z;
      const d = Math.hypot(nx, nz);
      if (d >= BUMP_DIST || d < 1e-6) continue;
      nx /= d;
      nz /= d;
      const push = BUMP_DIST - d;
      if (!this.blocked(world, this.x + nx * push, this.z + nz * push, this.yaw)) {
        this.x += nx * push;
        this.z += nz * push;
      }
      // Moving into the other car: lose most of the speed.
      if (Math.cos(this.yaw) * this.v * nx - Math.sin(this.yaw) * this.v * nz < 0) this.v *= -0.3;
    }
  }

  private pose(): void {
    this.object.position.set(this.x * CELL_SIZE, CAR_Y, this.z * CELL_SIZE);
    this.object.rotation.y = this.yaw;
    this.body.rotation.set(this.roll, 0, this.pitch);
  }

  gauge(): [string, string] {
    return [String(Math.round(Math.abs(this.v) * METRES_PER_CELL * 3.6)), 'km/h'];
  }

  shot(view: number, out: CameraShot): void {
    const cx = this.x * CELL_SIZE, cz = this.z * CELL_SIZE;
    if (view === 1) {
      const hx = Math.cos(this.yaw), hz = -Math.sin(this.yaw);
      out.position.set(cx + hx * 0.06, 0.24, cz + hz * 0.06);
      out.look.set(cx + hx * 3, 0.16, cz + hz * 3);
      out.rigid = true;
      return;
    }
    const fx = Math.cos(this.camYaw), fz = -Math.sin(this.camYaw);
    // Pull back a touch at speed.
    const [back, height, ahead] = view === 0 ? [1.25 + Math.abs(this.v) * 0.04, 0.5, 1.1] : [3.2, 3.2, 0.6];
    out.position.set(cx - fx * back * CELL_SIZE, height * CELL_SIZE, cz - fz * back * CELL_SIZE);
    out.look.set(cx + fx * ahead * CELL_SIZE, 0.12, cz + fz * ahead * CELL_SIZE);
    out.rigid = false;
  }

  dispose(): void {
    disposeCarMesh(this.body);
  }
}

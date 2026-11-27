import * as THREE from 'three';
import { CELL_SIZE } from '@cityzen/shared';
import { createBoatMesh } from '../BoatManager.js';
import type { ExploreWorld } from './ExploreWorld.js';
import { METRES_PER_CELL, angleDelta, approach, type CameraShot, type ExploreInput, type Traveller } from './types.js';

const WATER_Y = 0.012;
const HALF_LEN = 0.34;
const HALF_BEAM = 0.11;
const THRUST = 1.3;
const REVERSE = 0.7;
const DRAG = 0.35;
const MAX_SPEED = 3.4;
const MAX_REVERSE = 0.9;
/** Turn rate per unit speed, and the least the rudder can do while barely moving. */
const RUDDER = 0.7;
const RUDDER_MIN = 0.35;
const MAX_TURN = 1.3;
/** Fraction of sideways slip kept each second: boats skid through turns. */
const SLIP_DECAY = 1.8;
const BUMP_DIST = 0.6;
const MAX_PICK_DISTANCE = 6;
const SUBSTEP = 0.06;

/** A motor yacht on the city's lakes, rivers and harbours. */
export class BoatTraveller implements Traveller {
  readonly kind = 'boat';
  readonly views = ['Chase', 'Helm', 'High'] as const;
  readonly object = new THREE.Group();
  private hull: THREE.Group;
  private wake: THREE.Mesh;
  x = 0;
  z = 0;
  yaw = 0;
  v = 0;
  private slip = 0;
  private turn = 0;
  private time = 0;
  private camYaw = 0;

  constructor() {
    const { group, wake } = createBoatMesh('yacht');
    this.hull = group;
    this.wake = wake;
    this.object.add(group);
  }

  place(world: ExploreWorld, tx: number, tz: number, strict: boolean): boolean {
    let best: { x: number; z: number; yaw: number } | null = null;
    let bestScore = strict ? MAX_PICK_DISTANCE : Infinity;
    for (let cx = 0; cx < world.size; cx++) {
      for (let cz = 0; cz < world.size; cz++) {
        if (world.grid[cx][cz].terrain !== 'water') continue;
        const x = cx + 0.5, z = cz + 0.5;
        // Keep off the shore: every bit of land round the cell counts against it.
        let shore = 0;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) if (world.grid[cx + dx]?.[cz + dz]?.terrain !== 'water') shore++;
        }
        const dist = Math.hypot(x - tx, z - tz) + shore * 0.6;
        if (dist >= bestScore + 3) continue;
        // Point down the longest run of open water, and prefer a spot with room to get going.
        for (let i = 0; i < 8; i++) {
          const yaw = (i * Math.PI) / 4;
          if (this.blocked(world, x, z, yaw)) continue;
          const score = dist + Math.max(0, 3 - this.openWater(world, x, z, yaw));
          if (score >= bestScore) continue;
          best = { x, z, yaw };
          bestScore = score;
        }
      }
    }
    if (!best) return false;
    ({ x: this.x, z: this.z, yaw: this.yaw } = best);
    this.camYaw = this.yaw;
    this.v = this.slip = this.turn = 0;
    this.pose(0);
    return true;
  }

  /** Clear water straight ahead, in cells (up to 6). */
  private openWater(world: ExploreWorld, x: number, z: number, yaw: number): number {
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    for (let d = 0.25; d <= 6; d += 0.25) {
      if (this.blocked(world, x + fx * d, z + fz * d, yaw)) return d;
    }
    return 6;
  }

  private blocked(world: ExploreWorld, x: number, z: number, yaw: number): boolean {
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const rx = -fz, rz = fx;
    for (const [a, b] of [[1, 0], [0.6, 1], [0.6, -1], [-1, 1], [-1, -1], [0, 1], [0, -1]]) {
      const px = x + fx * HALF_LEN * a + rx * HALF_BEAM * b;
      const pz = z + fz * HALF_LEN * a + rz * HALF_BEAM * b;
      if (world.surfaceAt(px, pz) !== 'water' || world.obstacles.heightAt(px, pz) > 0.05) return true;
    }
    return false;
  }

  update(dt: number, input: ExploreInput, world: ExploreWorld): void {
    this.time += dt;
    let thrust = 0;
    if (input.action) thrust = -Math.sign(this.v) * THRUST * 1.4;
    else if (input.forward) thrust = THRUST;
    else if (input.back) thrust = -REVERSE;
    this.v += (thrust - this.v * DRAG) * dt;
    if (input.action && Math.abs(this.v) < 0.05) this.v = 0;
    this.v = THREE.MathUtils.clamp(this.v, -MAX_REVERSE, MAX_SPEED);

    // The rudder needs water flowing past it; a little prop wash turns her at rest.
    const steer = Number(input.left) - Number(input.right);
    const authority = Math.min(MAX_TURN, RUDDER_MIN + Math.abs(this.v) * RUDDER) * Math.sign(this.v || 1);
    this.turn = approach(this.turn, steer * authority, 2.2 * dt);
    // Turning throws the stern out: a slide that the water slowly takes away.
    this.slip += (this.turn * this.v * 0.12 - this.slip * SLIP_DECAY) * dt;

    const steps = Math.max(1, Math.ceil((Math.abs(this.v) + Math.abs(this.slip)) * dt / SUBSTEP));
    for (let i = 0; i < steps; i++) this.step(world, dt / steps);
    this.bumpBoats(world);
    this.camYaw += angleDelta(this.camYaw, this.yaw) * (1 - Math.exp(-dt * 3));
    this.pose(dt);
  }

  private step(world: ExploreWorld, h: number): void {
    const yaw = this.yaw + this.turn * h;
    if (!this.blocked(world, this.x, this.z, yaw)) this.yaw = yaw;
    else this.turn *= 0.5;
    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
    const dx = (fx * this.v - fz * this.slip) * h;
    const dz = (fz * this.v + fx * this.slip) * h;
    if (!this.blocked(world, this.x + dx, this.z + dz, this.yaw)) {
      this.x += dx;
      this.z += dz;
    } else if (!this.blocked(world, this.x + dx, this.z, this.yaw)) {
      this.x += dx;
      this.v *= 0.97;
    } else if (!this.blocked(world, this.x, this.z + dz, this.yaw)) {
      this.z += dz;
      this.v *= 0.97;
    } else {
      // Ran aground or into the quay: a soft bump back.
      this.v *= -0.2;
      this.slip = 0;
    }
  }

  private bumpBoats(world: ExploreWorld): void {
    for (const boat of world.boats.getBoats()) {
      let nx = this.x - boat.x, nz = this.z - boat.z;
      const d = Math.hypot(nx, nz);
      if (d >= BUMP_DIST || d < 1e-6) continue;
      nx /= d;
      nz /= d;
      const push = BUMP_DIST - d;
      if (!this.blocked(world, this.x + nx * push, this.z + nz * push, this.yaw)) {
        this.x += nx * push;
        this.z += nz * push;
      }
      if (Math.cos(this.yaw) * this.v * nx - Math.sin(this.yaw) * this.v * nz < 0) this.v *= -0.2;
    }
  }

  private pose(dt: number): void {
    const t = this.time;
    const speed = Math.abs(this.v) / MAX_SPEED;
    this.object.position.set(this.x * CELL_SIZE, WATER_Y + Math.sin(t * 2.1) * 0.008 + Math.sin(t * 3.7) * 0.004, this.z * CELL_SIZE);
    this.object.rotation.y = this.yaw;
    // Bow lifts as she gets on the plane; she heels outward in turns and rocks on the swell.
    const pitch = speed * 0.06 + Math.sin(t * 1.7) * 0.012;
    const roll = THREE.MathUtils.clamp(this.turn * this.v * 0.05, -0.12, 0.12) + Math.sin(t * 1.3 + 1) * 0.02;
    const ease = dt ? 1 - Math.exp(-dt * 4) : 1;
    this.hull.rotation.z += (pitch - this.hull.rotation.z) * ease;
    this.hull.rotation.x += (roll - this.hull.rotation.x) * ease;
    this.wake.visible = speed > 0.05 && this.v > 0;
    this.wake.scale.set(0.45 + speed * 1.1, 1, 0.7 + speed * 0.5);
    (this.wake.material as THREE.MeshBasicMaterial).opacity = 0.2 + speed * 0.3;
  }

  gauge(): [string, string] {
    return [String(Math.round(Math.abs(this.v) * METRES_PER_CELL * 1.944)), 'knots'];
  }

  shot(view: number, out: CameraShot): void {
    const cx = this.x * CELL_SIZE, cz = this.z * CELL_SIZE;
    if (view === 1) {
      const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
      out.position.set(cx - fx * 0.1, 0.26, cz - fz * 0.1);
      out.look.set(cx + fx * 3, 0.1, cz + fz * 3);
      out.rigid = true;
      return;
    }
    const fx = Math.cos(this.camYaw), fz = -Math.sin(this.camYaw);
    const [back, up, ahead] = view === 0 ? [1.6 + Math.abs(this.v) * 0.08, 0.62, 1.2] : [3.6, 3.6, 0.8];
    out.position.set(cx - fx * back, up, cz - fz * back);
    out.look.set(cx + fx * ahead, 0.08, cz + fz * ahead);
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

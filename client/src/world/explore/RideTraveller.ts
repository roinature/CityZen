import * as THREE from 'three';
import { CELL_SIZE } from '@cityzen/shared';
import type { Rideable } from '../CarManager.js';
import type { ExploreWorld } from './ExploreWorld.js';
import { METRES_PER_CELL, angleDelta, type CameraShot, type ExploreInput, type Handoff, type Traveller } from './types.js';

/** How far from a clicked spot, in cells, a vehicle may be picked. */
const PICK_RADIUS = 6;
const LOOSE_PICK_RADIUS = 14;
/** How far Space reaches when jumping across to another vehicle. */
const JUMP_RADIUS = 3;
/** Radians turned per pixel dragged. */
const LOOK_RATE = 0.005;

/** CarManager or BoatManager, whichever owns the vehicle. */
interface Fleet {
  setRiding(v: Rideable | null): void;
  getRiding(): Rideable | null;
}

/** A passenger: rides along in a traffic car, bus, service truck or boat wherever it goes. */
export class RideTraveller implements Traveller {
  readonly kind = 'ride';
  readonly views = ['Behind', 'Seat', 'High'] as const;
  readonly object = new THREE.Group();
  handoff: Handoff | null = null;
  x = 0;
  z = 0;
  yaw = 0;
  v = 0;
  private target: Rideable | null = null;
  private vessel = false;
  private owner: Fleet | null = null;
  private length = 0.5;
  private top = 0.2;
  private camYaw = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  /** Space was held last frame, so one press makes one jump. */
  private jumped = true;

  place(world: ExploreWorld, tx: number, tz: number, strict: boolean): boolean {
    const radius = strict ? PICK_RADIUS : LOOSE_PICK_RADIUS;
    const car = world.traffic.nearestRideable(tx, tz, radius);
    const boat = world.boats.nearestRideable(tx, tz, radius);
    const d = (v: Rideable | null) => v ? Math.hypot(v.x - tx, v.z - tz) : Infinity;
    if (!car && !boat) return false;
    const vessel = d(boat) < d(car);
    this.board(world, (vessel ? boat : car)!, vessel);
    return true;
  }

  /** Climbs aboard a particular vehicle. */
  board(world: ExploreWorld, target: Rideable, vessel: boolean): void {
    this.owner?.setRiding(null);
    this.target = target;
    this.vessel = vessel;
    this.owner = vessel ? world.boats : world.traffic;
    this.owner.setRiding(target);
    this.measure(target.mesh);
    this.follow();
    this.camYaw = this.yaw;
  }

  /** Size of the vehicle along its own axes, for placing the camera. */
  private measure(mesh: THREE.Object3D): void {
    const rotation = mesh.rotation.clone();
    const scale = mesh.scale.clone();
    mesh.rotation.set(0, 0, 0);
    mesh.scale.setScalar(CELL_SIZE);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    mesh.rotation.copy(rotation);
    mesh.scale.copy(scale);
    mesh.updateMatrixWorld(true);
    this.length = Math.max(0.3, box.max.x - box.min.x);
    this.top = Math.max(0.12, box.max.y);
  }

  private follow(): void {
    const t = this.target!;
    this.x = t.x;
    this.z = t.z;
    this.yaw = t.yaw;
    this.v = t.v;
  }

  update(dt: number, input: ExploreInput, world: ExploreWorld): void {
    if (!this.target || this.owner?.getRiding() !== this.target) {
      // The ride ended (it pulled into its depot, or its road was demolished): hop across or step off.
      const next = this.nearest(world, JUMP_RADIUS);
      if (next) this.board(world, next.target, next.vessel);
      else return this.getOut(world);
    }
    if (input.use) return this.getOut(world);
    if (input.action && !this.jumped) {
      const next = this.nearest(world, JUMP_RADIUS, this.target);
      if (next) this.board(world, next.target, next.vessel);
    }
    this.jumped = input.action;

    this.follow();
    this.camYaw += angleDelta(this.camYaw, this.yaw) * (1 - Math.exp(-dt * 3));
    this.lookYaw -= input.lookX * LOOK_RATE;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - input.lookY * LOOK_RATE, -0.6, 0.5);
  }

  /** The closest vehicle other than `except`, car or boat. */
  private nearest(world: ExploreWorld, radius: number, except?: Rideable | null): { target: Rideable; vessel: boolean } | null {
    const car = world.traffic.nearestRideable(this.x, this.z, radius, except);
    const boat = world.boats.nearestRideable(this.x, this.z, radius, except);
    const d = (v: Rideable | null) => v ? Math.hypot(v.x - this.x, v.z - this.z) : Infinity;
    if (!car && !boat) return null;
    return d(boat) < d(car) ? { target: boat!, vessel: true } : { target: car!, vessel: false };
  }

  /** On foot beside the car, or at the helm of your own boat out on the water. */
  private getOut(world: ExploreWorld): void {
    const onWater = world.surfaceAt(this.x, this.z) === 'water';
    this.handoff = { kind: onWater ? 'boat' : 'walk', x: this.x, z: this.z, yaw: this.yaw, fallback: onWater ? 'walk' : undefined };
  }

  setView(): void {
    this.lookYaw = 0;
    this.lookPitch = 0;
  }

  gauge(): [string, string] {
    if (this.vessel) return [String(Math.round(Math.abs(this.v) * METRES_PER_CELL * 1.944)), 'knots'];
    return [String(Math.round(Math.abs(this.v) * METRES_PER_CELL * 3.6)), 'km/h'];
  }

  shot(view: number, out: CameraShot): void {
    const cx = this.x * CELL_SIZE, cz = this.z * CELL_SIZE;
    if (view === 1) {
      // In the passenger seat (or on deck), looking where you like.
      const hx = Math.cos(this.yaw), hz = -Math.sin(this.yaw);
      const sx = Math.cos(this.yaw + this.lookYaw), sz = -Math.sin(this.yaw + this.lookYaw);
      const ahead = this.vessel ? -this.length * 0.15 : this.length * 0.05;
      const eye = this.vessel ? Math.min(this.top * 0.6, 0.14 + this.length * 0.12) : this.top * 0.74;
      out.position.set(cx + hx * ahead, eye, cz + hz * ahead);
      out.look.set(out.position.x + sx * 3, eye - 0.12 + this.lookPitch * 3, out.position.z + sz * 3);
      out.rigid = true;
      return;
    }
    const yaw = this.camYaw + this.lookYaw;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const [back, up] = view === 0
      ? [0.75 + this.length * 1.4 + this.v * 0.04, 0.3 + this.top * 1.2]
      : [3, 3.2];
    const lift = Math.max(0.05, up - this.lookPitch * back);
    out.position.set(cx - fx * back, lift, cz - fz * back);
    out.look.set(cx + fx * 0.9, Math.min(this.top, 0.2), cz + fz * 0.9);
    out.rigid = false;
  }

  dispose(): void {
    this.owner?.setRiding(null);
    this.owner = null;
    this.target = null;
  }
}

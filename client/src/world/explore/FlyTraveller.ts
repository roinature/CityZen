import * as THREE from 'three';
import { CELL_SIZE } from '@cityzen/shared';
import { createContactShadow } from '../CarManager.js';
import type { ExploreWorld } from './ExploreWorld.js';
import { METRES_PER_CELL, angleDelta, approach, type CameraShot, type ExploreInput, type Traveller } from './types.js';

const THRUST = 4.5;
const DRAG = 0.9;
const MAX_SPEED = 6.5;
const CLIMB = 2.6;
const CLIMB_ACCEL = 5;
const TURN_RATE = 1.7;
const TURN_ACCEL = 6;
const CEILING = 40;
/** Clearance kept from roofs and the ground, so the skids just touch down. */
const SKIDS = 0.02;
const RADIUS = 0.22;
const START_HEIGHT = 1.2;
const SUBSTEP = 0.1;

/** A light helicopter: hover, climb, cruise over the rooftops and land on them. */
export class FlyTraveller implements Traveller {
  readonly kind = 'fly';
  readonly views = ['Chase', 'Cockpit', 'High'] as const;
  readonly object = new THREE.Group();
  private craft = new THREE.Group();
  private tilt = new THREE.Group();
  private rotor = new THREE.Group();
  private tailRotor = new THREE.Group();
  private shadow = createContactShadow();
  x = 0;
  z = 0;
  y = 0;
  yaw = 0;
  v = 0;
  private vx = 0;
  private vz = 0;
  private vy = 0;
  private turn = 0;
  private floor = 0;
  private camYaw = 0;

  constructor() {
    const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, ...extra });
    const paint = mat(0xd63a2f), dark = mat(0x22262b), glass = mat(0x7fb6d9, { roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.75 });
    const add = (geometry: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.tilt) => {
      const mesh = new THREE.Mesh(geometry, m);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    // Nose along +x.
    add(new THREE.SphereGeometry(0.12, 14, 10).scale(1.35, 0.95, 0.9), paint, 0.02, 0.15, 0);
    add(new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 0.95).rotateZ(-Math.PI / 2.6), glass, 0.1, 0.17, 0);
    add(new THREE.CylinderGeometry(0.018, 0.035, 0.42, 8).rotateZ(Math.PI / 2), paint, -0.3, 0.18, 0);
    add(new THREE.BoxGeometry(0.06, 0.1, 0.012), paint, -0.5, 0.22, 0);
    add(new THREE.BoxGeometry(0.05, 0.012, 0.12), paint, -0.47, 0.18, 0);
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6), dark, 0, 0.29, 0);
    for (const side of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 6).rotateZ(Math.PI / 2), dark, 0, 0.01, side * 0.09);
      for (const sx of [-0.08, 0.08]) add(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 5), dark, sx, 0.05, side * 0.08);
    }
    this.rotor.position.set(0, 0.32, 0);
    for (const a of [0, Math.PI / 2]) {
      const blade = add(new THREE.BoxGeometry(0.78, 0.006, 0.035), dark, 0, 0, 0, this.rotor);
      blade.rotation.y = a;
    }
    this.tailRotor.position.set(-0.5, 0.23, 0.012);
    add(new THREE.BoxGeometry(0.16, 0.02, 0.004), dark, 0, 0, 0, this.tailRotor);
    this.tilt.add(this.rotor, this.tailRotor);
    this.craft.add(this.tilt);
    this.shadow.scale.set(1.1, 1, 1.6);
    this.object.add(this.craft, this.shadow);
  }

  place(world: ExploreWorld, tx: number, tz: number): boolean {
    this.x = THREE.MathUtils.clamp(tx, 0.5, world.size - 0.5);
    this.z = THREE.MathUtils.clamp(tz, 0.5, world.size - 0.5);
    this.floor = world.obstacles.heightNear(this.x, this.z, RADIUS);
    this.y = this.floor + START_HEIGHT;
    // Face into the city.
    const mid = world.size / 2;
    if (Math.hypot(mid - this.x, mid - this.z) > 2) this.yaw = Math.atan2(-(mid - this.z), mid - this.x);
    this.vx = this.vz = this.vy = this.turn = this.v = 0;
    this.camYaw = this.yaw;
    this.pose(0, 0);
    return true;
  }

  private floorAt(world: ExploreWorld, x: number, z: number): number {
    return world.obstacles.heightNear(x, z, RADIUS) + SKIDS;
  }

  update(dt: number, input: ExploreInput, world: ExploreWorld): void {
    this.turn = approach(this.turn, (Number(input.left) - Number(input.right)) * TURN_RATE, TURN_ACCEL * dt);
    this.yaw += this.turn * dt;

    const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
    const thrust = (Number(input.forward) - Number(input.back) * 0.6) * THRUST;
    this.vx += (fx * thrust - this.vx * DRAG) * dt;
    this.vz += (fz * thrust - this.vz * DRAG) * dt;
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > MAX_SPEED) {
      this.vx *= MAX_SPEED / speed;
      this.vz *= MAX_SPEED / speed;
    }
    // A helicopter drifts sideways much less than it slides forward.
    const side = -fz * this.vx + fx * this.vz;
    this.vx -= -fz * side * Math.min(1, dt * 1.5);
    this.vz -= fx * side * Math.min(1, dt * 1.5);
    this.vy = approach(this.vy, (Number(input.action) - Number(input.shift)) * CLIMB, CLIMB_ACCEL * dt);

    const steps = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vz) * dt / SUBSTEP));
    for (let i = 0; i < steps; i++) this.move(world, dt / steps);
    this.y = Math.min(CEILING, this.y + this.vy * dt);
    this.floor = this.floorAt(world, this.x, this.z);
    if (this.y < this.floor) {
      this.y = this.floor;
      this.vy = Math.max(0, this.vy);
    }
    this.v = Math.hypot(this.vx, this.vz);
    this.camYaw += angleDelta(this.camYaw, this.yaw) * (1 - Math.exp(-dt * 3));

    // Nose dips into the direction of travel and the craft banks into turns.
    const forward = fx * this.vx + fz * this.vz;
    const sideways = -fz * this.vx + fx * this.vz;
    const landed = this.y - this.floor < 0.01 && this.v < 0.05;
    this.rotor.rotation.y += dt * (landed && !input.action ? 18 : 34);
    this.tailRotor.rotation.z += dt * 50;
    this.pose(landed ? 0 : -forward * 0.045, landed ? 0 : -this.turn * 0.12 + sideways * 0.05);
  }

  /** Flies into nothing taller than the craft; slides along walls. */
  private move(world: ExploreWorld, h: number): void {
    const free = (x: number, z: number) => x > 0.2 && z > 0.2 && x < world.size - 0.2 && z < world.size - 0.2
      && this.floorAt(world, x, z) <= this.y + 0.05;
    const nx = this.x + this.vx * h, nz = this.z + this.vz * h;
    if (free(nx, nz)) {
      this.x = nx;
      this.z = nz;
    } else if (free(nx, this.z)) {
      this.x = nx;
      this.vz *= 0.5;
    } else if (free(this.x, nz)) {
      this.z = nz;
      this.vx *= 0.5;
    } else {
      this.vx *= -0.3;
      this.vz *= -0.3;
    }
  }

  private pose(pitch: number, roll: number): void {
    const ease = 0.12;
    this.craft.position.set(this.x * CELL_SIZE, this.y, this.z * CELL_SIZE);
    this.craft.rotation.y = this.yaw;
    this.tilt.rotation.z += (pitch - this.tilt.rotation.z) * ease;
    this.tilt.rotation.x += (roll - this.tilt.rotation.x) * ease;
    // The shadow lies on whatever is below, fading with height.
    const height = this.y - this.floor;
    this.shadow.position.set(this.x * CELL_SIZE, this.floor - SKIDS + 0.008, this.z * CELL_SIZE);
    this.shadow.rotation.y = this.yaw;
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 / (1 + height * 0.6);
  }

  gauge(): [string, string] {
    return [String(Math.round(this.y * METRES_PER_CELL)), 'm altitude'];
  }

  shot(view: number, out: CameraShot): void {
    const cx = this.x * CELL_SIZE, cz = this.z * CELL_SIZE;
    if (view === 1) {
      const fx = Math.cos(this.yaw), fz = -Math.sin(this.yaw);
      out.position.set(cx + fx * 0.14, this.y + 0.2, cz + fz * 0.14);
      out.look.set(cx + fx * 4, this.y - 0.8, cz + fz * 4);
      out.rigid = true;
      return;
    }
    const fx = Math.cos(this.camYaw), fz = -Math.sin(this.camYaw);
    const [back, up] = view === 0 ? [1.9 + this.v * 0.08, 0.75] : [4.5, 5];
    out.position.set(cx - fx * back, this.y + up, cz - fz * back);
    out.look.set(cx + fx * 1.2, this.y - (view === 0 ? 0.1 : 0.5), cz + fz * 1.2);
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

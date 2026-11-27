import type * as THREE from 'three';
import type { ExploreWorld } from './ExploreWorld.js';

export type ExploreKind = 'drive' | 'walk' | 'fly' | 'boat';

/** Held controls, merged from keyboard and touch. */
export interface ExploreInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  /** Space: brake, jump, or climb depending on the mode. */
  action: boolean;
  /** Shift: run, or descend when flying. */
  shift: boolean;
  /** Mouse/touch drag since last frame, in pixels. */
  lookX: number;
  lookY: number;
}

export interface CameraShot {
  position: THREE.Vector3;
  look: THREE.Vector3;
  /** Follow the target without easing (first-person views). */
  rigid: boolean;
}

/** Something the player can take through the city: a car, a person, a helicopter, a boat. */
export interface Traveller {
  readonly kind: ExploreKind;
  readonly object: THREE.Object3D;
  /** Camera views V cycles through. */
  readonly views: readonly string[];
  x: number;
  z: number;
  yaw: number;
  /** Speed in cells per second (signed for vehicles that reverse). */
  v: number;

  /** Finds a starting spot near (x, z); false if there is none close enough. */
  place(world: ExploreWorld, x: number, z: number, strict: boolean): boolean;
  update(dt: number, input: ExploreInput, world: ExploreWorld): void;
  /** Number and unit for the HUD gauge. */
  gauge(): [value: string, unit: string];
  shot(view: number, out: CameraShot): void;
  /** Told when the camera view changes (to hide the body in first person). */
  setView?(view: number): void;
  dispose(): void;
}

export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Moves `value` towards `target` by at most `rate * dt`. */
export function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

/** One cell is roughly 5 m. */
export const METRES_PER_CELL = 5;

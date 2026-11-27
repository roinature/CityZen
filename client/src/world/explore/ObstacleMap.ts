/** A box standing on the ground, in cells. */
export interface Obstacle {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Height of the top, in cells. */
  top: number;
}

/** Below this, a box is something you step over rather than walk into. */
export const STEP_HEIGHT = 0.08;

/**
 * Building footprints bucketed by cell, so explore modes can ask "what is
 * standing here, and how tall" without touching the meshes.
 */
export class ObstacleMap {
  private buckets: Obstacle[][];

  constructor(private size: number, obstacles: readonly Obstacle[]) {
    this.buckets = Array.from({ length: size * size }, () => []);
    for (const o of obstacles) {
      if (o.top < STEP_HEIGHT) continue;
      const cx0 = Math.max(0, Math.floor(o.x0)), cx1 = Math.min(size - 1, Math.floor(o.x1 - 1e-6));
      const cz0 = Math.max(0, Math.floor(o.z0)), cz1 = Math.min(size - 1, Math.floor(o.z1 - 1e-6));
      for (let x = cx0; x <= cx1; x++) for (let z = cz0; z <= cz1; z++) this.buckets[x * size + z].push(o);
    }
  }

  private bucket(x: number, z: number): readonly Obstacle[] {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= this.size || cz >= this.size) return [];
    return this.buckets[cx * this.size + cz];
  }

  /** Height of whatever stands at this point; 0 for open ground. */
  heightAt(x: number, z: number): number {
    let top = 0;
    for (const o of this.bucket(x, z)) {
      if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && o.top > top) top = o.top;
    }
    return top;
  }

  /** Tallest thing within `radius` of a point. */
  heightNear(x: number, z: number, radius: number): number {
    let top = 0;
    for (let cx = Math.floor(x - radius); cx <= Math.floor(x + radius); cx++) {
      for (let cz = Math.floor(z - radius); cz <= Math.floor(z + radius); cz++) {
        for (const o of this.bucket(cx + 0.5, cz + 0.5)) {
          if (o.top <= top) continue;
          const dx = Math.max(o.x0 - x, 0, x - o.x1);
          const dz = Math.max(o.z0 - z, 0, z - o.z1);
          if (dx * dx + dz * dz <= radius * radius) top = o.top;
        }
      }
    }
    return top;
  }

  /** Whether a circle of `radius` at height `y` runs into anything taller than y. */
  hits(x: number, z: number, radius: number, y = 0): boolean {
    return this.heightNear(x, z, radius) > y;
  }
}

import * as THREE from 'three';

export type Point = readonly [x: number, z: number];

/** Collects flat-shaded, vertex-coloured triangles into one geometry. */
export class MeshBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private color = new THREE.Color();

  private push(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(this.color.r, this.color.g, this.color.b);
  }

  /** Upward-facing convex polygon, in either winding. */
  polygon(points: readonly Point[], y: number, color: number): void {
    this.color.setHex(color);
    const [a] = points;
    for (let i = 1; i + 1 < points.length; i++) {
      let b = points[i];
      let c = points[i + 1];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0) [b, c] = [c, b];
      for (const [x, z] of [a, b, c]) this.push(x, y, z, 0, 1, 0);
    }
  }

  rect(x0: number, z0: number, x1: number, z1: number, y: number, color: number): void {
    this.polygon([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y, color);
  }

  sector(x: number, z: number, radius: number, from: number, to: number, y: number, color: number): void {
    this.polygon([[x, z], ...arc(x, z, radius, from, to)], y, color);
  }

  /** Ring segment; narrower than a sector and safe for any sweep. */
  ring(x: number, z: number, inner: number, outer: number, from: number, to: number, y: number, color: number): void {
    const a = arc(x, z, inner, from, to);
    const b = arc(x, z, outer, from, to);
    for (let i = 0; i + 1 < a.length; i++) this.polygon([a[i], b[i], b[i + 1], a[i + 1]], y, color);
  }

  /** Vertical face along a-b, visible from both sides. */
  wall(a: Point, b: Point, y0: number, y1: number, color: number): void {
    this.color.setHex(color);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = (b[1] - a[1]) / length;
    const nz = (a[0] - b[0]) / length;
    const quad = [[a, y0], [b, y1], [b, y0], [a, y0], [a, y1], [b, y1]] as const;
    for (const [p, y] of quad) this.push(p[0], y, p[1], nx, 0, nz);
  }

  walls(points: readonly Point[], y0: number, y1: number, color: number): void {
    for (let i = 0; i + 1 < points.length; i++) this.wall(points[i], points[i + 1], y0, y1, color);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export function arc(x: number, z: number, radius: number, from: number, to: number): Point[] {
  const steps = Math.max(3, Math.ceil(Math.abs(to - from) / 0.2));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [x + Math.cos(a) * radius, z + Math.sin(a) * radius] as const;
  });
}

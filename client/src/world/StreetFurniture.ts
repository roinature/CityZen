import * as THREE from 'three';
import { BuildingType, CELL_SIZE, ZoneDensity, isRoad, type PlacedBuilding } from '@cityzen/shared';
import type { CityStyle } from './CityStyle.js';
import { SIDES, SIDEWALK, WALK_Y, isPaved, type RoadMap } from './RoadSurface.js';
import { findDepotDriveway, isFleetBuilding, isPointInDriveway, type DepotDriveway } from './DepotDriveway.js';

interface Tree {
  x: number;
  z: number;
  scale: number;
  roll: number;
  /** Planted in a pit in the sidewalk. */
  pit?: boolean;
}

/** A small item on the sidewalk, turned to face the road along (fx, fz). */
interface Item {
  x: number;
  z: number;
  fx: number;
  fz: number;
}

const LAMP_HEIGHT = 0.82;
const PARKED_CARS = [0xb8352f, 0x2f5f9e, 0xd8d8d4, 0x30343a, 0x7d8a92, 0xc9a23a];

function roll(x: number, z: number, salt: number): number {
  const v = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/** Trees, street lamps and parked cars, instanced. */
export class StreetFurniture {
  readonly group = new THREE.Group();
  private glow: THREE.MeshBasicMaterial | null = null;
  private glowTexture = createGlowTexture();
  private nightAmount = 0;

  constructor() {
    this.group.name = 'street-furniture';
  }

  setNight(amount: number): void {
    this.nightAmount = amount;
    if (!this.glow) return;
    this.glow.opacity = amount * 0.6;
    this.glow.visible = amount > 0.01;
  }

  rebuild(
    buildings: readonly PlacedBuilding[], roads: RoadMap, gridSize: number, style: CityStyle, showTrees: boolean,
    isWater: (x: number, z: number) => boolean = () => false,
  ): void {
    this.clear();
    const lots = new Map<string, PlacedBuilding>();
    const driveways: DepotDriveway[] = [];
    for (const b of buildings) {
      if (!isRoad(b.type)) {
        lots.set(`${b.position.x},${b.position.z}`, b);
        if (isFleetBuilding(b.type)) {
          const dw = findDepotDriveway(b, roads);
          if (dw.hasRoad) driveways.push(dw);
        }
      }
    }

    const trees: Tree[] = [];
    const lamps: Array<{ x: number; z: number; dx: number; dz: number }> = [];
    const cars: Array<{ x: number; z: number; roll: number }> = [];
    const hydrants: Item[] = [];
    const bins: Item[] = [];
    const benches: Item[] = [];
    const signs: Item[] = [];
    const road = (x: number, z: number) => roads.get(`${x},${z}`);

    for (const { x, z, type, building } of roads.values()) {
      if (!isPaved(type)) continue;
      if (type === BuildingType.ROAD_ROUNDABOUT) {
        if (building.position.x + 1 === x && building.position.z + 1 === z) trees.push({ x: x + 0.5, z: z + 0.5, scale: 1.1, roll: roll(x, z, 1) });
        continue;
      }
      if (SIDES.filter(([dx, dz]) => road(x + dx, z + dz)).length > 2) {
        // A street-name sign on one corner of the junction.
        for (let d = 0; d < 4; d++) {
          const [dx, dz] = SIDES[d];
          const [ax, az] = SIDES[(d + 1) & 3];
          if (!road(x + dx, z + dz) || !road(x + ax, z + az) || road(x + dx + ax, z + dz + az) || isWater(x + dx + ax, z + dz + az)) continue;
          const inset = 0.5 + SIDEWALK * 0.55;
          signs.push({ x: x + 0.5 + (dx + ax) * inset, z: z + 0.5 + (dz + az) * inset, fx: dx, fz: dz });
          break;
        }
      }
      for (let d = 0; d < 4; d++) {
        const [dx, dz] = SIDES[d];
        const [ax, az] = SIDES[(d + 1) & 3];
        const lx = x + dx, lz = z + dz;
        if (lx < 0 || lz < 0 || lx >= gridSize || lz >= gridSize || road(lx, lz) || isWater(lx, lz)) continue;
        // Only along straight runs, clear of corners and crossings.
        const straight = [1, -1].every(k => road(x + ax * k, z + az * k) && !road(lx + ax * k, lz + az * k));
        if (!straight) continue;
        const along = dx ? z : x;
        const at = (inset: number, shift: number) => ({
          x: x + 0.5 + dx * (0.5 + inset) + ax * shift,
          z: z + 0.5 + dz * (0.5 + inset) + az * shift,
        });
        const phase = (along + (d > 1 ? 1 : 0)) % 3;
        const lot = lots.get(`${lx},${lz}`)?.type;
        const facing = { fx: -dx, fz: -dz };
        const clear = (pt: { x: number; z: number }) => !isPointInDriveway(pt.x, pt.z, driveways);
        if (phase === 0) {
          const pt = at(SIDEWALK * 0.7, 0);
          if (clear(pt)) trees.push({ ...pt, scale: 0.62 + roll(x, z, d) * 0.2, roll: roll(x, z, d + 7), pit: true });
        }
        if (phase === 2) {
          const lp = at(0.05, 0);
          if (clear(lp)) lamps.push({ ...lp, dx: -dx, dz: -dz });
          const hp = at(0.05, 0.3);
          if (roll(x, z, d + 30) < 0.3 && clear(hp)) hydrants.push({ ...hp, ...facing });
        }
        if (phase === 1) {
          const shops = lot === BuildingType.ZONE_COMMERCIAL;
          const bp = at(SIDEWALK * 0.62, 0.05);
          if ((shops || lot === BuildingType.PARK) && roll(x, z, d + 40) < 0.55 && clear(bp)) benches.push({ ...bp, ...facing });
          const binp = at(0.06, -0.26);
          if ((shops || lot === BuildingType.ZONE_RESIDENTIAL) && roll(x, z, d + 50) < (shops ? 0.6 : 0.2) && clear(binp)) bins.push({ ...binp, ...facing });
        }
      }
    }

    for (const b of lots.values()) {
      const { x, z } = b.position;
      if (b.type === BuildingType.PARK) {
        for (let i = 0; i < 5; i++) {
          const a = i * 1.257 + roll(x, z, 3) * 6;
          const r = 0.24 + roll(x, z, i + 20) * 0.16;
          trees.push({ x: x + 0.5 + Math.cos(a) * r, z: z + 0.5 + Math.sin(a) * r, scale: 0.6 + roll(x, z, i) * 0.45, roll: roll(x, z, i + 40) });
        }
      } else if (b.type === BuildingType.PARKING) {
        for (const row of [0.29, 0.71]) {
          for (let i = 0; i < 3; i++) {
            if (roll(x + i, z + row, 2) < 0.6) cars.push({ x: x + 0.353 + i * 0.147, z: z + row, roll: roll(x + i, z + row, 8) });
          }
        }
      } else if (b.type === BuildingType.ZONE_RESIDENTIAL && b.density === ZoneDensity.LOW && b.developmentLevel) {
        // A tree in the back garden, away from the street.
        if (roll(x, z, 4) < 0.35) continue;
        const front = SIDES.filter(([dx, dz]) => road(x + dx, z + dz));
        if (front.length !== 1) continue;
        const [[dx, dz]] = front;
        const side = (roll(x, z, 6) - 0.5) * 0.7;
        trees.push({ x: x + 0.5 - dx * 0.38 + dz * side, z: z + 0.5 - dz * 0.38 + dx * side, scale: 0.55 + roll(x, z, 5) * 0.35, roll: roll(x, z, 9) });
      }
    }

    if (showTrees) this.addTrees(trees, style);
    this.addLamps(lamps);
    this.addCars(cars);
    this.addStreetItems(showTrees ? trees.filter(tree => tree.pit) : [], hydrants, bins, benches, signs);
    this.setNight(this.nightAmount);
  }

  private batch(geometry: THREE.BufferGeometry, material: THREE.Material, count: number, shadows = true): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  private addTrees(trees: Tree[], style: CityStyle): void {
    const pines = trees.filter(tree => tree.roll < 0.28);
    const broad = trees.filter(tree => tree.roll >= 0.28);
    if (!trees.length) return;
    const t = new THREE.Object3D();
    const color = new THREE.Color();
    const leaf = () => new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
    const trunks = this.batch(new THREE.CylinderGeometry(0.028, 0.04, 0.4, 5).translate(0, 0.2, 0),
      new THREE.MeshStandardMaterial({ color: 0x6b4f35, roughness: 1 }), trees.length);
    const place = (mesh: THREE.InstancedMesh, i: number, tree: Tree, stretch = 1) => {
      t.position.set(tree.x * CELL_SIZE, 0.03, tree.z * CELL_SIZE);
      t.rotation.y = tree.roll * 40;
      t.scale.set(tree.scale, tree.scale * stretch, tree.scale).multiplyScalar(CELL_SIZE);
      t.updateMatrix();
      mesh.setMatrixAt(i, t.matrix);
    };
    const tint = (colors: number[], tree: Tree) =>
      color.setHex(colors[Math.floor(tree.roll * 97) % colors.length]).multiplyScalar(0.88 + ((tree.roll * 31) % 1) * 0.24);
    trees.forEach((tree, i) => place(trunks, i, tree));
    if (pines.length) {
      const mesh = this.batch(new THREE.ConeGeometry(0.24, 0.85, 7).translate(0, 0.62, 0), leaf(), pines.length);
      pines.forEach((tree, i) => {
        place(mesh, i, tree, 1.1);
        mesh.setColorAt(i, tint(style.pines, tree));
      });
    }
    if (broad.length) {
      const mesh = this.batch(new THREE.IcosahedronGeometry(0.3, 1).translate(0, 0.62, 0), leaf(), broad.length);
      broad.forEach((tree, i) => {
        place(mesh, i, tree, 1 + ((tree.roll * 17) % 1) * 0.2);
        mesh.setColorAt(i, tint(style.leaves, tree));
      });
    }
  }

  private addLamps(lamps: Array<{ x: number; z: number; dx: number; dz: number }>): void {
    if (!lamps.length) return;
    const metal = new THREE.MeshStandardMaterial({ color: 0x454a50, roughness: 0.7 });
    const posts = this.batch(new THREE.CylinderGeometry(0.011, 0.017, LAMP_HEIGHT, 5), metal, lamps.length);
    const heads = this.batch(new THREE.BoxGeometry(0.16, 0.02, 0.045), metal, lamps.length);
    this.glow = new THREE.MeshBasicMaterial({
      color: 0xffc77a, map: this.glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pools = this.batch(new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2), this.glow, lamps.length, false);
    const t = new THREE.Object3D();
    lamps.forEach(({ x, z, dx, dz }, i) => {
      t.rotation.y = dx ? 0 : Math.PI / 2;
      t.position.set(x * CELL_SIZE, WALK_Y + LAMP_HEIGHT / 2, z * CELL_SIZE);
      t.updateMatrix();
      posts.setMatrixAt(i, t.matrix);
      t.position.set((x + dx * 0.07) * CELL_SIZE, WALK_Y + LAMP_HEIGHT, (z + dz * 0.07) * CELL_SIZE);
      t.updateMatrix();
      heads.setMatrixAt(i, t.matrix);
      t.position.set((x + dx * 0.2) * CELL_SIZE, WALK_Y + 0.02, (z + dz * 0.2) * CELL_SIZE);
      t.updateMatrix();
      pools.setMatrixAt(i, t.matrix);
    });
  }

  private addCars(cars: Array<{ x: number; z: number; roll: number }>): void {
    if (!cars.length) return;
    const t = new THREE.Object3D();
    const color = new THREE.Color();
    const bodies = this.batch(new THREE.BoxGeometry(0.1, 0.045, 0.22), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }), cars.length);
    const cabins = this.batch(new THREE.BoxGeometry(0.086, 0.04, 0.11), new THREE.MeshStandardMaterial({ color: 0x20262c, roughness: 0.15, metalness: 0.6 }), cars.length);
    const wheels = this.batch(new THREE.CylinderGeometry(0.022, 0.022, 0.104, 10).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.9 }), cars.length * 2);
    cars.forEach(({ x, z, roll: r }, i) => {
      t.position.set(x * CELL_SIZE, 0.0725, z * CELL_SIZE);
      t.updateMatrix();
      bodies.setMatrixAt(i, t.matrix);
      bodies.setColorAt(i, color.setHex(PARKED_CARS[Math.floor(r * PARKED_CARS.length)]));
      t.position.y = 0.115;
      t.updateMatrix();
      cabins.setMatrixAt(i, t.matrix);
      // One axle at each end; each cylinder spans both wheels.
      for (const [k, dz] of [[0, -0.068], [1, 0.068]] as const) {
        t.position.set(x * CELL_SIZE, 0.052, (z + dz) * CELL_SIZE);
        t.updateMatrix();
        wheels.setMatrixAt(i * 2 + k, t.matrix);
      }
    });
  }

  /** Tree pits, fire hydrants, litter bins, benches and street-name signs. */
  private addStreetItems(pits: Tree[], hydrants: Item[], bins: Item[], benches: Item[], signs: Item[]): void {
    const t = new THREE.Object3D();
    const mat = (color: number, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });
    const put = (mesh: THREE.InstancedMesh, i: number, item: { x: number; z: number; fx?: number; fz?: number }, y: number, along = 0, out = 0) => {
      const fx = item.fx ?? 0, fz = item.fz ?? 1;
      // Local +z faces the road, local +x runs along the street.
      t.rotation.y = Math.atan2(fx, fz);
      t.position.set((item.x - fz * along + fx * out) * CELL_SIZE, y, (item.z + fx * along + fz * out) * CELL_SIZE);
      t.updateMatrix();
      mesh.setMatrixAt(i, t.matrix);
    };
    const each = <T>(list: T[], geometry: THREE.BufferGeometry, material: THREE.Material, place: (mesh: THREE.InstancedMesh, item: T, i: number) => void, shadows = true) => {
      if (!list.length) return;
      const mesh = this.batch(geometry, material, list.length, shadows);
      list.forEach((item, i) => place(mesh, item, i));
    };

    each(pits, new THREE.PlaneGeometry(0.11, 0.11).rotateX(-Math.PI / 2), mat(0x4a3b2c, 1), (m, p, i) => put(m, i, p, WALK_Y + 0.004), false);

    const red = mat(0xb8322a, 0.5);
    each(hydrants, new THREE.CylinderGeometry(0.011, 0.013, 0.045, 8), red, (m, h, i) => put(m, i, h, WALK_Y + 0.0225));
    each(hydrants, new THREE.SphereGeometry(0.012, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), red, (m, h, i) => put(m, i, h, WALK_Y + 0.045));
    each(hydrants, new THREE.CylinderGeometry(0.005, 0.005, 0.034, 6).rotateZ(Math.PI / 2), mat(0x9a9ea3, 0.4), (m, h, i) => put(m, i, h, WALK_Y + 0.03));

    each(bins, new THREE.CylinderGeometry(0.016, 0.014, 0.05, 10), mat(0x2f4a3a, 0.6), (m, b, i) => put(m, i, b, WALK_Y + 0.025));
    each(bins, new THREE.CylinderGeometry(0.018, 0.018, 0.006, 10), mat(0x22362b, 0.6), (m, b, i) => put(m, i, b, WALK_Y + 0.053));

    const wood = mat(0x8a5a35, 0.8), iron = mat(0x2c2f33, 0.5);
    each(benches, new THREE.BoxGeometry(0.12, 0.007, 0.034), wood, (m, b, i) => put(m, i, b, WALK_Y + 0.03));
    each(benches, new THREE.BoxGeometry(0.12, 0.028, 0.006), wood, (m, b, i) => put(m, i, b, WALK_Y + 0.05, 0, -0.017));
    each([...benches, ...benches], new THREE.BoxGeometry(0.008, 0.03, 0.03), iron, (m, b, i) => put(m, i, b, WALK_Y + 0.015, i < benches.length ? -0.05 : 0.05));

    const green = mat(0x2e7a4c, 0.45);
    each(signs, new THREE.CylinderGeometry(0.007, 0.008, 0.3, 6), mat(0x50555b, 0.5), (m, s, i) => put(m, i, s, WALK_Y + 0.15));
    each(signs, new THREE.BoxGeometry(0.11, 0.022, 0.004), green, (m, s, i) => put(m, i, s, WALK_Y + 0.29));
    each(signs, new THREE.BoxGeometry(0.004, 0.022, 0.11), green, (m, s, i) => put(m, i, s, WALK_Y + 0.264));
  }

  clear(): void {
    this.glow = null;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (!(child instanceof THREE.InstancedMesh)) continue;
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
      child.dispose();
    }
  }
}

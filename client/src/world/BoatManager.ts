import * as THREE from 'three';
import type { Rideable } from './CarManager.js';
import {
  BuildingType,
  CELL_SIZE,
  canDockBoats,
  getEffectiveSize,
  getWaterfrontFacing,
  type CityState,
  type Grid,
  type PlacedBuilding,
  type WaterfrontFacing,
} from '@cityzen/shared';

export type BoatKind = 'cargo' | 'ferry' | 'sailboat' | 'yacht' | 'fishing';

interface VesselSpec {
  length: number;
  beam: number;
  speed: number;
  bobAmp: number;
  bobFreq: number;
  rollAmp: number;
}

const VESSEL_SPECS: Record<BoatKind, VesselSpec> = {
  cargo: { length: 1.32, beam: 0.34, speed: 1.0, bobAmp: 0.008, bobFreq: 1.4, rollAmp: 0.02 },
  ferry: { length: 0.96, beam: 0.28, speed: 1.4, bobAmp: 0.011, bobFreq: 1.8, rollAmp: 0.03 },
  sailboat: { length: 0.66, beam: 0.2, speed: 0.95, bobAmp: 0.016, bobFreq: 2.3, rollAmp: 0.065 },
  yacht: { length: 0.72, beam: 0.22, speed: 1.6, bobAmp: 0.014, bobFreq: 2.2, rollAmp: 0.045 },
  fishing: { length: 0.7, beam: 0.24, speed: 1.15, bobAmp: 0.015, bobFreq: 2.1, rollAmp: 0.055 },
};

const WATER_Y = 0.012;
const FADE_SECONDS = 0.6;
const ACCEL = 0.9;
const BRAKE = 1.4;

export interface Berth {
  id: string;
  buildingId: string;
  buildingType: BuildingType;
  /** World-cell position where the vessel moors. */
  x: number;
  z: number;
  /** World-cell open-water staging point outside the slip/quay. */
  approachX: number;
  approachZ: number;
  /** Grid cell coordinates for A* routing to the approach point. */
  approachCellX: number;
  approachCellZ: number;
  /** Yaw while moored at the berth. */
  dockYaw: number;
  allowedKinds: readonly BoatKind[];
}

interface PolyPath {
  xs: number[];
  zs: number[];
  ss: number[];
  length: number;
}

export type BoatPhase = 'cruising' | 'docking' | 'docked' | 'undocking' | 'departing';

export interface BuildingMaritimeVessel {
  id: number;
  kind: BoatKind;
  phase: BoatPhase;
  berthId: string;
  x: number;
  z: number;
}

export interface BuildingMaritimeStatus {
  totalBerths: number;
  occupiedBerths: number;
  allowedKinds: BoatKind[];
  vessels: BuildingMaritimeVessel[];
}

interface Boat {
  id: number;
  kind: BoatKind;
  spec: VesselSpec;
  mesh: THREE.Group;
  wake: THREE.Mesh;
  phase: BoatPhase;
  path: PolyPath;
  s: number;
  seg: number;
  v: number;
  x: number;
  z: number;
  yaw: number;
  targetBerth: Berth | null;
  dockTimer: number;
  bobSeed: number;
  age: number;
  leaving: number;
}

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function facingNormal(facing: WaterfrontFacing): [number, number] {
  switch (facing) {
    case 'N': return [0, -1];
    case 'S': return [0, 1];
    case 'W': return [-1, 0];
    case 'E': return [1, 0];
  }
}

function waterSignature(state: CityState): string {
  let sig = `${state.id}:${state.siteId ?? ''}:${state.grid.length}|`;
  for (const b of state.buildings) {
    if (canDockBoats(b.type)) {
      sig += `${b.id}@${b.type},${b.position.x},${b.position.z},${b.orientation ?? ''};`;
    }
  }
  return sig;
}

const DIRS8 = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
] as const;

/**
 * Indexes navigable water cells, map-edge shipping entrances, and port/marina berths.
 */
export class WaterNetwork {
  readonly size: number;
  readonly navigable: Uint8Array;
  readonly clearance: Uint8Array;
  readonly component: Int32Array;
  readonly waterCount: number;
  readonly edgeGates: Array<{ x: number; z: number; comp: number }> = [];
  readonly openWaypoints: Array<{ x: number; z: number; comp: number }> = [];
  readonly berths: Berth[] = [];

  constructor(grid: Grid, buildings: readonly PlacedBuilding[]) {
    const n = grid.length;
    this.size = n;
    this.navigable = new Uint8Array(n * n);
    this.clearance = new Uint8Array(n * n);
    this.component = new Int32Array(n * n).fill(-1);

    let water = 0;
    const bfsQueue = new Int32Array(n * n);
    let head = 0, tail = 0;

    for (let x = 0; x < n; x++) {
      for (let z = 0; z < n; z++) {
        const idx = x * n + z;
        const cell = grid[x]?.[z];
        if (cell?.terrain === 'water' && cell.buildingId === null) {
          this.navigable[idx] = 1;
          this.clearance[idx] = 255;
          water++;
        } else {
          this.clearance[idx] = 0;
          bfsQueue[tail++] = idx;
        }
      }
    }
    this.waterCount = water;
    if (water === 0) return;

    // Multi-source BFS for shore/pier clearance distance
    while (head < tail) {
      const cur = bfsQueue[head++];
      const cx = Math.floor(cur / n), cz = cur % n;
      const nextDist = Math.min(254, this.clearance[cur] + 1);
      for (let i = 0; i < 4; i++) {
        const nx = cx + DIRS8[i][0], nz = cz + DIRS8[i][1];
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        const nIdx = nx * n + nz;
        if (this.clearance[nIdx] > nextDist) {
          this.clearance[nIdx] = nextDist;
          bfsQueue[tail++] = nIdx;
        }
      }
    }

    // Connected water components so boats only pick mutually reachable endpoints
    let nextComp = 0;
    const compSizes: number[] = [];
    for (let x = 0; x < n; x++) {
      for (let z = 0; z < n; z++) {
        const startIdx = x * n + z;
        if (!this.navigable[startIdx] || this.component[startIdx] >= 0) continue;
        const compId = nextComp++;
        let count = 0;
        let qh = 0, qt = 0;
        bfsQueue[qt++] = startIdx;
        this.component[startIdx] = compId;
        while (qh < qt) {
          const cur = bfsQueue[qh++];
          count++;
          const cx = Math.floor(cur / n), cz = cur % n;
          for (let i = 0; i < 4; i++) {
            const nx = cx + DIRS8[i][0], nz = cz + DIRS8[i][1];
            if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
            const nIdx = nx * n + nz;
            if (this.navigable[nIdx] && this.component[nIdx] < 0) {
              this.component[nIdx] = compId;
              bfsQueue[qt++] = nIdx;
            }
          }
        }
        compSizes.push(count);
      }
    }

    // Collect map-edge water gates (spaced cleanly, away from immediate rocks where possible)
    const addEdgeCandidate = (x: number, z: number) => {
      const idx = x * n + z;
      if (!this.navigable[idx]) return;
      const comp = this.component[idx];
      if (compSizes[comp] < 12) return;
      if (this.clearance[idx] < 2) return;
      if (this.edgeGates.some(g => Math.abs(g.x - x) + Math.abs(g.z - z) < 3)) return;
      this.edgeGates.push({ x, z, comp });
    };
    for (let i = 1; i < n - 1; i++) {
      addEdgeCandidate(0, i);
      addEdgeCandidate(n - 1, i);
      addEdgeCandidate(i, 0);
      addEdgeCandidate(i, n - 1);
    }

    // Collect open cruising waypoints for inland lakes or coastal variety
    for (let x = 2; x < n - 2; x += 4) {
      for (let z = 2; z < n - 2; z += 4) {
        const idx = x * n + z;
        if (!this.navigable[idx] || this.clearance[idx] < 2) continue;
        const comp = this.component[idx];
        if (compSizes[comp] >= 16) this.openWaypoints.push({ x, z, comp });
      }
    }

    this.discoverBerths(grid, buildings, compSizes);
  }

  isNavigable(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.size && z < this.size && this.navigable[x * this.size + z] === 1;
  }

  private findNearestNavigable(cx: number, cz: number, maxRadius = 3): [number, number] | null {
    const rx = Math.round(cx), rz = Math.round(cz);
    if (this.isNavigable(rx, rz)) return [rx, rz];
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      for (let dz = -maxRadius; dz <= maxRadius; dz++) {
        const x = rx + dx, z = rz + dz;
        if (!this.isNavigable(x, z)) continue;
        const d = (x + 0.5 - cx) ** 2 + (z + 0.5 - cz) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [x, z];
        }
      }
    }
    return best;
  }

  private discoverBerths(grid: Grid, buildings: readonly PlacedBuilding[], compSizes: readonly number[]): void {
    for (const b of buildings) {
      if (!canDockBoats(b.type)) continue;
      const facing = getWaterfrontFacing(grid, b.position, b.type, b.orientation, true);
      if (!facing) continue;

      const { w, d } = getEffectiveSize(b.type, b.orientation);
      const [nx, nz] = facingNormal(facing);
      // Tangent vector along the shoreline
      const tx = -nz, tz = nx;
      const centerX = b.position.x + w / 2;
      const centerZ = b.position.z + d / 2;
      const halfOut = (facing === 'N' || facing === 'S' ? d : w) / 2;

      const slots: Array<{
        suffix: string;
        alongOffset: number;
        outDist: number;
        bowIn: boolean;
        kinds: readonly BoatKind[];
      }> = b.type === BuildingType.WATERFRONT_MARINA
        ? [
            { suffix: 'a', alongOffset: -0.65, outDist: 0.72, bowIn: true, kinds: ['sailboat', 'yacht'] },
            { suffix: 'b', alongOffset: 0.65, outDist: 0.72, bowIn: true, kinds: ['yacht', 'sailboat'] },
          ]
        : b.type === BuildingType.WATERFRONT_FERRY
          ? [{ suffix: 'slip', alongOffset: 0, outDist: 0.78, bowIn: true, kinds: ['ferry'] }]
          : b.type === BuildingType.WATERFRONT_DOCK
            ? [{ suffix: 'pier', alongOffset: 0.05, outDist: 0.68, bowIn: false, kinds: ['fishing', 'yacht', 'sailboat'] }]
            : [
                { suffix: 'quay', alongOffset: -0.15, outDist: 0.85, bowIn: false, kinds: ['cargo', 'cargo', 'fishing'] },
              ];

      for (const slot of slots) {
        const bx = centerX + nx * (halfOut + slot.outDist) + tx * slot.alongOffset;
        const bz = centerZ + nz * (halfOut + slot.outDist) + tz * slot.alongOffset;
        const berthCell = this.findNearestNavigable(bx - 0.5, bz - 0.5, 2);
        if (!berthCell) continue;
        const comp = this.component[berthCell[0] * this.size + berthCell[1]];
        if (comp < 0 || compSizes[comp] < 12) continue;

        // Find open-water approach point 3..4 cells outward from the water face
        let appCell: [number, number] | null = null;
        for (const dist of [3.6, 2.6, 1.8]) {
          const ax = centerX + nx * (halfOut + dist) + tx * slot.alongOffset;
          const az = centerZ + nz * (halfOut + dist) + tz * slot.alongOffset;
          const c = this.findNearestNavigable(ax - 0.5, az - 0.5, 1);
          if (c && this.component[c[0] * this.size + c[1]] === comp) {
            appCell = c;
            break;
          }
        }
        appCell ??= berthCell;

        // Parallel to quay (along tangent) vs bow-in toward slip (-normal)
        const yaw = slot.bowIn
          ? Math.atan2(nz, -nx)
          : Math.atan2(-tz, tx);

        this.berths.push({
          id: `${b.id}:${slot.suffix}`,
          buildingId: b.id,
          buildingType: b.type,
          x: Math.max(0.6, Math.min(this.size - 0.6, bx)),
          z: Math.max(0.6, Math.min(this.size - 0.6, bz)),
          approachX: appCell[0] + 0.5,
          approachZ: appCell[1] + 0.5,
          approachCellX: appCell[0],
          approachCellZ: appCell[1],
          dockYaw: yaw,
          allowedKinds: slot.kinds,
        });
      }
    }
  }

  /** A* water route between two navigable cells, favoring offshore channel clearance. */
  findWaterPath(sx: number, sz: number, gx: number, gz: number): Array<[number, number]> | null {
    const n = this.size;
    if (!this.isNavigable(sx, sz) || !this.isNavigable(gx, gz)) return null;
    const startIdx = sx * n + sz;
    const goalIdx = gx * n + gz;
    if (this.component[startIdx] !== this.component[goalIdx]) return null;
    if (startIdx === goalIdx) return [[sx + 0.5, sz + 0.5]];

    const gScore = new Float32Array(n * n).fill(Infinity);
    const parent = new Int32Array(n * n).fill(-1);
    const closed = new Uint8Array(n * n);
    gScore[startIdx] = 0;

    // Simple binary min-heap
    const heapKeys: number[] = [Math.hypot(gx - sx, gz - sz)];
    const heapVals: number[] = [startIdx];
    const push = (k: number, v: number) => {
      let i = heapKeys.length;
      heapKeys.push(k);
      heapVals.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKeys[p] <= k) break;
        heapKeys[i] = heapKeys[p];
        heapVals[i] = heapVals[p];
        i = p;
      }
      heapKeys[i] = k;
      heapVals[i] = v;
    };
    const pop = (): number => {
      const top = heapVals[0];
      const lk = heapKeys.pop()!, lv = heapVals.pop()!;
      if (heapKeys.length > 0) {
        let i = 0;
        const len = heapKeys.length;
        for (;;) {
          let s = i;
          const l = i * 2 + 1, r = l + 1;
          if (l < len && heapKeys[l] < heapKeys[s]) s = l;
          if (r < len && heapKeys[r] < heapKeys[s]) s = r;
          if (s === i) break;
          heapKeys[i] = heapKeys[s];
          heapVals[i] = heapVals[s];
          i = s;
        }
        heapKeys[i] = lk;
        heapVals[i] = lv;
      }
      return top;
    };

    while (heapKeys.length > 0) {
      const cur = pop();
      if (cur === goalIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = Math.floor(cur / n), cz = cur % n;

      for (const [dx, dz, stepLen] of DIRS8) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.isNavigable(nx, nz)) continue;
        // Prevent diagonal clipping past land corners
        if (dx !== 0 && dz !== 0 && (!this.isNavigable(cx + dx, cz) || !this.isNavigable(cx, cz + dz))) continue;
        const nIdx = nx * n + nz;
        if (closed[nIdx]) continue;

        const nearEnd = Math.abs(nx - gx) + Math.abs(nz - gz) <= 3 || Math.abs(nx - sx) + Math.abs(nz - sz) <= 2;
        const shorePenalty = nearEnd ? 0 : 1.5 / Math.max(1, Math.min(5, this.clearance[nIdx]));
        const tentative = gScore[cur] + stepLen + shorePenalty;
        if (tentative < gScore[nIdx]) {
          gScore[nIdx] = tentative;
          parent[nIdx] = cur;
          push(tentative + Math.hypot(gx - nx, gz - nz), nIdx);
        }
      }
    }

    if (parent[goalIdx] < 0) return null;
    const raw: Array<[number, number]> = [];
    for (let at = goalIdx; at >= 0; at = parent[at]) {
      raw.push([Math.floor(at / n) + 0.5, (at % n) + 0.5]);
    }
    raw.reverse();
    return smoothWaterPoints(raw);
  }
}

/** Subdivides & rounds sharp polyline turns for fluid maritime steering. */
function smoothWaterPoints(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length <= 2) return points;
  // Thin collinear intermediate steps first, keeping every ~3rd point
  const sparse: Array<[number, number]> = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = sparse[sparse.length - 1];
    const next = points[i + 1];
    const cur = points[i];
    const cross = Math.abs((cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]));
    if (cross > 0.01 || Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) >= 2.8) {
      sparse.push(cur);
    }
  }
  sparse.push(points[points.length - 1]);

  // One Chaikin corner-cutting pass for natural curved wakes
  if (sparse.length <= 2) return sparse;
  const out: Array<[number, number]> = [sparse[0]];
  for (let i = 0; i < sparse.length - 1; i++) {
    const [ax, az] = sparse[i];
    const [bx, bz] = sparse[i + 1];
    if (i > 0) out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
    if (i < sparse.length - 2) out.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
  }
  out.push(sparse[sparse.length - 1]);
  return out;
}

function buildPolyPath(points: ReadonlyArray<[number, number]>): PolyPath {
  const xs: number[] = [];
  const zs: number[] = [];
  const ss: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    if (i > 0) {
      const dist = Math.hypot(x - xs[xs.length - 1], z - zs[zs.length - 1]);
      if (dist < 1e-4) continue;
      total += dist;
    }
    xs.push(x);
    zs.push(z);
    ss.push(total);
  }
  if (xs.length === 1) {
    xs.push(xs[0] + 0.01);
    zs.push(zs[0]);
    ss.push(0.01);
    total = 0.01;
  }
  return { xs, zs, ss, length: total };
}

/**
 * Simulates passing maritime vessels and boats docking at waterfront ports,
 * docks, marinas, ferry terminals, and harbors.
 */
export class BoatManager {
  private scene: THREE.Scene;
  private boats: Boat[] = [];
  private riding: Boat | null = null;
  private network: WaterNetwork | null = null;
  private occupiedBerths = new Set<string>();
  private sig = '';
  private enabled = true;
  private maxBoats = 14;
  private nextId = 1;
  private time = 0;
  private spawnCooldown = 0;
  private nightMaterial = new THREE.MeshStandardMaterial({
    color: 0x263238,
    emissive: 0xffcc77,
    emissiveIntensity: 0,
    roughness: 0.3,
  });

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  setMaxBoats(max: number): void {
    this.maxBoats = Math.max(0, max);
  }

  setNight(isNight: boolean): void {
    this.nightMaterial.emissiveIntensity = isNight ? 0.9 : 0.05;
  }

  /** The nearest moving boat within `radius` cells, for the player to ride along. */
  nearestRideable(x: number, z: number, radius: number, except?: Rideable | null): Rideable | null {
    let best: Boat | null = null;
    let bestD = radius * radius;
    for (const boat of this.boats) {
      if (boat === except || boat.leaving >= 0 || boat.age < FADE_SECONDS) continue;
      const d = (boat.x - x) ** 2 + (boat.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = boat;
      }
    }
    return best;
  }

  /** Marks the boat the player rides on: it keeps cruising instead of leaving the map. */
  setRiding(boat: Rideable | null): void {
    this.riding = boat && this.boats.includes(boat as Boat) ? boat as Boat : null;
  }

  /** The boat being ridden, or null once it has gone. */
  getRiding(): Rideable | null {
    return this.riding;
  }

  getBoats(): readonly { id: number; kind: BoatKind; phase: BoatPhase; x: number; z: number; berthId: string | null }[] {
    return this.boats.map(b => ({
      id: b.id,
      kind: b.kind,
      phase: b.phase,
      x: b.x,
      z: b.z,
      berthId: b.targetBerth?.id ?? null,
    }));
  }

  getBerths(): readonly Berth[] {
    return this.network?.berths ?? [];
  }

  /** Live berth & vessel status for a waterfront / harbor building. */
  getBuildingMaritimeStatus(buildingId: string, state?: CityState | null): BuildingMaritimeStatus {
    if (state) this.syncNetwork(state);
    const berths = (this.network?.berths ?? []).filter(b => b.buildingId === buildingId);
    const berthIds = new Set(berths.map(b => b.id));
    const allowedSet = new Set<BoatKind>();
    for (const berth of berths) {
      for (const k of berth.allowedKinds) allowedSet.add(k);
    }
    const vessels: BuildingMaritimeVessel[] = [];
    for (const b of this.boats) {
      if (b.leaving >= 0 || !b.targetBerth || !berthIds.has(b.targetBerth.id)) continue;
      vessels.push({
        id: b.id,
        kind: b.kind,
        phase: b.phase,
        berthId: b.targetBerth.id,
        x: b.x,
        z: b.z,
      });
    }
    return {
      totalBerths: berths.length,
      occupiedBerths: berths.filter(b => this.occupiedBerths.has(b.id)).length,
      allowedKinds: Array.from(allowedSet),
      vessels,
    };
  }

  /** Requests an inbound vessel for an open berth at `buildingId`. */
  dispatchVesselToBuilding(buildingId: string, state?: CityState | null): boolean {
    if (state) this.syncNetwork(state);
    const net = this.network;
    if (!net || !this.enabled) return false;
    const freeBerths = net.berths.filter(b => b.buildingId === buildingId && !this.occupiedBerths.has(b.id));
    if (!freeBerths.length) return false;
    for (const berth of freeBerths) {
      const berthComp = net.component[berth.approachCellX * net.size + berth.approachCellZ];
      const compGates = net.edgeGates.filter(g => g.comp === berthComp);
      const compPool = compGates.length > 0 ? compGates : net.openWaypoints.filter(w => w.comp === berthComp);
      if (!compPool.length) continue;
      for (let attempt = 0; attempt < 6; attempt++) {
        const gate = pick(compPool);
        if (Math.hypot(gate.x - berth.approachCellX, gate.z - berth.approachCellZ) < 4) continue;
        if (this.isCrowded(gate.x + 0.5, gate.z + 0.5, 1.8)) continue;
        const pts = net.findWaterPath(gate.x, gate.z, berth.approachCellX, berth.approachCellZ);
        if (!pts || pts.length < 2) continue;
        const kind = pick(berth.allowedKinds);
        this.occupiedBerths.add(berth.id);
        this.boats.push(this.instantiateBoat(kind, buildPolyPath(pts), berth));
        return true;
      }
    }
    return false;
  }

  clear(): void {
    for (const boat of this.boats) this.removeBoatMesh(boat);
    this.boats = [];
    this.riding = null;
    this.occupiedBerths.clear();
    this.network = null;
    this.sig = '';
  }

  update(deltaTime: number, state: CityState | null): void {
    if (!state || !this.enabled) return;
    const dt = Math.min(deltaTime, 0.05);
    this.time += dt;

    this.syncNetwork(state);
    const net = this.network;
    if (!net || net.waterCount < 12) return;

    this.adjustBoatCount(net, dt);

    for (let i = this.boats.length - 1; i >= 0; i--) {
      if (!this.stepBoat(this.boats[i], net, dt)) {
        const removed = this.boats[i];
        if (removed === this.riding) this.riding = null;
        if (removed.targetBerth) this.occupiedBerths.delete(removed.targetBerth.id);
        this.removeBoatMesh(removed);
        this.boats.splice(i, 1);
      }
    }
  }

  private syncNetwork(state: CityState): void {
    const nextSig = waterSignature(state);
    if (nextSig === this.sig && this.network) return;
    this.sig = nextSig;
    const net = new WaterNetwork(state.grid, state.buildings);
    this.network = net;

    const validBerths = new Map(net.berths.map(b => [b.id, b]));
    this.occupiedBerths.clear();

    for (const boat of this.boats) {
      if (boat.targetBerth) {
        const updated = validBerths.get(boat.targetBerth.id);
        if (!updated) {
          // Port was demolished: depart immediately
          boat.targetBerth = null;
          if (boat.phase === 'docked' || boat.phase === 'docking' || boat.phase === 'cruising') {
            this.beginDeparture(boat, net);
          }
        } else {
          boat.targetBerth = updated;
          this.occupiedBerths.add(updated.id);
        }
      }
      if (!net.isNavigable(Math.floor(boat.x), Math.floor(boat.z)) && boat.phase !== 'docked' && boat.phase !== 'docking' && boat.phase !== 'undocking') {
        if (boat.leaving < 0) boat.leaving = 0;
      }
    }
  }

  private adjustBoatCount(net: WaterNetwork, dt: number): void {
    if (this.maxBoats <= 0) {
      for (const b of this.boats) if (b.leaving < 0) b.leaving = 0;
      return;
    }
    const basePassing = Math.max(2, Math.floor(net.waterCount / 220));
    const portTraffic = net.berths.length * 2;
    const desired = Math.min(this.maxBoats, basePassing + portTraffic);

    let active = 0;
    for (const b of this.boats) if (b.leaving < 0) active++;

    for (let i = this.boats.length - 1; i >= 0 && active > desired; i--) {
      if (this.boats[i].leaving < 0 && this.boats[i].phase !== 'docked' && this.boats[i] !== this.riding) {
        this.boats[i].leaving = 0;
        active--;
      }
    }

    this.spawnCooldown -= dt;
    if (active >= desired || this.spawnCooldown > 0) return;
    this.spawnCooldown = 0.6;
    const spawned = this.spawnBoat(net);
    if (spawned) this.boats.push(spawned);
  }

  private spawnBoat(net: WaterNetwork): Boat | null {
    const starts = net.edgeGates.length >= 2 ? net.edgeGates : net.openWaypoints;
    if (starts.length < 2 && net.berths.length === 0) return null;

    const freeBerths = net.berths.filter(b => !this.occupiedBerths.has(b.id));
    const wantDock = freeBerths.length > 0 && (starts.length < 2 || Math.random() < 0.75);

    if (wantDock) {
      const berth = pick(freeBerths);
      const berthComp = net.component[berth.approachCellX * net.size + berth.approachCellZ];
      const compGates = net.edgeGates.filter(g => g.comp === berthComp);
      const compPool = compGates.length > 0 ? compGates : net.openWaypoints.filter(w => w.comp === berthComp);
      if (compPool.length > 0) {
        for (let attempt = 0; attempt < 4; attempt++) {
          const gate = pick(compPool);
          if (Math.hypot(gate.x - berth.approachCellX, gate.z - berth.approachCellZ) < 5) continue;
          if (this.isCrowded(gate.x + 0.5, gate.z + 0.5, 2.2)) continue;
          const pts = net.findWaterPath(gate.x, gate.z, berth.approachCellX, berth.approachCellZ);
          if (!pts || pts.length < 2) continue;
          const kind = pick(berth.allowedKinds);
          this.occupiedBerths.add(berth.id);
          return this.instantiateBoat(kind, buildPolyPath(pts), berth);
        }
      }
    }

    // Passing boat cruising across open water between edge gates / waypoints
    if (starts.length < 2) return null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const a = pick(starts);
      const peers = starts.filter(s => s.comp === a.comp && Math.hypot(s.x - a.x, s.z - a.z) >= 12);
      if (!peers.length) continue;
      if (this.isCrowded(a.x + 0.5, a.z + 0.5, 2.2)) continue;
      const b = pick(peers);
      const pts = net.findWaterPath(a.x, a.z, b.x, b.z);
      if (!pts || pts.length < 2) continue;
      const passingKinds: readonly BoatKind[] = ['sailboat', 'yacht', 'fishing', 'ferry', 'cargo'];
      return this.instantiateBoat(pick(passingKinds), buildPolyPath(pts), null);
    }
    return null;
  }

  private instantiateBoat(kind: BoatKind, path: PolyPath, targetBerth: Berth | null): Boat {
    const spec = VESSEL_SPECS[kind];
    const { group, wake } = createBoatMesh(kind, this.nightMaterial);
    this.scene.add(group);
    const yaw = Math.atan2(-(path.zs[1] - path.zs[0]), path.xs[1] - path.xs[0]);
    const boat: Boat = {
      id: this.nextId++,
      kind,
      spec,
      mesh: group,
      wake,
      phase: 'cruising',
      path,
      s: 0,
      seg: 0,
      v: spec.speed * 0.75,
      x: path.xs[0],
      z: path.zs[0],
      yaw,
      targetBerth,
      dockTimer: 0,
      bobSeed: Math.random() * Math.PI * 2,
      age: 0,
      leaving: -1,
    };
    this.applyTransform(boat, 0);
    return boat;
  }

  private isCrowded(x: number, z: number, radius: number): boolean {
    const r2 = radius * radius;
    for (const b of this.boats) {
      if ((b.x - x) ** 2 + (b.z - z) ** 2 < r2) return true;
    }
    return false;
  }

  /** Speed cap from boats directly ahead along current heading. */
  private forwardClearSpeed(boat: Boat): number {
    if (boat.phase === 'docked') return 0;
    const hx = Math.cos(boat.yaw), hz = -Math.sin(boat.yaw);
    const look = boat.spec.length * 2.4 + 0.9;
    let limit = boat.spec.speed;
    for (const other of this.boats) {
      if (other === boat || other.leaving >= 0) continue;
      if (boat.phase === 'docking' && other.phase === 'docked' && other.targetBerth !== boat.targetBerth) continue;
      const dx = other.x - boat.x, dz = other.z - boat.z;
      const ahead = dx * hx + dz * hz;
      if (ahead <= 0 || ahead > look) continue;
      const lateral = Math.abs(-dx * hz + dz * hx);
      const minBeam = (boat.spec.beam + other.spec.beam) * 1.15 + 0.18;
      if (lateral > minBeam) continue;
      const free = Math.max(0, ahead - (boat.spec.length + other.spec.length) * 0.55 - 0.15);
      limit = Math.min(limit, Math.sqrt(2 * BRAKE * free));
    }
    return limit;
  }

  private beginDeparture(boat: Boat, net: WaterNetwork): void {
    const startCellX = Math.max(0, Math.min(net.size - 1, Math.floor(boat.x)));
    const startCellZ = Math.max(0, Math.min(net.size - 1, Math.floor(boat.z)));
    const startNav = net.isNavigable(startCellX, startCellZ)
      ? [startCellX, startCellZ] as const
      : boat.targetBerth
        ? [boat.targetBerth.approachCellX, boat.targetBerth.approachCellZ] as const
        : null;

    if (boat.targetBerth) {
      this.occupiedBerths.delete(boat.targetBerth.id);
      boat.targetBerth = null;
    }

    if (startNav) {
      const comp = net.component[startNav[0] * net.size + startNav[1]];
      // Sometimes hop to another compatible port in the city!
      const otherBerths = net.berths.filter(
        b => !this.occupiedBerths.has(b.id)
          && b.allowedKinds.includes(boat.kind)
          && net.component[b.approachCellX * net.size + b.approachCellZ] === comp
          && Math.hypot(b.approachCellX - startNav[0], b.approachCellZ - startNav[1]) >= 5,
      );
      if (otherBerths.length > 0 && Math.random() < 0.35) {
        const nextBerth = pick(otherBerths);
        const pts = net.findWaterPath(startNav[0], startNav[1], nextBerth.approachCellX, nextBerth.approachCellZ);
        if (pts && pts.length >= 2) {
          this.occupiedBerths.add(nextBerth.id);
          boat.targetBerth = nextBerth;
          boat.phase = 'cruising';
          boat.path = buildPolyPath([[boat.x, boat.z], ...pts.slice(1)]);
          boat.s = 0;
          boat.seg = 0;
          return;
        }
      }

      const exits = net.edgeGates.filter(g => g.comp === comp && Math.hypot(g.x - startNav[0], g.z - startNav[1]) >= 4);
      const fallback = exits.length > 0 ? exits : net.openWaypoints.filter(w => w.comp === comp);
      if (fallback.length > 0) {
        const goal = pick(fallback);
        const pts = net.findWaterPath(startNav[0], startNav[1], goal.x, goal.z);
        if (pts && pts.length >= 2) {
          boat.phase = 'departing';
          boat.path = buildPolyPath([[boat.x, boat.z], ...pts.slice(1)]);
          boat.s = 0;
          boat.seg = 0;
          return;
        }
      }
    }

    boat.leaving = 0;
  }

  private stepBoat(boat: Boat, net: WaterNetwork, dt: number): boolean {
    boat.age += dt;

    if (boat.leaving >= 0) {
      boat.leaving += dt;
      if (boat.leaving >= FADE_SECONDS) return false;
      this.applyTransform(boat, dt);
      return true;
    }

    if (boat.phase === 'docked') {
      boat.v = 0;
      boat.dockTimer -= dt;
      if (boat.dockTimer <= 0) {
        const berth = boat.targetBerth;
        if (berth) {
          boat.phase = 'undocking';
          boat.path = buildPolyPath([[boat.x, boat.z], [berth.approachX, berth.approachZ]]);
          boat.s = 0;
          boat.seg = 0;
        } else {
          this.beginDeparture(boat, net);
        }
      }
      this.applyTransform(boat, dt);
      return true;
    }

    const path = boat.path;
    const rem = Math.max(0, path.length - boat.s);

    let desiredSpeed = boat.spec.speed;
    if (boat.phase === 'docking') {
      desiredSpeed = Math.min(boat.spec.speed * 0.55, Math.sqrt(2 * BRAKE * rem) + 0.08);
    } else if (boat.phase === 'undocking') {
      desiredSpeed = boat.spec.speed * 0.5;
    } else if (boat.phase === 'cruising' && boat.targetBerth) {
      desiredSpeed = Math.min(boat.spec.speed, Math.sqrt(2 * BRAKE * rem) + boat.spec.speed * 0.45);
    }
    desiredSpeed = Math.min(desiredSpeed, this.forwardClearSpeed(boat));

    boat.v = desiredSpeed > boat.v
      ? Math.min(desiredSpeed, boat.v + ACCEL * dt)
      : Math.max(desiredSpeed, boat.v - BRAKE * dt);

    boat.s = Math.min(path.length, boat.s + boat.v * dt);
    this.advanceAlongPath(boat, dt);

    if (boat.s >= path.length - 1e-3) {
      if (boat.phase === 'cruising' && boat.targetBerth) {
        const b = boat.targetBerth;
        boat.phase = 'docking';
        boat.path = buildPolyPath([[boat.x, boat.z], [b.x, b.z]]);
        boat.s = 0;
        boat.seg = 0;
      } else if (boat.phase === 'docking' && boat.targetBerth) {
        boat.phase = 'docked';
        boat.x = boat.targetBerth.x;
        boat.z = boat.targetBerth.z;
        boat.yaw = boat.targetBerth.dockYaw;
        boat.v = 0;
        boat.dockTimer = 7 + Math.random() * 7;
      } else if (boat.phase === 'undocking' || boat === this.riding) {
        // A ridden boat sets off again rather than sailing off the map.
        this.beginDeparture(boat, net);
      } else {
        boat.leaving = 0;
      }
    }

    this.applyTransform(boat, dt);
    return true;
  }

  private advanceAlongPath(boat: Boat, dt: number): void {
    const { xs, zs, ss } = boat.path;
    while (boat.seg < ss.length - 2 && ss[boat.seg + 1] <= boat.s) boat.seg++;
    const k = boat.seg;
    const len = ss[k + 1] - ss[k];
    const t = len > 0 ? Math.min(1, Math.max(0, (boat.s - ss[k]) / len)) : 0;
    boat.x = xs[k] + (xs[k + 1] - xs[k]) * t;
    boat.z = zs[k] + (zs[k + 1] - zs[k]) * t;

    let desiredYaw = Math.atan2(-(zs[k + 1] - zs[k]), xs[k + 1] - xs[k]);
    if (boat.phase === 'docking' && boat.targetBerth && boat.path.length > 0) {
      const progress = Math.min(1, boat.s / boat.path.length);
      if (progress > 0.35) {
        const blend = (progress - 0.35) / 0.65;
        desiredYaw = desiredYaw + angleDelta(desiredYaw, boat.targetBerth.dockYaw) * blend;
      }
    }
    const turnRate = boat.phase === 'docking' ? 5.5 : 3.6;
    boat.yaw = dt > 0 ? boat.yaw + angleDelta(boat.yaw, desiredYaw) * (1 - Math.exp(-dt * turnRate)) : desiredYaw;
  }

  private applyTransform(boat: Boat, _dt: number): void {
    const { spec } = boat;
    const phase = this.time * spec.bobFreq + boat.bobSeed;
    const heave = Math.sin(phase) * spec.bobAmp;
    const roll = Math.sin(phase * 0.83 + 1.1) * spec.rollAmp;
    const pitch = Math.cos(phase * 0.92) * spec.bobAmp * 0.8 + (boat.v / spec.speed) * 0.018;

    boat.mesh.position.set(boat.x * CELL_SIZE, WATER_Y + heave, boat.z * CELL_SIZE);
    boat.mesh.rotation.order = 'YXZ';
    boat.mesh.rotation.y = boat.yaw;
    boat.mesh.rotation.x = roll;
    boat.mesh.rotation.z = pitch;

    let scale = 1;
    if (boat.leaving >= 0) {
      scale = Math.max(0.01, 1 - boat.leaving / FADE_SECONDS);
    } else if (boat.age < FADE_SECONDS) {
      scale = 0.2 + 0.8 * (boat.age / FADE_SECONDS);
    }
    boat.mesh.scale.setScalar(scale * CELL_SIZE);

    const speedRatio = Math.min(1, boat.v / spec.speed);
    const wakeMat = boat.wake.material as THREE.MeshBasicMaterial;
    wakeMat.opacity = speedRatio * 0.36;
    boat.wake.visible = speedRatio > 0.06;
    boat.wake.scale.set(0.45 + speedRatio * 0.85, 1, 0.7 + speedRatio * 0.35);
  }

  private removeBoatMesh(boat: Boat): void {
    this.scene.remove(boat.mesh);
    boat.mesh.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (m !== this.nightMaterial) m.dispose();
      }
    });
  }
}

// ── Procedural 3D Maritime Vessel Meshes ──────────────────────

function createWakeMesh(length: number, beam: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const sternX = -length * 0.46;
  const trailLen = length * 0.95;
  const halfSpread = beam * 1.15;
  const vertices = new Float32Array([
    sternX, 0.004, 0,
    sternX - trailLen, 0.004, -halfSpread,
    sternX - trailLen * 0.82, 0.004, 0,

    sternX, 0.004, 0,
    sternX - trailLen * 0.82, 0.004, 0,
    sternX - trailLen, 0.004, halfSpread,
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xeef8fc,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'wake';
  return mesh;
}

function addHull(group: THREE.Group, len: number, beam: number, height: number, hullColor: number, trimColor: number): void {
  const hullMat = new THREE.MeshStandardMaterial({ color: hullColor, roughness: 0.65, flatShading: true });
  const trimMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.7, flatShading: true });

  // Main midship hull + tapered bow wedge along +x
  const midLen = len * 0.72;
  const mid = new THREE.Mesh(new THREE.BoxGeometry(midLen, height, beam), hullMat);
  mid.position.set(-len * 0.1, height * 0.5, 0);
  group.add(mid);

  const bowLen = len * 0.3;
  const bowGeo = new THREE.ConeGeometry(beam * 0.52, bowLen, 4);
  bowGeo.rotateZ(-Math.PI / 2);
  bowGeo.rotateX(Math.PI / 4);
  bowGeo.scale(1, height / (beam * 0.74), 0.96);
  const bow = new THREE.Mesh(bowGeo, hullMat.clone());
  bow.position.set(midLen * 0.5 - len * 0.1 + bowLen * 0.44, height * 0.52, 0);
  group.add(bow);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(midLen * 1.01, height * 0.24, beam * 1.02), trimMat);
  stripe.position.set(-len * 0.1, height * 0.16, 0);
  group.add(stripe);
}

export function createBoatMesh(
  kind: BoatKind,
  nightMaterial?: THREE.MeshStandardMaterial,
): { group: THREE.Group; wake: THREE.Mesh } {
  const spec = VESSEL_SPECS[kind];
  const group = new THREE.Group();
  const wake = createWakeMesh(spec.length, spec.beam);
  group.add(wake);

  const winMat = nightMaterial ?? new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.3 });
  const whiteMat = () => new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.6, flatShading: true });

  if (kind === 'cargo') {
    addHull(group, spec.length, spec.beam, 0.13, 0x2f3e46, 0x9b2226);
    // Aft bridge superstructure + funnel
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, spec.beam * 0.82), whiteMat());
    bridge.position.set(-0.42, 0.22, 0);
    group.add(bridge);
    const bridgeWin = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.04, spec.beam * 0.84), winMat);
    bridgeWin.position.set(-0.42, 0.28, 0);
    group.add(bridgeWin);
    const funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.034, 0.12, 8),
      new THREE.MeshStandardMaterial({ color: 0xd84315, roughness: 0.7 }),
    );
    funnel.position.set(-0.47, 0.36, 0);
    group.add(funnel);
    // Colorful container stacks on cargo deck
    const colors = [0xc62828, 0x1565c0, 0x2e7d32, 0xef6c00, 0x00838f];
    for (let i = 0; i < 3; i++) {
      for (let tier = 0; tier < 2; tier++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.075, spec.beam * 0.78),
          new THREE.MeshStandardMaterial({ color: colors[(i * 2 + tier) % colors.length], roughness: 0.75 }),
        );
        box.position.set(-0.18 + i * 0.24, 0.165 + tier * 0.076, 0);
        group.add(box);
      }
    }
  } else if (kind === 'ferry') {
    addHull(group, spec.length, spec.beam, 0.1, 0x1d3557, 0x00897b);
    const lowerCabin = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, spec.beam * 0.88), whiteMat());
    lowerCabin.position.set(-0.06, 0.15, 0);
    group.add(lowerCabin);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(0.63, 0.038, spec.beam * 0.9), winMat);
    windows.position.set(-0.06, 0.16, 0);
    group.add(windows);
    const upperDeck = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, spec.beam * 0.76), whiteMat());
    upperDeck.position.set(-0.04, 0.24, 0);
    group.add(upperDeck);
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.625, 0.022, spec.beam * 0.89),
      new THREE.MeshStandardMaterial({ color: 0x00897b, roughness: 0.6 }),
    );
    stripe.position.set(-0.06, 0.115, 0);
    group.add(stripe);
  } else if (kind === 'sailboat') {
    const hullColors = [0xf8f9fa, 0x1e3a5f, 0x8d2b2b];
    addHull(group, spec.length, spec.beam, 0.075, pick(hullColors), 0x0288d1);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.011, 0.62, 6),
      new THREE.MeshStandardMaterial({ color: 0xcfd8dc, roughness: 0.5 }),
    );
    mast.position.set(0.03, 0.36, 0);
    group.add(mast);

    // Crisp triangular mainsail (-x) and headsail jib (+x)
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0.025, 0.65, 0,
      0.025, 0.12, 0,
      -0.25, 0.13, 0.018,

      0.04, 0.58, 0,
      0.26, 0.11, -0.014,
      0.04, 0.12, 0,
    ]), 3));
    sailGeo.computeVertexNormals();
    const sails = new THREE.Mesh(
      sailGeo,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, side: THREE.DoubleSide }),
    );
    group.add(sails);
  } else if (kind === 'yacht') {
    addHull(group, spec.length, spec.beam, 0.085, 0xfafcff, 0x0277bd);
    const salon = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.085, spec.beam * 0.78), whiteMat());
    salon.position.set(-0.04, 0.12, 0);
    group.add(salon);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.034, spec.beam * 0.8), winMat);
    windshield.position.set(-0.03, 0.13, 0);
    group.add(windshield);
    const arch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, spec.beam * 0.72), whiteMat());
    arch.position.set(-0.14, 0.19, 0);
    group.add(arch);
  } else {
    // Fishing trawler
    const trawlerColors = [0xb54434, 0x2b6cb0, 0x2f855a, 0xc07a28];
    addHull(group, spec.length, spec.beam, 0.09, pick(trawlerColors), 0xf4f1ea);
    const house = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, spec.beam * 0.76), whiteMat());
    house.position.set(0.05, 0.15, 0);
    group.add(house);
    const wheelWin = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.036, spec.beam * 0.78), winMat);
    wheelWin.position.set(0.05, 0.18, 0);
    group.add(wheelWin);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.01, 0.28, 6),
      new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.8 }),
    );
    mast.position.set(-0.08, 0.22, 0);
    group.add(mast);
  }

  return { group, wake };
}

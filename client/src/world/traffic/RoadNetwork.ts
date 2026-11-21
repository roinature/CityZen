import {
  BUILDING_DEFS,
  BuildingType,
  getEffectiveSize,
  isRoad,
  type PlacedBuilding,
} from '@cityzen/shared';

/**
 * Lane-level model of the city's roads, in cell units (1 unit = 1 cell).
 *
 * Directions are indexed E, S, W, N (+x is east, +z is south). Traffic keeps
 * right. Single-cell roads (dirt, street) carry one lane each way. Wide roads
 * (avenue, highway) are split by their centre line: each row of cells carries
 * the traffic on its side of the road, and the middle row of a highway carries
 * the innermost lane of both sides.
 */

export const DX = [1, 0, -1, 0] as const;
export const DZ = [0, 1, 0, -1] as const;
export const opposite = (d: number): number => (d + 2) & 3;
export const rightOf = (d: number): number => (d + 1) & 3;
export const isXAxis = (d: number): boolean => (d & 1) === 0;

/** Distance from a road's centre line to the middle of a lane. */
const LANE = 0.25;
/** Upper speed through a 90° turn, in cells per second. */
export const TURN_SPEED = 1.4;
const ROUNDABOUT_SPEED = 1.6;
/** Base cruising speed on a street, in cells per second. */
export const BASE_SPEED = 2.2;
/** How far beyond the map edge cars appear and disappear. */
const OFFMAP = 1.5;
const RING_RADIUS = 1.0;
const RING_MERGE = 0.45;

export type Control = 'signal' | 'yield';

export interface Tile {
  idx: number;
  x: number;
  z: number;
  building: string;
  type: BuildingType;
  speed: number;
  bx: number;
  bz: number;
  bw: number;
  bd: number;
  /** Avenue or highway: multi-lane with a centre line. */
  wide: boolean;
  /** Wide roads only: traffic flows along x (EW) rather than z (NS). */
  axisX: boolean;
  width: number;
  /** Wide roads only: index of this cell across the road. */
  row: number;
  roundabout: boolean;
  /** Bitmask of directions a car may move from this cell. */
  links: number;
  /** Bitmask of directions connected (either way) to a different road. */
  adj: number;
  junction: Junction | null;
}

export interface Movement {
  car: object;
  inDir: number;
  outDir: number;
  arrival: number;
  frame: number;
}

export interface Junction {
  id: number;
  tiles: Tile[];
  control: Control;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** Bitmask of headings on which cars enter the junction. */
  approaches: number;
  /** Signals: 0 x-green, 1 x-yellow, 2 all-red, 3 z-green, 4 z-yellow, 5 all-red. */
  phase: number;
  timer: number;
  /** Cars queued on each axis (x, z), counted during the previous frame. */
  queued: [number, number];
  counting: [number, number];
  occupants: Movement[];
  waiting: Map<object, Movement>;
}

export interface Roundabout {
  building: string;
  cx: number;
  cz: number;
}

export interface RouteStep {
  tile: Tile;
  /** Heading on which the car enters this tile (first step: initial heading). */
  dir: number;
}

export interface Route {
  steps: RouteStep[];
  /** Starts off the map edge, driving in. */
  entering: boolean;
  /** Ends by driving off the map edge on this heading (-1 when it parks). */
  exitDir: number;
}

export interface PathEvent {
  kind: 'junction' | 'roundabout';
  junction: Junction | null;
  roundabout: Roundabout | null;
  sEntry: number;
  sExit: number;
  inDir: number;
  outDir: number;
  /** Roundabouts: ring angle at which the car merges. */
  mergeAngle: number;
}

export interface Path {
  xs: number[];
  zs: number[];
  ss: number[];
  /** Speed limit of the segment starting at each point. */
  speed: number[];
  /** Path distance at which each route step begins. */
  stepS: number[];
  length: number;
  events: PathEvent[];
}

export interface EdgeGate {
  tile: Tile;
  dir: number;
}

export function turnKind(inDir: number, outDir: number): 'straight' | 'right' | 'left' | 'uturn' {
  if (outDir === inDir) return 'straight';
  if (outDir === rightOf(inDir)) return 'right';
  if (outDir === opposite(inDir)) return 'uturn';
  return 'left';
}

/** Whether two movements through the same junction cross or merge. */
export function movementsConflict(a: Movement, b: Movement): boolean {
  if (a.inDir === b.inDir) return false;
  const ta = turnKind(a.inDir, a.outDir);
  const tb = turnKind(b.inDir, b.outDir);
  const crossesA = ta === 'left' || ta === 'uturn';
  const crossesB = tb === 'left' || tb === 'uturn';
  if (a.inDir === opposite(b.inDir) && !crossesA && !crossesB) return false;
  if ((ta === 'right' || tb === 'right') && a.outDir !== b.outDir) return false;
  return true;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, val: number): void {
    const keys = this.keys, vals = this.vals;
    let i = keys.length;
    keys.push(key); vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p]; vals[i] = vals[p];
      i = p;
    }
    keys[i] = key; vals[i] = val;
  }
  pop(): number {
    const keys = this.keys, vals = this.vals;
    const top = vals[0];
    const lastK = keys.pop()!, lastV = vals.pop()!;
    if (keys.length) {
      let i = 0;
      const n = keys.length;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastK) break;
        keys[i] = keys[c]; vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastK; vals[i] = lastV;
    }
    return top;
  }
}

export class RoadNetwork {
  readonly tiles: Tile[] = [];
  readonly junctions: Junction[] = [];
  readonly roundabouts = new Map<string, Roundabout>();
  /** Road cells next to lots, where trips start and end. */
  endpoints: Tile[] = [];
  readonly entries: EdgeGate[] = [];
  readonly exits: EdgeGate[] = [];
  private grid: Int32Array;

  constructor(buildings: readonly PlacedBuilding[], readonly size: number) {
    this.grid = new Int32Array(size * size).fill(-1);
    const byBuilding = new Map<string, Tile[]>();

    for (const b of buildings) {
      if (!isRoad(b.type)) continue;
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      const roundabout = b.type === BuildingType.ROAD_ROUNDABOUT;
      const wide = !roundabout && (w > 1 || d > 1);
      const axisX = (b.orientation ?? 'EW') === 'EW';
      const cells: Tile[] = [];
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const x = b.position.x + dx;
          const z = b.position.z + dz;
          if (x < 0 || z < 0 || x >= size || z >= size) continue;
          const tile: Tile = {
            idx: this.tiles.length, x, z,
            building: b.id, type: b.type,
            speed: BUILDING_DEFS[b.type].speedMultiplier ?? 1,
            bx: b.position.x, bz: b.position.z, bw: w, bd: d,
            wide, axisX,
            width: axisX ? d : w,
            row: axisX ? dz : dx,
            roundabout,
            links: 0, adj: 0, junction: null,
          };
          this.grid[x * size + z] = tile.idx;
          this.tiles.push(tile);
          cells.push(tile);
        }
      }
      byBuilding.set(b.id, cells);
      if (roundabout) {
        this.roundabouts.set(b.id, { building: b.id, cx: b.position.x + w / 2, cz: b.position.z + d / 2 });
      }
    }

    this.computeLinks(byBuilding);
    this.findJunctions();
    this.findGates();
    this.setEndpoints(buildings);
  }

  tileAt(x: number, z: number): Tile | undefined {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return undefined;
    const i = this.grid[x * this.size + z];
    return i < 0 ? undefined : this.tiles[i];
  }

  neighbor(t: Tile, d: number): Tile | undefined {
    return this.tileAt(t.x + DX[d], t.z + DZ[d]);
  }

  // ── Topology ──────────────────────────────────────────────

  private static isRoundaboutCenter(t: Tile): boolean {
    return t.roundabout && t.bw >= 3 && t.bd >= 3
      && t.x === t.bx + (t.bw >> 1) && t.z === t.bz + (t.bd >> 1);
  }

  /** Lateral sign of a heading's right-hand side, on the axis across the road. */
  private static rightSign(d: number): number {
    const r = rightOf(d);
    return isXAxis(d) ? DZ[r] : DX[r];
  }

  /** Whether a wide-road row carries traffic on heading d (always true across the road). */
  static rowAllows(t: Tile, d: number): boolean {
    if (!t.wide || isXAxis(d) !== t.axisX) return true;
    const c = t.row - (t.width - 1) / 2;
    return c * RoadNetwork.rightSign(d) >= 0;
  }

  /** Two wide-road cells whose lanes line up so traffic flows straight between them. */
  private static aligned(a: Tile, b: Tile): boolean {
    return a.wide && b.wide && a.type === b.type && a.axisX === b.axisX
      && (a.axisX ? a.bz === b.bz : a.bx === b.bx);
  }

  private canMove(a: Tile, b: Tile, d: number): boolean {
    if (a.building === b.building) {
      if (a.roundabout) return !RoadNetwork.isRoundaboutCenter(a) && !RoadNetwork.isRoundaboutCenter(b);
      if (a.wide && isXAxis(d) === a.axisX) return RoadNetwork.rowAllows(a, d) && RoadNetwork.rowAllows(b, d);
      return true;
    }
    if (RoadNetwork.isRoundaboutCenter(a) || RoadNetwork.isRoundaboutCenter(b)) return false;
    // Between lined-up wide roads, stay on your own side of the centre line.
    if (RoadNetwork.aligned(a, b) && isXAxis(d) === a.axisX) {
      return RoadNetwork.rowAllows(a, d) && RoadNetwork.rowAllows(b, d);
    }
    return true;
  }

  private computeLinks(byBuilding: Map<string, Tile[]>): void {
    for (const t of this.tiles) {
      for (let d = 0; d < 4; d++) {
        const n = this.neighbor(t, d);
        if (!n) continue;
        if (this.canMove(t, n, d)) t.links |= 1 << d;
      }
    }
    for (const t of this.tiles) {
      for (let d = 0; d < 4; d++) {
        const n = this.neighbor(t, d);
        if (!n || n.building === t.building) continue;
        if ((t.links & (1 << d)) || (n.links & (1 << opposite(d)))) {
          t.adj |= 1 << d;
        }
      }
    }

    // Crossing a wide road (or changing sides) is only possible where
    // something meets it: a side road, a change of road, or a dead end.
    for (const cells of byBuilding.values()) {
      const first = cells[0];
      if (!first?.wide) continue;
      const along = first.axisX ? [0, 2] : [1, 3];
      let crossOk = false;
      for (const t of cells) {
        for (let d = 0; d < 4; d++) {
          if (!(t.adj & (1 << d))) continue;
          if (!along.includes(d)) crossOk = true;
          else if (!RoadNetwork.aligned(t, this.neighbor(t, d)!)) crossOk = true;
        }
      }
      for (const d of along) {
        if (!cells.some(t => t.adj & (1 << d))) crossOk = true;
      }
      if (crossOk) continue;
      for (const t of cells) {
        for (let d = 0; d < 4; d++) {
          if (along.includes(d)) continue;
          const n = this.neighbor(t, d);
          if (n && n.building === t.building) t.links &= ~(1 << d);
        }
      }
    }
  }

  private findJunctions(): void {
    const isJunctionCell = new Uint8Array(this.tiles.length);
    const wideJunction = new Set<string>();
    for (const t of this.tiles) {
      if (t.roundabout) continue;
      let count = 0;
      for (let d = 0; d < 4; d++) if (t.adj & (1 << d)) count++;
      if (count >= 3) {
        isJunctionCell[t.idx] = 1;
        if (t.wide) wideJunction.add(t.building);
      }
      // Where a wide road meets a different road head-on, cars change sides
      // inside it; that crossing needs right-of-way like any junction.
      if (t.wide) {
        for (const d of t.axisX ? [0, 2] : [1, 3]) {
          const n = this.neighbor(t, d);
          if (n && (t.adj & (1 << d)) && !RoadNetwork.aligned(t, n)) wideJunction.add(t.building);
        }
      }
    }
    // A junction on a wide road spans the whole cross-section.
    for (const t of this.tiles) if (wideJunction.has(t.building)) isJunctionCell[t.idx] = 1;

    for (const seed of this.tiles) {
      if (!isJunctionCell[seed.idx] || seed.junction) continue;
      const j: Junction = {
        id: this.junctions.length, tiles: [], control: 'yield',
        minX: seed.x, minZ: seed.z, maxX: seed.x, maxZ: seed.z,
        approaches: 0, phase: 0, timer: 0,
        queued: [0, 0], counting: [0, 0],
        occupants: [], waiting: new Map(),
      };
      const stack = [seed];
      seed.junction = j;
      while (stack.length) {
        const t = stack.pop()!;
        j.tiles.push(t);
        j.minX = Math.min(j.minX, t.x); j.maxX = Math.max(j.maxX, t.x);
        j.minZ = Math.min(j.minZ, t.z); j.maxZ = Math.max(j.maxZ, t.z);
        for (let d = 0; d < 4; d++) {
          const n = this.neighbor(t, d);
          if (!n || n.junction || !isJunctionCell[n.idx]) continue;
          if (!(t.links & (1 << d)) && !(n.links & (1 << opposite(d)))) continue;
          n.junction = j;
          stack.push(n);
        }
      }

      let major = false;
      let dirt = false;
      for (const t of j.tiles) {
        if (t.wide) major = true;
        for (let d = 0; d < 4; d++) {
          const n = this.neighbor(t, d);
          if (!n || n.junction === j) continue;
          if (!(n.links & (1 << opposite(d)))) continue;
          j.approaches |= 1 << opposite(d);
          if (n.wide) major = true;
          if (n.type === BuildingType.ROAD_DIRT) dirt = true;
        }
        if (t.type === BuildingType.ROAD_DIRT) dirt = true;
      }
      const xApproach = (j.approaches & 0b0101) !== 0;
      const zApproach = (j.approaches & 0b1010) !== 0;
      const fourWay = j.approaches === 0b1111;
      // Lights where big roads meet or at full street crossings; T-junctions
      // and dirt-road junctions work like all-way stops.
      j.control = xApproach && zApproach && (major || (fourWay && !dirt)) ? 'signal' : 'yield';
      j.phase = Math.random() < 0.5 ? 0 : 3;
      j.timer = Math.random() * 3;
      this.junctions.push(j);
    }
  }

  private findGates(): void {
    const max = this.size - 1;
    for (const t of this.tiles) {
      if (t.roundabout) continue;
      const sides: number[] = [];
      if (t.x === 0) sides.push(2);
      if (t.x === max) sides.push(0);
      if (t.z === 0) sides.push(3);
      if (t.z === max) sides.push(1);
      for (const out of sides) {
        if (RoadNetwork.rowAllows(t, out)) this.exits.push({ tile: t, dir: out });
        const inDir = opposite(out);
        if (RoadNetwork.rowAllows(t, inDir)) this.entries.push({ tile: t, dir: inDir });
      }
    }
  }

  /** Road cells fronting lots; trips start and end there. */
  setEndpoints(buildings: readonly PlacedBuilding[]): void {
    const found = new Set<Tile>();
    for (const b of buildings) {
      if (isRoad(b.type)) continue;
      const { w, d } = getEffectiveSize(b.type, b.orientation);
      const visit = (x: number, z: number) => {
        const t = this.tileAt(x, z);
        if (t && !t.roundabout && !t.junction && t.links) found.add(t);
      };
      for (let dx = 0; dx < w; dx++) {
        visit(b.position.x + dx, b.position.z - 1);
        visit(b.position.x + dx, b.position.z + d);
      }
      for (let dz = 0; dz < d; dz++) {
        visit(b.position.x - 1, b.position.z + dz);
        visit(b.position.x + w, b.position.z + dz);
      }
    }
    this.endpoints = found.size
      ? [...found]
      : this.tiles.filter(t => !t.roundabout && !t.junction && t.links);
  }

  // ── Routing ───────────────────────────────────────────────

  /**
   * Cheapest route (favouring fast roads and few turns). `start` lists the
   * headings the car may begin with; all four when it pulls out of a lot.
   */
  findRoute(
    start: Tile,
    startDirs: readonly number[],
    goal: { tile: Tile; exitDir: number },
  ): RouteStep[] | null {
    const n = this.tiles.length * 4;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const heap = new MinHeap();
    for (const d of startDirs) {
      const s = start.idx * 4 + d;
      dist[s] = 0;
      heap.push(0, s);
    }

    let found = -1;
    while (heap.size) {
      const state = heap.pop();
      const t = this.tiles[state >> 2];
      const h = state & 3;
      const cost = dist[state];
      // Arrived (an exit gate must be left without turning back on ourselves).
      if (t === goal.tile && cost > 0 && (goal.exitDir < 0 || h !== opposite(goal.exitDir))) {
        found = state;
        break;
      }
      let moved = false;
      for (let d = 0; d < 4; d++) {
        if (!(t.links & (1 << d))) continue;
        if (d === opposite(h) && !t.roundabout) continue;
        const nt = this.neighbor(t, d)!;
        moved = true;
        let c = 1 / nt.speed;
        if (d !== h) c += 0.35;
        if (nt.building === t.building && t.wide) c += 0.4;
        this.relax(dist, prev, heap, state, nt.idx * 4 + d, cost + c);
      }
      // Dead end: turn around.
      if (!moved && (t.links & (1 << opposite(h)))) {
        const nt = this.neighbor(t, opposite(h))!;
        this.relax(dist, prev, heap, state, nt.idx * 4 + opposite(h), cost + 1.5 + 1 / nt.speed);
      }
    }
    if (found < 0) return null;

    const steps: RouteStep[] = [];
    for (let s = found; s >= 0; s = prev[s]) steps.push({ tile: this.tiles[s >> 2], dir: s & 3 });
    steps.reverse();
    return steps;
  }

  private relax(dist: Float64Array, prev: Int32Array, heap: MinHeap, from: number, to: number, cost: number): void {
    if (cost >= dist[to]) return;
    dist[to] = cost;
    prev[to] = from;
    heap.push(cost, to);
  }

  // ── Geometry ──────────────────────────────────────────────

  /** Lateral coordinate (z for east-west travel, x for north-south) of a lane, or null if undefined here. */
  private static laneLat(t: Tile, d: number, pref: number): number | null {
    if (t.roundabout) return null;
    const sign = RoadNetwork.rightSign(d);
    const center = (isXAxis(d) ? t.z : t.x) + 0.5;
    if (!t.wide) return center + sign * LANE;
    if (isXAxis(d) !== t.axisX) return null;
    const c = t.row - (t.width - 1) / 2;
    if (c * sign < 0) return null;
    if (c === 0) return center + sign * LANE;
    return center + (pref ? LANE : -LANE);
  }

  private static streetLat(t: Tile, d: number): number {
    return (isXAxis(d) ? t.z : t.x) + 0.5 + RoadNetwork.rightSign(d) * LANE;
  }

  /** Point where a car on heading d crosses into tile t. */
  private static entryPoint(t: Tile, d: number, lat: number): [number, number] {
    switch (d) {
      case 0: return [t.x, lat];
      case 2: return [t.x + 1, lat];
      case 1: return [lat, t.z];
      default: return [lat, t.z + 1];
    }
  }

  private static exitPoint(t: Tile, d: number, lat: number): [number, number] {
    switch (d) {
      case 0: return [t.x + 1, lat];
      case 2: return [t.x, lat];
      case 1: return [lat, t.z + 1];
      default: return [lat, t.z];
    }
  }

  private static midPoint(t: Tile, d: number, lat: number): [number, number] {
    return isXAxis(d) ? [t.x + 0.5, lat] : [lat, t.z + 0.5];
  }

  buildPath(route: Route, pref: number): Path {
    const { steps } = route;
    const n = steps.length;
    const path: Path = { xs: [], zs: [], ss: [], speed: [], stepS: [], length: 0, events: [] };

    // Lateral position of the boundary crossed when entering each step.
    const lat: number[] = new Array(n + 1);
    for (let i = 0; i < n; i++) {
      const { tile, dir } = steps[i];
      let l = RoadNetwork.laneLat(tile, dir, pref);
      if (l === null && i > 0) l = RoadNetwork.laneLat(steps[i - 1].tile, dir, pref);
      if (l === null && i > 0 && steps[i - 1].dir === dir) l = lat[i - 1];
      lat[i] = l ?? RoadNetwork.streetLat(tile, dir);
    }
    const last = steps[n - 1];
    const finalDir = route.exitDir >= 0 ? route.exitDir : last.dir;
    lat[n] = route.exitDir >= 0
      ? RoadNetwork.laneLat(last.tile, finalDir, pref) ?? (finalDir === last.dir ? lat[n - 1] : RoadNetwork.streetLat(last.tile, finalDir))
      : lat[n - 1];

    const push = (x: number, z: number, speed: number) => {
      const k = path.xs.length;
      if (k) {
        const dx = x - path.xs[k - 1];
        const dz = z - path.zs[k - 1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) return;
        path.speed[k - 1] = speed;
        path.ss.push(path.ss[k - 1] + len);
      } else {
        path.ss.push(0);
      }
      path.xs.push(x);
      path.zs.push(z);
      path.speed.push(speed);
    };

    const cubic = (
      p0: [number, number], c1: [number, number], c2: [number, number], p3: [number, number],
      samples: number, speed: number,
    ) => {
      for (let k = 1; k <= samples; k++) {
        const t = k / samples;
        const mt = 1 - t;
        const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, e = t * t * t;
        push(a * p0[0] + b * c1[0] + c * c2[0] + e * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + e * p3[1], speed);
      }
    };

    const connect = (from: [number, number], hIn: number, to: [number, number], hOut: number, speed: number) => {
      if (path.xs.length === 0) push(from[0], from[1], speed);
      const vx = to[0] - from[0];
      const vz = to[1] - from[1];
      if (hIn === hOut) {
        const lateral = Math.abs(isXAxis(hIn) ? vz : vx);
        if (lateral < 1e-3) {
          push(to[0], to[1], speed);
          return;
        }
        const k = 0.45 * Math.abs(isXAxis(hIn) ? vx : vz);
        cubic(from, [from[0] + DX[hIn] * k, from[1] + DZ[hIn] * k], [to[0] - DX[hIn] * k, to[1] - DZ[hIn] * k], to, 8,
          Math.min(speed, BASE_SPEED * 1.2));
        return;
      }
      if (hOut === opposite(hIn)) {
        const k = 0.7;
        cubic(from, [from[0] + DX[hIn] * k, from[1] + DZ[hIn] * k], [to[0] + DX[hIn] * k, to[1] + DZ[hIn] * k], to, 12,
          Math.min(speed, TURN_SPEED * 0.7));
        return;
      }
      const a = Math.abs(vx * DX[hIn] + vz * DZ[hIn]) * 0.55;
      const b = Math.abs(vx * DX[hOut] + vz * DZ[hOut]) * 0.55;
      cubic(from, [from[0] + DX[hIn] * a, from[1] + DZ[hIn] * a], [to[0] - DX[hOut] * b, to[1] - DZ[hOut] * b], to, 8,
        Math.min(speed, TURN_SPEED));
    };

    const ring = (ra: Roundabout, from: [number, number], hIn: number, to: [number, number], hOut: number): number => {
      const aIn = Math.atan2(from[1] - ra.cz, from[0] - ra.cx) - RING_MERGE;
      const aOut = Math.atan2(to[1] - ra.cz, to[0] - ra.cx) + RING_MERGE;
      let sweep = ((aIn - aOut) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      if (sweep < 0.5) sweep += Math.PI * 2;
      const pin: [number, number] = [ra.cx + Math.cos(aIn) * RING_RADIUS, ra.cz + Math.sin(aIn) * RING_RADIUS];
      const tin: [number, number] = [Math.sin(aIn), -Math.cos(aIn)];
      const pout: [number, number] = [ra.cx + Math.cos(aIn - sweep) * RING_RADIUS, ra.cz + Math.sin(aIn - sweep) * RING_RADIUS];
      const tout: [number, number] = [Math.sin(aIn - sweep), -Math.cos(aIn - sweep)];
      if (path.xs.length === 0) push(from[0], from[1], ROUNDABOUT_SPEED);
      const k = 0.3;
      cubic(from, [from[0] + DX[hIn] * k, from[1] + DZ[hIn] * k], [pin[0] - tin[0] * k, pin[1] - tin[1] * k], pin, 5, ROUNDABOUT_SPEED);
      const samples = Math.max(4, Math.ceil(sweep / 0.2));
      for (let s = 1; s <= samples; s++) {
        const a = aIn - (sweep * s) / samples;
        push(ra.cx + Math.cos(a) * RING_RADIUS, ra.cz + Math.sin(a) * RING_RADIUS, ROUNDABOUT_SPEED);
      }
      cubic(pout, [pout[0] + tout[0] * k, pout[1] + tout[1] * k], [to[0] - DX[hOut] * k, to[1] - DZ[hOut] * k], to, 5, ROUNDABOUT_SPEED);
      return aIn;
    };

    const roadSpeed = (t: Tile) => BASE_SPEED * t.speed;
    const s = () => (path.ss.length ? path.ss[path.ss.length - 1] : 0);

    // Start
    const first = steps[0];
    let cursor: [number, number];
    if (route.entering) {
      const edge = RoadNetwork.entryPoint(first.tile, first.dir, lat[0]);
      push(edge[0] - DX[first.dir] * OFFMAP, edge[1] - DZ[first.dir] * OFFMAP, roadSpeed(first.tile));
      push(edge[0], edge[1], roadSpeed(first.tile));
      cursor = edge;
    } else {
      cursor = RoadNetwork.midPoint(first.tile, first.dir, lat[0]);
      push(cursor[0], cursor[1], roadSpeed(first.tile));
    }

    const ringAngles = new Map<number, number>();
    let i = 0;
    while (i < n) {
      const { tile, dir } = steps[i];
      path.stepS[i] = s();
      if (tile.roundabout) {
        let j = i;
        while (j + 1 < n && steps[j + 1].tile.building === tile.building) {
          j++;
          path.stepS[j] = s();
        }
        const nextDir = j + 1 < n ? steps[j + 1].dir : finalDir;
        const to = j + 1 < n
          ? RoadNetwork.entryPoint(steps[j + 1].tile, nextDir, lat[j + 1])
          : RoadNetwork.exitPoint(steps[j].tile, nextDir, lat[n]);
        ringAngles.set(i, ring(this.roundabouts.get(tile.building)!, cursor, dir, to, nextDir));
        cursor = to;
        i = j + 1;
        continue;
      }
      if (i === n - 1) {
        if (route.exitDir >= 0) {
          const out = RoadNetwork.exitPoint(tile, finalDir, lat[n]);
          connect(cursor, dir, out, finalDir, roadSpeed(tile));
          push(out[0] + DX[finalDir] * OFFMAP, out[1] + DZ[finalDir] * OFFMAP, roadSpeed(tile));
        } else {
          const end = RoadNetwork.midPoint(tile, dir, lat[n - 1]);
          if (i > 0) connect(cursor, dir, end, dir, roadSpeed(tile));
          else push(end[0], end[1], roadSpeed(tile));
        }
      } else {
        const next = steps[i + 1];
        const to = RoadNetwork.entryPoint(next.tile, next.dir, lat[i + 1]);
        connect(cursor, dir, to, next.dir, Math.min(roadSpeed(tile), roadSpeed(next.tile) * 1.5));
        cursor = to;
      }
      i++;
    }
    path.length = s();
    path.events = this.computeEvents(path, steps.map(st => st.tile), steps.map(st => st.dir), finalDir, ringAngles);
    return path;
  }

  /**
   * Junction and roundabout crossings along a path. Tiles may be null for
   * steps that are no longer on the map (the car has already passed them).
   */
  computeEvents(
    path: Path, tiles: (Tile | null)[], dirs: number[], finalDir: number,
    ringAngles?: Map<number, number>,
  ): PathEvent[] {
    const events: PathEvent[] = [];
    const n = tiles.length;
    const stepEnd = (k: number) => (k + 1 < n ? path.stepS[k + 1] : path.length);
    for (let i = 0; i < n; i++) {
      const t = tiles[i];
      if (!t) continue;
      if (t.roundabout) {
        let j = i;
        while (j + 1 < n && tiles[j + 1]?.building === t.building) j++;
        const ra = this.roundabouts.get(t.building);
        if (ra) {
          let merge = ringAngles?.get(i);
          if (merge === undefined) {
            const [x, z] = positionAt(path, path.stepS[i]);
            merge = Math.atan2(z - ra.cz, x - ra.cx) - RING_MERGE;
          }
          events.push({
            kind: 'roundabout', junction: null, roundabout: ra,
            sEntry: path.stepS[i], sExit: stepEnd(j),
            inDir: dirs[i], outDir: j + 1 < n ? dirs[j + 1] : finalDir, mergeAngle: merge,
          });
        }
        i = j;
        continue;
      }
      const junction = t.junction;
      if (!junction || i === 0) continue;
      if (tiles[i - 1]?.junction === junction) continue;
      let j = i;
      while (j + 1 < n && tiles[j + 1]?.junction === junction) j++;
      events.push({
        kind: 'junction', junction, roundabout: null,
        sEntry: path.stepS[i], sExit: stepEnd(j),
        inDir: dirs[i], outDir: j + 1 < n ? dirs[j + 1] : finalDir, mergeAngle: 0,
      });
      i = j;
    }
    return events;
  }
}

/** Point on a path at distance s (clamped). */
export function positionAt(path: Path, s: number, hint = 0): [number, number] {
  const { ss, xs, zs } = path;
  let k = Math.min(Math.max(0, hint), ss.length - 1);
  while (k > 0 && ss[k] > s) k--;
  while (k < ss.length - 2 && ss[k + 1] < s) k++;
  if (ss.length < 2) return [xs[0], zs[0]];
  const len = ss[k + 1] - ss[k];
  const t = len > 0 ? Math.min(1, Math.max(0, (s - ss[k]) / len)) : 0;
  return [xs[k] + (xs[k + 1] - xs[k]) * t, zs[k] + (zs[k + 1] - zs[k]) * t];
}

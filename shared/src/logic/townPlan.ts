import { DEFAULT_GRID_SIZE } from '../constants/grid.js';
import { BuildingType, ZoneDensity, isZone, type PlacedBuilding, type RoadOrientation } from '../types/building.js';
import type { Grid } from '../types/grid.js';
import type { EdgeDirection } from '../types/world.js';
import { getEffectiveSize, getWaterfrontFacing, setGridBuilding } from './placement.js';
import { getStarterEntranceX } from './starterLayout.js';
import { hasWaterSourceInFootprint } from './utilities.js';

/**
 * Seeded town plans on the city grid. The vocabulary (town characters, downtown
 * core, curving residential streets, cul-de-sacs, districts) follows hxtnv/citygen
 * (MIT, see THIRD_PARTY_NOTICES.md); the planner itself works in whole cells so
 * the result is ordinary roads and zones. Same settings and terrain, same town.
 */

export const TOWN_CHARACTERS = ['city', 'crossroads', 'hill', 'river', 'village'] as const;
export type TownCharacter = (typeof TOWN_CHARACTERS)[number];

export interface TownSettings {
  seed: number;
  character: TownCharacter;
  /** Direction of the main street. */
  mainStreet: RoadOrientation;
  /** Share of the plot the town covers. */
  extent: number;
  /** Cells between neighbouring streets. */
  block: number;
  /** How much the downtown grid is uneven and broken up. */
  irregular: number;
  /** How much residential streets bend. */
  curvy: number;
  /** Share of residential streets that end in a cul-de-sac. */
  culdesacs: number;
  /** Share of the area round downtown that gets streets. */
  density: number;
  /** Size of the downtown grid. */
  core: number;
  crossStreet: boolean;
  /** Map edges a road leaves through. */
  exits: EdgeDirection[];
  /** How far out downtown towers reach. */
  downtown: number;
  /** Share of suburban street frontage that gets a lot. */
  lots: number;
  parks: number;
  parking: number;
  /** Include power, water, police, fire, health and a school. */
  services: boolean;
  /** Share of lots that start with a building already on them. */
  built: number;
}

type CharacterKnobs = Pick<TownSettings, 'irregular' | 'curvy' | 'culdesacs' | 'density' | 'core' | 'crossStreet' | 'downtown'>;

export const TOWN_CHARACTER_KNOBS: Record<TownCharacter, CharacterKnobs> = {
  city: { irregular: 0.35, curvy: 0.3, culdesacs: 0.2, density: 0.8, core: 0.6, crossStreet: true, downtown: 0.42 },
  crossroads: { irregular: 0.2, curvy: 0.15, culdesacs: 0.25, density: 0.55, core: 0.35, crossStreet: true, downtown: 0.3 },
  hill: { irregular: 0.6, curvy: 0.9, culdesacs: 0.75, density: 0.6, core: 0.2, crossStreet: false, downtown: 0.2 },
  river: { irregular: 0.5, curvy: 0.55, culdesacs: 0.35, density: 0.55, core: 0.4, crossStreet: false, downtown: 0.3 },
  village: { irregular: 0.7, curvy: 0.7, culdesacs: 0.55, density: 0.35, core: 0.12, crossStreet: false, downtown: 0.16 },
};

export const DEFAULT_TOWN: TownSettings = {
  seed: 1,
  character: 'city',
  mainStreet: 'EW',
  extent: 0.85,
  block: 4,
  ...TOWN_CHARACTER_KNOBS.city,
  exits: ['south'],
  lots: 0.9,
  parks: 0.1,
  parking: 0.15,
  services: true,
  built: 0.15,
};

const EDGES: readonly EdgeDirection[] = ['north', 'east', 'south', 'west'];

/** Clean up settings from an untrusted source. */
export function normalizeTownSettings(input: unknown): TownSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const number = (key: keyof TownSettings, min: number, max: number) => {
    const value = raw[key];
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value)) : DEFAULT_TOWN[key] as number;
  };
  const flag = (key: keyof TownSettings) => typeof raw[key] === 'boolean' ? raw[key] as boolean : DEFAULT_TOWN[key] as boolean;
  return {
    seed: Math.floor(number('seed', 0, 999_999)),
    character: TOWN_CHARACTERS.find(name => name === raw.character) ?? DEFAULT_TOWN.character,
    mainStreet: raw.mainStreet === 'NS' ? 'NS' : 'EW',
    extent: number('extent', 0.3, 1),
    block: Math.round(number('block', 3, 8)),
    irregular: number('irregular', 0, 1),
    curvy: number('curvy', 0, 1),
    culdesacs: number('culdesacs', 0, 1),
    density: number('density', 0, 1),
    core: number('core', 0, 1),
    crossStreet: flag('crossStreet'),
    exits: Array.isArray(raw.exits) ? EDGES.filter(edge => (raw.exits as unknown[]).includes(edge)) : [...DEFAULT_TOWN.exits],
    downtown: number('downtown', 0, 1),
    lots: number('lots', 0, 1),
    parks: number('parks', 0, 0.5),
    parking: number('parking', 0, 1),
    services: flag('services'),
    built: number('built', 0, 1),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const NONE = 0, STREET = 1, MAIN_STREET = 2, AVENUE = 3;

type Plan = Array<Pick<PlacedBuilding, 'type' | 'position' | 'orientation' | 'density' | 'developmentLevel'>>;

class TownPlanner {
  private n = DEFAULT_GRID_SIZE;
  private rand: () => number;
  private road: Uint8Array;
  private used: Uint8Array;
  private plan: Plan = [];
  private cx = 0;
  private cz = 0;
  private ru = 0;
  private rv = 0;

  constructor(private grid: Grid, private s: TownSettings) {
    this.n = grid.length;
    this.rand = mulberry32(s.seed * 7919 + TOWN_CHARACTERS.indexOf(s.character) * 101);
    this.road = new Uint8Array(this.n * this.n);
    this.used = new Uint8Array(this.n * this.n);
  }

  run(): Plan {
    const { s } = this;
    this.ru = Math.max(8, s.extent * (this.n / 2 - 2));
    this.rv = Math.max(8, this.ru * (s.character === 'village' ? 0.6 : s.character === 'river' ? 0.7 : 1));
    this.findCentre();
    this.layMainStreets();
    this.layCore();
    for (const edge of s.exits) this.layExit(edge);
    this.growStreets();
    this.pruneStranded();
    this.emitStreets();
    if (s.services) this.placeServices();
    this.zoneLots();
    return this.plan;
  }

  // ── Grid helpers ──────────────────────────────────────────

  private inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.n && z < this.n;
  }

  private open(x: number, z: number): boolean {
    return this.inside(x, z) && !this.grid[x][z].terrain;
  }

  private roadAt(x: number, z: number): number {
    return this.inside(x, z) ? this.road[x * this.n + z] : NONE;
  }

  private setRoad(x: number, z: number, kind: number): void {
    this.road[x * this.n + z] = kind;
  }

  /** Distance from the town centre, 1 at the edge of town. */
  private reach(x: number, z: number): number {
    const along = this.s.mainStreet === 'EW' ? x - this.cx : z - this.cz;
    const across = this.s.mainStreet === 'EW' ? z - this.cz : x - this.cx;
    return Math.hypot(along / this.ru, across / this.rv);
  }

  /** Main-street coordinates (u along, v across, from the centre) to cells. */
  private cell(u: number, v: number): [number, number] {
    return this.s.mainStreet === 'EW' ? [this.cx + u, this.cz + v] : [this.cx + v, this.cz + u];
  }

  private noise(x: number, z: number, salt: number): number {
    let h = Math.imul(x + 31, 374761393) ^ Math.imul(z + 57, 668265263) ^ Math.imul(this.s.seed + salt * 97, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Put the centre where the most open land is, near the middle of the plot. */
  private findCentre(): void {
    const mid = this.n / 2;
    let best = -Infinity;
    for (let x = Math.floor(this.n * 0.25); x <= this.n * 0.75; x += 2) {
      for (let z = Math.floor(this.n * 0.25); z <= this.n * 0.75; z += 2) {
        if (!this.open(x, z) || !this.open(x + 1, z + 1) || !this.open(x, z + 1) || !this.open(x + 1, z)) continue;
        let score = -Math.hypot(x - mid, z - mid) * 4;
        for (let dx = -14; dx <= 14; dx += 2) {
          for (let dz = -14; dz <= 14; dz += 2) if (this.open(x + dx, z + dz)) score += 2;
        }
        if (score > best) {
          best = score;
          this.cx = x;
          this.cz = z;
        }
      }
    }
    if (best === -Infinity) this.cx = this.cz = mid;
  }

  // ── Streets ───────────────────────────────────────────────

  private layMainStreets(): void {
    const { s } = this;
    if (s.character === 'city' || s.character === 'crossroads') {
      this.layAvenue(true);
      if (s.crossStreet) this.layAvenue(false);
      return;
    }
    // Small towns grew along one street that follows the land.
    this.meander(0, 0);
    if (s.character === 'river') {
      // A second street on the far bank, with bridges across at intervals.
      const bank = s.block + 4;
      this.meander(0, bank);
      for (let u = 0; u <= this.ru * 0.8; u += s.block * 2 + 2) {
        for (const at of u ? [u, -u] : [u]) this.bridge(at, bank);
      }
    }
    if (s.crossStreet) {
      for (const v of [-1, 1]) {
        for (let k = v; Math.abs(k) < this.rv * 0.8; k += v) {
          const [x, z] = this.cell(0, k);
          if (!this.open(x, z)) break;
          if (!this.roadAt(x, z)) this.setRoad(x, z, MAIN_STREET);
        }
      }
    }
  }

  private layAvenue(along: boolean): void {
    const half = Math.floor(along ? this.ru * 0.95 : this.rv * 0.95);
    for (const step of [1, -1]) {
      for (let k = step > 0 ? 0 : -1; Math.abs(k) <= half; k += step) {
        const pair = along ? [this.cell(k, 0), this.cell(k, 1)] : [this.cell(0, k), this.cell(1, k)];
        if (!pair.every(([x, z]) => this.open(x, z))) break;
        if (pair.some(([x, z]) => this.roadAt(x, z))) continue;
        const [x, z] = pair[0];
        const orientation: RoadOrientation = along === (this.s.mainStreet === 'EW') ? 'EW' : 'NS';
        for (const [px, pz] of pair) this.setRoad(px, pz, AVENUE);
        this.plan.push({ type: BuildingType.ROAD_AVENUE, position: { x, z }, orientation });
      }
    }
  }

  private meander(u0: number, v0: number): void {
    const bend = this.s.curvy * 0.28;
    for (const step of [1, -1]) {
      let v = v0;
      let straight = 0;
      // Both halves share the first cells so they meet without a kink.
      for (let u = u0; Math.abs(u - u0) <= this.ru * 0.95; u += step) {
        const [x, z] = this.cell(u, v);
        if (!this.open(x, z)) break;
        this.setRoad(x, z, MAIN_STREET);
        straight++;
        if (straight > 3 && this.rand() < bend) {
          const dv = this.rand() < 0.5 ? 1 : -1;
          const [bx, bz] = this.cell(u, v + dv);
          if (this.open(bx, bz) && Math.abs(v + dv - v0) < 3) {
            v += dv;
            this.setRoad(bx, bz, MAIN_STREET);
            straight = 0;
          }
        }
      }
    }
  }

  /** Join the two banks straight across, if nothing is in the way. */
  private bridge(u: number, bank: number): void {
    const path: Array<[number, number]> = [];
    let from = false;
    for (let v = -3; v <= bank + 3; v++) {
      const at = this.cell(u, v);
      if (this.roadAt(...at)) {
        if (path.length > 2) break;
        path.length = 0;
        from = true;
      } else if (from) {
        if (!this.clear(at[0], at[1], this.dirAcross(1), 1, path)) return;
        path.push(at);
      }
    }
    if (path.length > 2 && path.length < bank + 2) for (const [x, z] of path) this.setRoad(x, z, STREET);
  }

  /** Water or slopes can cut a street off; keep only what connects to the centre. */
  private pruneStranded(): void {
    let start: [number, number] | null = null;
    let nearest = Infinity;
    for (let x = 0; x < this.n; x++) {
      for (let z = 0; z < this.n; z++) {
        const distance = Math.hypot(x - this.cx, z - this.cz);
        if (this.roadAt(x, z) && distance < nearest) {
          nearest = distance;
          start = [x, z];
        }
      }
    }
    if (!start) return;
    const reached = new Uint8Array(this.n * this.n);
    const stack = [start];
    reached[start[0] * this.n + start[1]] = 1;
    while (stack.length) {
      const [x, z] = stack.pop()!;
      for (const [dx, dz] of DIRS) {
        if (!this.roadAt(x + dx, z + dz) || reached[(x + dx) * this.n + z + dz]) continue;
        reached[(x + dx) * this.n + z + dz] = 1;
        stack.push([x + dx, z + dz]);
      }
    }
    for (let i = 0; i < reached.length; i++) if (!reached[i]) this.road[i] = NONE;
    this.plan = this.plan.filter(({ position }) => reached[position.x * this.n + position.z]);
  }

  private layCore(): void {
    const { s } = this;
    const cu = Math.round(s.core * this.ru * 0.8);
    const cv = Math.round(s.core * this.rv * 0.65);
    if (cu < s.block || cv < 3) return;

    const jitter = () => this.rand() < s.irregular ? Math.floor(this.rand() * 3) - 1 : 0;
    const positions: number[] = s.crossStreet ? [] : [0];
    for (const side of [1, -1]) {
      // The cross street takes u = 0 and 1.
      let u = side > 0 && s.crossStreet ? 1 : 0;
      for (;;) {
        u += side * Math.max(3, s.block + jitter());
        if (Math.abs(u) > cu) break;
        positions.push(u);
      }
    }
    positions.sort((a, b) => a - b);

    for (const u of positions) {
      for (const side of [1, -1]) {
        if (this.rand() < s.irregular * 0.22) continue;
        // Start from the outermost main street cell in this column.
        let v = 0;
        for (let k = 0; Math.abs(k) < cv; k += side) if (this.roadAt(...this.cell(u, k))) v = k;
        if (!this.roadAt(...this.cell(u, v))) continue;
        const length = Math.max(3, cv - Math.abs(v) - Math.floor(this.rand() * s.irregular * s.block));
        const path: Array<[number, number]> = [];
        for (let k = 1; k <= length; k++) {
          const at = this.cell(u, v + side * k);
          if (!this.clear(at[0], at[1], this.dirAcross(side), 2, path)) break;
          path.push(at);
        }
        if (path.length >= 3) for (const [x, z] of path) this.setRoad(x, z, STREET);
      }
    }

    // Back streets join neighbouring side streets wherever both reach that far.
    const columns = s.crossStreet ? [...positions, 0, 1].sort((a, b) => a - b) : positions;
    for (const side of [1, -1]) {
      for (let row = s.block + (side > 0 ? 1 : 0); row <= cv; row += Math.max(3, s.block + jitter())) {
        for (let i = 0; i + 1 < columns.length; i++) {
          const from = columns[i], to = columns[i + 1];
          if (to - from < 3 || this.rand() < s.irregular * 0.25) continue;
          const v = side * row;
          if (!this.roadAt(...this.cell(from, v)) || !this.roadAt(...this.cell(to, v))) continue;
          const path: Array<[number, number]> = [];
          for (let u = from + 1; u < to; u++) {
            const at = this.cell(u, v);
            if (!this.clear(at[0], at[1], this.dirAlong(), 2, path, true)) break;
            path.push(at);
          }
          if (path.length === to - from - 1) for (const [x, z] of path) this.setRoad(x, z, STREET);
        }
      }
    }
  }

  private dirAlong(): number {
    return this.s.mainStreet === 'EW' ? 0 : 1;
  }

  private dirAcross(side: number): number {
    const base = this.s.mainStreet === 'EW' ? 1 : 0;
    return side > 0 ? base : base + 2;
  }

  /**
   * Whether a street heading `dir` may take this cell: open land with no other
   * street beside it (adjacent road cells always connect) within `gap` cells.
   */
  private clear(x: number, z: number, dir: number, gap: number, own: Array<[number, number]>, between = false): boolean {
    if (!this.open(x, z) || this.roadAt(x, z)) return false;
    const [lx, lz] = DIRS[(dir + 1) & 3];
    for (let k = 1; k <= gap; k++) {
      for (const side of [1, -1]) {
        const px = x + lx * k * side, pz = z + lz * k * side;
        if (this.roadAt(px, pz)) return false;
        // A path may run beside its own last corner, but not double back.
        const index = own.findIndex(([ox, oz]) => ox === px && oz === pz);
        if (index >= 0 && index < own.length - 2) return false;
      }
    }
    return between || this.reach(x, z) <= 1.02;
  }

  /** Try to grow one street from a road cell; returns the cells it would take. */
  private walk(x: number, z: number, heading: number): Array<[number, number]> | null {
    const { s } = this;
    const culdesac = this.rand() < s.culdesacs;
    const length = s.block + 2 + Math.floor(this.rand() * s.block * 3.5);
    const path: Array<[number, number]> = [];
    let dir = heading;
    let sinceTurn = 0;
    let sidestep = 0;
    for (let step = 0; step < length; step++) {
      const [dx, dz] = DIRS[dir];
      const nx = x + dx, nz = z + dz;
      if (nx < 2 || nz < 2 || nx >= this.n - 2 || nz >= this.n - 2) break;
      if (!this.clear(nx, nz, dir, step < 2 ? s.block - 1 : 2, path)) break;
      const ahead1 = this.roadAt(nx + dx, nz + dz);
      const ahead2 = this.roadAt(nx + dx * 2, nz + dz * 2);
      if (step > 0 && (ahead1 || ahead2)) {
        // Reached another street: join it, or stop short as a cul-de-sac.
        if (culdesac || sinceTurn === 0) break;
        path.push([nx, nz]);
        if (!ahead1) {
          if (!this.clear(nx + dx, nz + dz, dir, 2, path)) { path.pop(); break; }
          path.push([nx + dx, nz + dz]);
        }
        return path.length >= 3 ? path : null;
      }
      path.push([nx, nz]);
      x = nx;
      z = nz;
      sinceTurn++;
      if (sidestep > 0) {
        if (--sidestep === 0) { dir = heading; sinceTurn = 0; }
      } else if (sinceTurn >= 3 && this.rand() < s.curvy * 0.35) {
        dir = (heading + (this.rand() < 0.5 ? 1 : 3)) & 3;
        sinceTurn = 0;
        // Either shift over a cell or two (an S-bend) or turn for good.
        if (this.rand() < 0.65) sidestep = 1 + Math.floor(this.rand() * 2);
        else heading = dir;
      }
    }
    return path.length >= Math.max(3, s.block - 1) ? path : null;
  }

  private growStreets(): void {
    const { s } = this;
    let area = 0;
    let laid = 0;
    const starts: Array<[number, number]> = [];
    for (let x = 0; x < this.n; x++) {
      for (let z = 0; z < this.n; z++) {
        if (this.open(x, z) && this.reach(x, z) <= 1) area++;
        if (this.roadAt(x, z)) {
          laid += this.roadAt(x, z) === AVENUE ? 0.5 : 1;
          if (this.reach(x, z) <= 1) starts.push([x, z]);
        }
      }
    }
    const target = area * s.density * (1.65 / (s.block + 1));
    for (let attempt = 0; attempt < 5000 && laid < target && starts.length; attempt++) {
      const [x, z] = starts[Math.floor(this.rand() * starts.length)];
      const path = this.walk(x, z, Math.floor(this.rand() * 4));
      if (!path) continue;
      for (const [px, pz] of path) {
        this.setRoad(px, pz, STREET);
        starts.push([px, pz]);
      }
      laid += path.length;
    }
  }

  /** Straightest route from the map edge to the streets, over open land. */
  private layExit(edge: EdgeDirection): void {
    const last = this.n - 1;
    const vertical = edge === 'north' || edge === 'south';
    const preferred = edge === 'south' ? getStarterEntranceX(this.n) : vertical ? this.cx : this.cz;
    const at = (k: number): [number, number] => edge === 'north' ? [k, 0] : edge === 'south' ? [k, last] : edge === 'west' ? [0, k] : [last, k];
    const inward = edge === 'north' ? 1 : edge === 'south' ? 3 : edge === 'west' ? 0 : 2;
    const gates = Array.from({ length: this.n }, (_, k) => k)
      .filter(k => k > 2 && k < last - 2 && this.open(...at(k)))
      .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));

    for (const gate of gates.filter((_, i) => i % 4 === 0)) {
      const path = this.route(at(gate), inward);
      if (!path) continue;
      for (const [x, z] of path) this.setRoad(x, z, STREET);
      return;
    }
  }

  private route(start: [number, number], heading: number): Array<[number, number]> | null {
    if (this.roadAt(...start)) return [];
    const states = this.n * this.n * 4;
    const cost = new Float64Array(states).fill(Infinity);
    const previous = new Int32Array(states).fill(-1);
    const key = (x: number, z: number, d: number) => (x * this.n + z) * 4 + d;
    const touches = (x: number, z: number) => DIRS.some(([dx, dz]) => this.roadAt(x + dx, z + dz) !== NONE);
    const first = key(start[0], start[1], heading);
    cost[first] = 0;
    // Costs are small integers, so buckets serve as the priority queue.
    const buckets: number[][] = [[first]];
    for (let c = 0; c < buckets.length; c++) {
      for (const state of buckets[c] ?? []) {
        if (cost[state] !== c) continue;
        const d = state & 3;
        const x = Math.floor((state >> 2) / this.n), z = (state >> 2) % this.n;
        if (touches(x, z)) {
          const path: Array<[number, number]> = [];
          for (let at = state; at >= 0; at = previous[at]) path.push([Math.floor((at >> 2) / this.n), (at >> 2) % this.n]);
          return path;
        }
        for (const turn of [0, 1, 3]) {
          if (state === first && turn) continue;
          const nd = (d + turn) & 3;
          const nx = x + DIRS[nd][0], nz = z + DIRS[nd][1];
          // Stay off the map border so the road leaves at a single point.
          if (!this.open(nx, nz) || nx < 1 || nz < 1 || nx >= this.n - 1 || nz >= this.n - 1) continue;
          const next = key(nx, nz, nd);
          const nextCost = c + (turn ? 4 : 1);
          if (nextCost >= cost[next]) continue;
          cost[next] = nextCost;
          previous[next] = state;
          (buckets[nextCost] ??= []).push(next);
        }
      }
    }
    return null;
  }

  private emitStreets(): void {
    for (let x = 0; x < this.n; x++) {
      for (let z = 0; z < this.n; z++) {
        const kind = this.roadAt(x, z);
        if (kind !== STREET && kind !== MAIN_STREET) continue;
        const ns = this.roadAt(x, z - 1) || this.roadAt(x, z + 1);
        const ew = this.roadAt(x - 1, z) || this.roadAt(x + 1, z);
        this.plan.push({ type: BuildingType.ROAD_STREET, position: { x, z }, orientation: ns && !ew ? 'NS' : 'EW' });
      }
    }
  }

  // ── Lots ──────────────────────────────────────────────────

  private free(x: number, z: number): boolean {
    return this.open(x, z) && !this.roadAt(x, z) && !this.used[x * this.n + z];
  }

  private fronts(x: number, z: number, kinds: readonly number[] = [STREET, MAIN_STREET, AVENUE]): boolean {
    return DIRS.some(([dx, dz]) => kinds.includes(this.roadAt(x + dx, z + dz)));
  }

  private placeServices(): void {
    // A village's taxes only carry the basics.
    const services: Array<[BuildingType, number]> = this.s.character === 'village' ? [
      [BuildingType.WATER_TOWER, 0.55],
      [BuildingType.SEWAGE_PUMP_STATION, 0.8],
      [BuildingType.ENERGY_SOLAR_FARM, 0.85],
      [BuildingType.ENERGY_SUBSTATION, 0.3],
    ] : [
      [BuildingType.GOV_CITY_HALL, 0.35],
      [BuildingType.POLICE_STATION, 0.5],
      [BuildingType.FIRE_STATION, 0.55],
      [BuildingType.HEALTH_CLINIC, 0.5],
      [BuildingType.EDU_ELEMENTARY, 0.6],
      [BuildingType.ENERGY_SUBSTATION, 0.25],
      [BuildingType.ENERGY_SUBSTATION, 0.6],
      [BuildingType.WATER_TOWER, 0.55],
      [BuildingType.WATER_SEWAGE_PLANT, 0.9],
      [BuildingType.ENERGY_COAL_PLANT, 0.95],
      [BuildingType.ENERGY_SOLAR_FARM, 0.85],
    ];
    if (this.s.character === 'hill') services.shift();

    const utilityAnchors: Array<{ type: BuildingType; x: number; z: number }> = [];

    // Place a Water Pump Station on a valid water source (coastline or aquifer)
    {
      const { w, d } = getEffectiveSize(BuildingType.WATER_PUMP_STATION);
      let bestPump: [number, number] | null = null;
      let bestPumpScore = Infinity;
      for (let x = 1; x + w < this.n; x++) {
        for (let z = 1; z + d < this.n; z++) {
          let fits = true;
          for (let dx = 0; dx < w && fits; dx++) {
            for (let dz = 0; dz < d && fits; dz++) fits = this.free(x + dx, z + dz);
          }
          if (!fits || !hasWaterSourceInFootprint(this.grid, { x, z }, w, d)) continue;
          const score = Math.abs(this.reach(x, z) - 0.65) + (this.fronts(x, z) ? 0 : 0.3);
          if (score < bestPumpScore) {
            bestPumpScore = score;
            bestPump = [x, z];
          }
        }
      }
      if (bestPump) {
        const [px, pz] = bestPump;
        for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) this.used[(px + dx) * this.n + pz + dz] = 1;
        this.plan.push({ type: BuildingType.WATER_PUMP_STATION, position: { x: px, z: pz } });
        utilityAnchors.push({ type: BuildingType.WATER_PUMP_STATION, x: px, z: pz });
      }
    }

    for (const [type, distance] of services) {
      const { w, d } = getEffectiveSize(type);
      let best: [number, number] | null = null;
      let bestScore = Infinity;
      for (let x = 1; x + w < this.n; x++) {
        for (let z = 1; z + d < this.n; z++) {
          let fits = true;
          let frontage = false;
          for (let dx = 0; dx < w && fits; dx++) {
            for (let dz = 0; dz < d && fits; dz++) {
              fits = this.free(x + dx, z + dz);
              frontage ||= this.fronts(x + dx, z + dz);
            }
          }
          if (!fits || !frontage) continue;
          const score = Math.abs(this.reach(x, z) - distance) + this.noise(x, z, services.length + distance * 50) * 0.35;
          if (score < bestScore) {
            bestScore = score;
            best = [x, z];
          }
        }
      }
      if (!best) continue;
      const [x, z] = best;
      for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) this.used[(x + dx) * this.n + z + dz] = 1;
      this.plan.push({ type, position: { x, z } });
      utilityAnchors.push({ type, x, z });
    }

    // Lay underground water & sewage mains under streets; zoned neighborhoods conduct
    // electricity automatically, so only stretch spaced power pylons to outlying utilities.
    const waterSet = new Set<number>();
    const sewageSet = new Set<number>();
    const powerSet = new Set<number>();
    const addConduit = (set: Set<number>, type: BuildingType, x: number, z: number) => {
      if (!this.inside(x, z) || this.grid[x][z].terrain === 'water') return;
      const key = x * this.n + z;
      if (set.has(key)) return;
      set.add(key);
      this.plan.push({ type, position: { x, z } });
    };
    const connectManhat = (set: Set<number>, type: BuildingType, x0: number, z0: number, x1: number, z1: number) => {
      const sx = x1 >= x0 ? 1 : -1;
      for (let x = x0; x !== x1 + sx; x += sx) addConduit(set, type, x, z0);
      const sz = z1 >= z0 ? 1 : -1;
      for (let z = z0; z !== z1 + sz; z += sz) addConduit(set, type, x1, z);
    };
    const connectSpacedPylons = (x0: number, z0: number, x1: number, z1: number) => {
      const dx = x1 - x0;
      const dz = z1 - z0;
      const dist = Math.hypot(dx, dz);
      if (dist <= 3) return;
      const segs = Math.max(1, Math.ceil(dist / 5));
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        let px = Math.round(x0 + dx * t);
        let pz = Math.round(z0 + dz * t);
        if (!this.inside(px, pz)) continue;
        if (this.grid[px][pz].terrain === 'water') {
          // Nudge onto dry bank if crossing a narrow stream
          for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (this.inside(px + ox, pz + oz) && this.grid[px + ox][pz + oz].terrain !== 'water') {
              px += ox;
              pz += oz;
              break;
            }
          }
        }
        addConduit(powerSet, BuildingType.UTILITY_POWER_LINE, px, pz);
      }
    };

    const zonedCells: Array<[number, number]> = [];
    for (const item of this.plan) {
      if (
        item.type === BuildingType.ZONE_RESIDENTIAL
        || item.type === BuildingType.ZONE_COMMERCIAL
        || item.type === BuildingType.ZONE_INDUSTRIAL
      ) {
        zonedCells.push([item.position.x, item.position.z]);
      }
    }

    let roadAnchor: [number, number] | null = null;
    for (let x = 0; x < this.n; x++) {
      for (let z = 0; z < this.n; z++) {
        if (this.roadAt(x, z)) {
          if (!roadAnchor || Math.hypot(x - this.cx, z - this.cz) < Math.hypot(roadAnchor[0] - this.cx, roadAnchor[1] - this.cz)) {
            roadAnchor = [x, z];
          }
          addConduit(waterSet, BuildingType.UTILITY_WATER_PIPE, x, z);
          addConduit(sewageSet, BuildingType.UTILITY_SEWAGE_PIPE, x, z);
        }
      }
    }

    if (roadAnchor) {
      for (const anchor of utilityAnchors) {
        let nearestTown: [number, number] = roadAnchor;
        let bestDist = Math.hypot(anchor.x - roadAnchor[0], anchor.z - roadAnchor[1]);
        for (const [zx, zz] of zonedCells) {
          const d = Math.hypot(anchor.x - zx, anchor.z - zz);
          if (d < bestDist) {
            bestDist = d;
            nearestTown = [zx, zz];
          }
        }

        if (anchor.type === BuildingType.WATER_PUMP_STATION || anchor.type === BuildingType.WATER_TOWER) {
          connectManhat(waterSet, BuildingType.UTILITY_WATER_PIPE, anchor.x, anchor.z, roadAnchor[0], roadAnchor[1]);
          if (bestDist > 3) connectSpacedPylons(anchor.x, anchor.z, nearestTown[0], nearestTown[1]);
        } else if (anchor.type === BuildingType.SEWAGE_PUMP_STATION || anchor.type === BuildingType.WATER_SEWAGE_PLANT) {
          connectManhat(sewageSet, BuildingType.UTILITY_SEWAGE_PIPE, anchor.x, anchor.z, roadAnchor[0], roadAnchor[1]);
          if (bestDist > 3) connectSpacedPylons(anchor.x, anchor.z, nearestTown[0], nearestTown[1]);
        } else if (
          anchor.type === BuildingType.ENERGY_COAL_PLANT
          || anchor.type === BuildingType.ENERGY_SOLAR_FARM
          || anchor.type === BuildingType.ENERGY_WIND_TURBINE
          || anchor.type === BuildingType.ENERGY_SUBSTATION
        ) {
          if (bestDist > 4) connectSpacedPylons(anchor.x, anchor.z, nearestTown[0], nearestTown[1]);
        }
      }
    }

    // On coastal or river plots, add waterfront docks/marina where streets approach the shore.
    const waterfrontTypes: BuildingType[] = this.s.character === 'village'
      ? [BuildingType.WATERFRONT_DOCK]
      : [BuildingType.WATERFRONT_MARINA, BuildingType.WATERFRONT_DOCK];
    for (const wfType of waterfrontTypes) {
      let best: { x: number; z: number; orientation: RoadOrientation; score: number } | null = null;
      for (const orientation of ['EW', 'NS'] as const) {
        const { w, d } = getEffectiveSize(wfType, orientation);
        for (let x = 1; x + w < this.n; x++) {
          for (let z = 1; z + d < this.n; z++) {
            let clear = true;
            let nearRoad = false;
            for (let dx = 0; dx < w && clear; dx++) {
              for (let dz = 0; dz < d && clear; dz++) {
                const cx = x + dx, cz = z + dz;
                const t = this.grid[cx][cz].terrain;
                if (t === 'steep' || this.roadAt(cx, cz) || this.used[cx * this.n + cz]) clear = false;
                if (this.fronts(cx, cz)) nearRoad = true;
              }
            }
            if (!clear) continue;
            if (!getWaterfrontFacing(this.grid, { x, z }, wfType, orientation)) continue;
            const score = (nearRoad ? 0 : 1.5) + this.reach(x, z) * 0.5 + this.noise(x, z, 77) * 0.3;
            if (!best || score < best.score) best = { x, z, orientation, score };
          }
        }
      }
      if (!best) continue;
      const { w, d } = getEffectiveSize(wfType, best.orientation);
      for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) this.used[(best.x + dx) * this.n + best.z + dz] = 1;
      this.plan.push({ type: wfType, position: { x: best.x, z: best.z }, orientation: best.orientation });
    }
  }

  private zoneLots(): void {
    const { s } = this;
    const industry = Math.floor(this.rand() * 4) * Math.PI / 2 + Math.PI / 4;
    const hasIndustry = s.character !== 'village';

    for (let x = 0; x < this.n; x++) {
      for (let z = 0; z < this.n; z++) {
        if (!this.free(x, z)) continue;
        const d = this.reach(x, z);
        const central = d < s.downtown * 1.5;
        const front = this.fronts(x, z);
        // Downtown fills its blocks; elsewhere lots line the streets.
        const second = DIRS.some(([dx, dz]) => this.free(x + dx, z + dz) && this.fronts(x + dx, z + dz));
        if (!front && !(central && second)) continue;
        if (!central && this.rand() >= s.lots) continue;

        const onMain = this.fronts(x, z, [MAIN_STREET, AVENUE]);
        let type = BuildingType.ZONE_RESIDENTIAL;
        let density = ZoneDensity.LOW;
        const block = this.noise(Math.floor(x / 4), Math.floor(z / 4), 3);
        const sector = Math.cos(Math.atan2(z - this.cz, x - this.cx) - industry);
        if (d < s.downtown) {
          type = onMain || block < 0.5 ? BuildingType.ZONE_COMMERCIAL : BuildingType.ZONE_RESIDENTIAL;
          density = s.character !== 'village' && d < s.downtown * 0.65 ? ZoneDensity.HIGH : ZoneDensity.MEDIUM;
        } else if (hasIndustry && d > 0.55 && sector > 0.82) {
          type = BuildingType.ZONE_INDUSTRIAL;
          density = block < 0.5 ? ZoneDensity.LOW : ZoneDensity.MEDIUM;
        } else if ((onMain && d < 0.85) || (central && block < 0.35)) {
          type = BuildingType.ZONE_COMMERCIAL;
          density = central ? ZoneDensity.MEDIUM : ZoneDensity.LOW;
        } else if (central) {
          density = ZoneDensity.MEDIUM;
        }

        const green = this.noise(Math.floor(x / 3), Math.floor(z / 3), 11);
        if (type === BuildingType.ZONE_RESIDENTIAL && !onMain && green < s.parks) {
          this.plan.push({ type: BuildingType.PARK, position: { x, z } });
          continue;
        }
        const shops = type !== BuildingType.ZONE_RESIDENTIAL && density !== ZoneDensity.HIGH;
        if (shops && this.noise(Math.floor(x / 2), Math.floor(z / 2), 23) < s.parking * 0.6) {
          this.plan.push({ type: BuildingType.PARKING, position: { x, z } });
          continue;
        }

        const built = this.rand() < s.built * (d < s.downtown ? 1 : 0.95);
        const level = built ? Math.min(3, 1 + Math.floor(this.rand() * s.built * 3.2 * (1.15 - Math.min(1, d) * 0.6))) : 0;
        this.plan.push({ type, position: { x, z }, density, developmentLevel: level });
      }
    }
  }
}

export interface TownPlan {
  grid: Grid;
  buildings: PlacedBuilding[];
}

/** Lay out a town on a grid that has its terrain applied. Existing buildings are ignored. */
export function planTown(terrain: Grid, settings: TownSettings, idPrefix: string, ownerId: string): TownPlan {
  const grid: Grid = terrain.map(column => column.map(cell => ({
    ...(cell.terrain ? { terrain: cell.terrain } : {}),
    buildingId: null,
  })));
  const buildings = new TownPlanner(grid, settings).run().map((item, index): PlacedBuilding => {
    const { type, position, orientation, density, developmentLevel } = item;
    return {
      id: `${idPrefix}:${index}`,
      type,
      position,
      placedBy: ownerId,
      placedAt: 0,
      ...(orientation ? { orientation } : {}),
      ...(isZone(type) ? { density, developmentLevel: developmentLevel ?? 0, ...(developmentLevel ? { developedAt: 0 } : {}) } : {}),
    };
  });
  for (const building of buildings) {
    setGridBuilding(grid, building);
  }
  return { grid, buildings };
}

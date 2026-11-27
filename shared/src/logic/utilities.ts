import { BUILDING_DEFS } from '../constants/buildings.js';
import { DEFAULT_GRID_SIZE } from '../constants/grid.js';
import {
  BuildingType,
  ZoneDensity,
  isRoad,
  isUtilityConduit,
  isZone,
  type PlacedBuilding,
  type RoadOrientation,
} from '../types/building.js';
import type { CityState } from '../types/city.js';
import type { Grid, Position } from '../types/grid.js';
import type { UtilitySummary } from '../types/resources.js';

// ── Coverage & Source Constants ──────────────────────────────

/** Minimum water-table / shoreline richness required to act as a primary water source. */
export const WATER_SOURCE_THRESHOLD = 0.55;

/** Maximum Euclidean span (in tiles between footprints) for stretched overhead power cables. */
export const POWER_MAX_SPAN = 6;
/** Default target spacing (in tiles) between pylons when dragging overhead power lines. */
export const POWER_PYLON_STEP = 5;

/** Local electrical distribution radii (Euclidean tiles) around energized grid elements. */
export const POWER_LINE_RADIUS = 4;
export const POWER_GENERATOR_RADIUS = 6;
export const POWER_SUBSTATION_RADIUS = 9;
/** Maximum street/intersection gap (in tiles) across which contiguous zoned areas pass electricity. */
export const POWER_URBAN_HOP_LIMIT = 3;

/** Local pipe / facility delivery & collection radii (Chebyshev tiles). */
export const WATER_PIPE_RADIUS = 3;
export const WATER_FACILITY_RADIUS = 4;
export const WATER_TOWER_RADIUS = 5;

export const SEWAGE_PIPE_RADIUS = 3;
export const SEWAGE_FACILITY_RADIUS = 4;

/** Bitmask flags in `UtilityGridReport.cellFlags` (indexed as `x * gridSize + z`). */
export const CELL_FLAG_POWER = 1 << 0;
export const CELL_FLAG_WATER = 1 << 1;
export const CELL_FLAG_SEWAGE = 1 << 2;
export const CELL_FLAG_WATER_SOURCE = 1 << 3;

export type WaterSourceKind = 'open_water' | 'shoreline' | 'aquifer' | 'none';

export interface WaterSourceInfo {
  kind: WaterSourceKind;
  /** Hydrological yield (0–1). Cells >= WATER_SOURCE_THRESHOLD can feed water pumps/wells. */
  richness: number;
  isWaterSource: boolean;
}

export type PowerSupplyState = 'powered' | 'brownout' | 'blackout' | 'unconnected' | 'not_needed';
export type WaterSupplyState = 'supplied' | 'low_pressure' | 'dry_pipe' | 'unconnected' | 'not_needed';
export type SewageSupplyState = 'drained' | 'backed_up' | 'disconnected_pipe' | 'unconnected' | 'not_needed';

export interface BuildingUtilityStatus {
  buildingId: string;
  powerDemandMW: number;
  powerRatio: number;
  powered: boolean;
  powerState: PowerSupplyState;
  subgridId: number | null;

  waterDemandM3: number;
  waterRatio: number;
  watered: boolean;
  waterTreated: boolean;
  waterState: WaterSupplyState;

  sewageOutputM3: number;
  sewageRatio: number;
  drained: boolean;
  sewageState: SewageSupplyState;

  /** Overall operating multiplier (0–1) based on electricity, water, and sewage availability. */
  efficiency: number;
}

export interface PowerSubgridInfo {
  id: number;
  generationMW: number;
  demandMW: number;
  loadPct: number;
  overloaded: boolean;
  generatorCount: number;
}

export interface PowerCableSpan {
  fromId: string;
  toId: string;
  /** Cable attachment point on `fromId` in grid tile coordinates (e.g. `x + 0.5`). */
  ax: number;
  az: number;
  /** Cable attachment point on `toId` in grid tile coordinates (e.g. `x + 0.5`). */
  bx: number;
  bz: number;
  /** Minimum Euclidean distance (in tiles) between the two conductor footprints. */
  distance: number;
}

export interface UtilityGridReport {
  gridSize: number;
  summary: UtilitySummary;
  subgrids: PowerSubgridInfo[];
  buildings: Map<string, BuildingUtilityStatus>;
  powerLineState: Map<string, 'energized' | 'overloaded' | 'unenergized'>;
  waterPipeState: Map<string, 'pressurized' | 'low_pressure' | 'dry'>;
  sewagePipeState: Map<string, 'draining' | 'backed_up' | 'disconnected'>;
  facilityNotes: Map<string, string>;
  /** Bitmask of CELL_FLAG_* for each cell `x * gridSize + z`. */
  cellFlags: Uint8Array;
  /** Water source richness (0–100) for each cell `x * gridSize + z`. */
  waterRichness: Uint8Array;
}

// ── Deterministic Groundwater Aquifers & Surface Hydrology ───

interface AquiferBasin {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  peak: number;
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getAquiferBasins(gridSize: number, siteId?: string | null): AquiferBasin[] {
  const scale = gridSize / DEFAULT_GRID_SIZE;
  const seed = siteId ? hashString(siteId) : 0;
  const shift = (n: number, amp: number) => (seed === 0 ? 0 : (((seed >>> n) & 7) - 3.5) * amp * scale);

  // Central valley aquifer + 3 regional basins (~22% of land has aquifer richness >= 0.55)
  return [
    { cx: 31.5 * scale, cz: 31.5 * scale, rx: 7.5 * scale, rz: 6.5 * scale, peak: 0.92 },
    { cx: 14 * scale + shift(0, 1.1), cz: 17 * scale + shift(3, 1.1), rx: 6.5 * scale, rz: 5.5 * scale, peak: 0.88 },
    { cx: 49 * scale + shift(6, 1.1), cz: 16 * scale + shift(9, 1.1), rx: 6.0 * scale, rz: 6.5 * scale, peak: 0.85 },
    { cx: 18 * scale + shift(12, 1.1), cz: 48 * scale + shift(15, 1.1), rx: 7.0 * scale, rz: 5.5 * scale, peak: 0.90 },
  ];
}

/**
 * Inspects surface water adjacency and underground aquifers at `(x, z)`.
 * Shoreline cells within 2 tiles of open water (`terrain === 'water'`) yield 1.0;
 * inland aquifer basins yield up to ~0.92; dry uplands yield < 0.55.
 */
export function getWaterSourceInfo(
  grid: Grid,
  x: number,
  z: number,
  siteId?: string | null,
): WaterSourceInfo {
  const sizeX = grid.length;
  const sizeZ = grid[0]?.length ?? DEFAULT_GRID_SIZE;
  if (x < 0 || z < 0 || x >= sizeX || z >= sizeZ) {
    return { kind: 'none', richness: 0, isWaterSource: false };
  }

  if (grid[x][z]?.terrain === 'water') {
    return { kind: 'open_water', richness: 1, isWaterSource: true };
  }

  // Check proximity to open surface water (rivers, lakes, coastline)
  let minWaterDist = Infinity;
  for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx;
    if (nx < 0 || nx >= sizeX) continue;
    for (let dz = -2; dz <= 2; dz++) {
      const nz = z + dz;
      if (nz < 0 || nz >= sizeZ) continue;
      if (grid[nx][nz]?.terrain === 'water') {
        const dist = Math.max(Math.abs(dx), Math.abs(dz));
        if (dist < minWaterDist) minWaterDist = dist;
      }
    }
  }
  if (minWaterDist <= 2) {
    const richness = minWaterDist === 1 ? 1.0 : 0.85;
    return { kind: 'shoreline', richness, isWaterSource: true };
  }

  // Steep ridges do not hold shallow pumpable aquifers
  if (grid[x][z]?.terrain === 'steep') {
    return { kind: 'none', richness: 0.1, isWaterSource: false };
  }

  const basins = getAquiferBasins(sizeX, siteId);
  let best = 0;
  for (const b of basins) {
    const nd = Math.hypot((x - b.cx) / b.rx, (z - b.cz) / b.rz);
    if (nd < 1.35) {
      const yieldVal = b.peak * Math.max(0, 1 - nd * nd * 0.55);
      if (yieldVal > best) best = yieldVal;
    }
  }

  const richness = Math.round(best * 100) / 100;
  const isWaterSource = richness >= WATER_SOURCE_THRESHOLD;
  return {
    kind: isWaterSource ? 'aquifer' : 'none',
    richness,
    isWaterSource,
  };
}

export function hasWaterSourceInFootprint(
  grid: Grid,
  pos: Position,
  w: number,
  d: number,
  siteId?: string | null,
): boolean {
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      const info = getWaterSourceInfo(grid, pos.x + dx, pos.z + dz, siteId);
      if (info.isWaterSource && info.kind !== 'open_water') {
        return true;
      }
    }
  }
  return false;
}

// ── Building Utility Demand & Supply Specs ───────────────────

function effectiveFootprint(type: BuildingType, orientation?: RoadOrientation): { w: number; d: number } {
  const def = BUILDING_DEFS[type];
  if (!orientation || orientation === 'EW') return { w: def.size.w, d: def.size.d };
  return { w: def.size.d, d: def.size.w };
}

export interface UtilityResourceProfile {
  powerDemandMW: number;
  waterDemandM3: number;
  sewageOutputM3: number;
  /** Lower number = served first during brownouts / shortages. */
  priority: number;
  /** True if this building represents an active home, workplace, or civic facility counted in HUD coverage. */
  countedConsumer: boolean;
}

const RES_POWER: Record<ZoneDensity, [number, number, number]> = {
  [ZoneDensity.LOW]: [0.2, 0.35, 0.5],
  [ZoneDensity.MEDIUM]: [0.5, 1.0, 1.8],
  [ZoneDensity.HIGH]: [1.2, 2.5, 4.5],
};
const COM_POWER: Record<ZoneDensity, [number, number, number]> = {
  [ZoneDensity.LOW]: [0.3, 0.6, 1.0],
  [ZoneDensity.MEDIUM]: [0.8, 1.6, 2.8],
  [ZoneDensity.HIGH]: [2.0, 4.0, 7.0],
};
const IND_POWER: Record<ZoneDensity, [number, number, number]> = {
  [ZoneDensity.LOW]: [0.6, 1.2, 2.0],
  [ZoneDensity.MEDIUM]: [1.5, 3.0, 5.0],
  [ZoneDensity.HIGH]: [3.5, 7.0, 12.0],
};

const RES_WATER: Record<ZoneDensity, [number, number, number]> = {
  [ZoneDensity.LOW]: [4, 7, 11],
  [ZoneDensity.MEDIUM]: [10, 22, 38],
  [ZoneDensity.HIGH]: [22, 48, 85],
};
const COM_WATER: Record<ZoneDensity, [number, number, number]> = {
  [ZoneDensity.LOW]: [3, 6, 10],
  [ZoneDensity.MEDIUM]: [8, 16, 28],
  [ZoneDensity.HIGH]: [18, 35, 60],
};
const IND_WATER: Record<ZoneDensity, [number, number, number]> = {
  [ZoneDensity.LOW]: [6, 12, 20],
  [ZoneDensity.MEDIUM]: [15, 30, 52],
  [ZoneDensity.HIGH]: [32, 62, 100],
};

export function isGeneratorBuilding(type: BuildingType): boolean {
  return (BUILDING_DEFS[type]?.effects?.powerGenerationMW ?? 0) > 0;
}

export function isPowerConductorBuilding(type: BuildingType): boolean {
  return type === BuildingType.UTILITY_POWER_LINE
    || type === BuildingType.ENERGY_SUBSTATION
    || isGeneratorBuilding(type);
}

export function isWaterFacilityBuilding(type: BuildingType): boolean {
  return type === BuildingType.WATER_TOWER
    || type === BuildingType.WATER_PUMP_STATION
    || type === BuildingType.WATER_TREATMENT;
}

export function isSewageFacilityBuilding(type: BuildingType): boolean {
  return type === BuildingType.SEWAGE_PUMP_STATION
    || type === BuildingType.WATER_SEWAGE_PLANT;
}

export function getBuildingUtilityProfile(building: PlacedBuilding): UtilityResourceProfile {
  const { type } = building;
  if (isUtilityConduit(type) || isGeneratorBuilding(type) || type === BuildingType.ENERGY_SUBSTATION) {
    return { powerDemandMW: 0, waterDemandM3: 0, sewageOutputM3: 0, priority: 0, countedConsumer: false };
  }

  if (isRoad(type)) {
    const streetMW = type === BuildingType.ROAD_DIRT ? 0
      : type === BuildingType.ROAD_HIGHWAY ? 0.05
      : type === BuildingType.ROAD_AVENUE ? 0.03
      : 0.015;
    return { powerDemandMW: streetMW, waterDemandM3: 0, sewageOutputM3: 0, priority: 4, countedConsumer: false };
  }

  if (isZone(type)) {
    const level = building.developmentLevel ?? 0;
    if (level <= 0) {
      return { powerDemandMW: 0, waterDemandM3: 0, sewageOutputM3: 0, priority: 3, countedConsumer: false };
    }
    const d = building.density ?? ZoneDensity.MEDIUM;
    const idx = Math.min(2, Math.max(0, level - 1));
    if (type === BuildingType.ZONE_RESIDENTIAL) {
      const w = RES_WATER[d][idx];
      return {
        powerDemandMW: RES_POWER[d][idx],
        waterDemandM3: w,
        sewageOutputM3: Math.round(w * 0.9 * 10) / 10,
        priority: 2,
        countedConsumer: true,
      };
    }
    if (type === BuildingType.ZONE_COMMERCIAL) {
      const w = COM_WATER[d][idx];
      return {
        powerDemandMW: COM_POWER[d][idx],
        waterDemandM3: w,
        sewageOutputM3: Math.round(w * 0.85 * 10) / 10,
        priority: 3,
        countedConsumer: true,
      };
    }
    const w = IND_WATER[d][idx];
    return {
      powerDemandMW: IND_POWER[d][idx],
      waterDemandM3: w,
      sewageOutputM3: Math.round(w * 1.15 * 10) / 10,
      priority: 3,
      countedConsumer: true,
    };
  }

  // Water & sewage facilities need electricity to run pumps/aerators, not consumer pipes
  if (isWaterFacilityBuilding(type) || isSewageFacilityBuilding(type)) {
    const mw = BUILDING_DEFS[type]?.effects?.powerDemandMW ?? 1.5;
    return { powerDemandMW: mw, waterDemandM3: 0, sewageOutputM3: 0, priority: 0, countedConsumer: false };
  }

  if (type === BuildingType.PARK || type === BuildingType.ART_SCULPTURE_PARK || type === BuildingType.PARKING || type === BuildingType.HEALTH_CEMETERY || type === BuildingType.GOV_MONUMENT) {
    const isPark = type === BuildingType.PARK || type === BuildingType.ART_SCULPTURE_PARK;
    return {
      powerDemandMW: 0.15,
      waterDemandM3: isPark ? 3 : 0,
      sewageOutputM3: 0,
      priority: 3,
      countedConsumer: false,
    };
  }

  // Civic, Emergency, Health, Education, Transport, Waterfront, Culture, Tourism
  const def = BUILDING_DEFS[type];
  const area = def.size.w * def.size.d;
  const critical = type === BuildingType.HEALTH_HOSPITAL
    || type === BuildingType.HEALTH_CLINIC
    || type === BuildingType.FIRE_STATION
    || type === BuildingType.FIRE_HQ
    || type === BuildingType.POLICE_STATION
    || type === BuildingType.POLICE_HQ;

  const powerDemandMW = def.effects.powerDemandMW ?? Math.round((0.35 * area + (def.cost / 2500)) * 10) / 10;
  const waterDemandM3 = def.effects.waterDemandM3 ?? Math.round(4 * area + (def.cost / 500));
  const sewageOutputM3 = def.effects.sewageOutputM3 ?? Math.round(waterDemandM3 * 0.9);

  return {
    powerDemandMW,
    waterDemandM3,
    sewageOutputM3,
    priority: critical ? 0 : 1,
    countedConsumer: true,
  };
}

// ── Connected Network Evaluation ─────────────────────────────

const CARDINAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function stampSquare(
  target: Int16Array,
  size: number,
  cx: number,
  cz: number,
  radius: number,
  subnetId: number,
  preferSubnet?: (current: number, incoming: number) => boolean,
): void {
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(size - 1, cx + radius);
  const z0 = Math.max(0, cz - radius);
  const z1 = Math.min(size - 1, cz + radius);
  for (let x = x0; x <= x1; x++) {
    const row = x * size;
    for (let z = z0; z <= z1; z++) {
      const cur = target[row + z];
      if (cur === -1 || (cur !== subnetId && preferSubnet?.(cur, subnetId))) {
        target[row + z] = subnetId;
      }
    }
  }
}

function stampCircle(
  target: Int16Array,
  size: number,
  cx: number,
  cz: number,
  radius: number,
  subnetId: number,
  preferSubnet?: (current: number, incoming: number) => boolean,
): void {
  const rSq = (radius + 0.35) * (radius + 0.35);
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(size - 1, cx + radius);
  const z0 = Math.max(0, cz - radius);
  const z1 = Math.min(size - 1, cz + radius);
  for (let x = x0; x <= x1; x++) {
    const dx = x - cx;
    const row = x * size;
    for (let z = z0; z <= z1; z++) {
      const dz = z - cz;
      if (dx * dx + dz * dz > rSq) continue;
      const cur = target[row + z];
      if (cur === -1 || (cur !== subnetId && preferSubnet?.(cur, subnetId))) {
        target[row + z] = subnetId;
      }
    }
  }
}

/**
 * Computes stretched overhead cable spans between power pylons, substations, and generators.
 * Conductors within `maxSpan` Euclidean tiles link together; Relative Neighborhood Graph (RNG)
 * pruning removes redundant overlapping chords while strictly preserving full subgrid connectivity.
 */
export function computePowerCableSpans(
  buildings: readonly PlacedBuilding[],
  maxSpan = POWER_MAX_SPAN,
): PowerCableSpan[] {
  interface ConductorNode {
    id: string;
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    w: number;
    d: number;
    cx: number;
    cz: number;
  }

  const nodes: ConductorNode[] = [];
  for (const b of buildings) {
    if (!isPowerConductorBuilding(b.type)) continue;
    const { w, d } = effectiveFootprint(b.type, b.orientation);
    nodes.push({
      id: b.id,
      x0: b.position.x,
      z0: b.position.z,
      x1: b.position.x + w - 1,
      z1: b.position.z + d - 1,
      w,
      d,
      cx: b.position.x + w * 0.5,
      cz: b.position.z + d * 0.5,
    });
  }

  const n = nodes.length;
  if (n < 2) return [];

  const footDist = (a: ConductorNode, b: ConductorNode): number => {
    const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
    const dz = Math.max(0, a.z0 - b.z1, b.z0 - a.z1);
    return Math.hypot(dx, dz);
  };
  const centerDist = (a: ConductorNode, b: ConductorNode): number =>
    Math.hypot(a.cx - b.cx, a.cz - b.cz);

  // Collect all candidate pairs within maxSpan and index neighbors per node
  const candidates: Array<{ i: number; j: number; fDist: number; cDist: number }> = [];
  const adj = Array.from({ length: n }, () => new Map<number, number>());

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const fDist = footDist(nodes[i], nodes[j]);
      if (fDist <= maxSpan + 1e-6) {
        const cDist = centerDist(nodes[i], nodes[j]);
        candidates.push({ i, j, fDist, cDist });
        adj[i].set(j, cDist);
        adj[j].set(i, cDist);
      }
    }
  }

  const clampAnchor = (origin: number, span: number, targetCenter: number): number => {
    if (span <= 1) return origin + 0.5;
    const rel = targetCenter - origin;
    return origin + Math.max(0.5, Math.min(span - 0.5, rel));
  };

  const spans: PowerCableSpan[] = [];
  for (const { i, j, fDist, cDist } of candidates) {
    let shadowed = false;
    const adjI = adj[i];
    const adjJ = adj[j];
    const limit = cDist * 0.99;
    for (const [k, dik] of adjI) {
      if (k === j || dik >= limit) continue;
      const dkj = adjJ.get(k);
      if (dkj !== undefined && dkj < limit) {
        shadowed = true;
        break;
      }
    }
    if (shadowed) continue;

    const a = nodes[i];
    const b = nodes[j];
    spans.push({
      fromId: a.id,
      toId: b.id,
      ax: clampAnchor(a.x0, a.w, b.cx),
      az: clampAnchor(a.z0, a.d, b.cz),
      bx: clampAnchor(b.x0, b.w, a.cx),
      bz: clampAnchor(b.z0, b.d, a.cz),
      distance: fDist,
    });
  }

  return spans;
}

/**
 * Evaluates the city's Electricity, Water, and Sewage networks:
 * 1. Power Grid: connected subgrids of generators, substations, and power lines;
 *    realistic MW generation vs consumption, priority dispatch, brownouts & blackouts.
 * 2. Water Network: natural shoreline/aquifer source validation, pump power dependency,
 *    pipe pressurization, upland reservoir towers, and m³/h supply allocation.
 * 3. Sewage Network: sewer pipe drainage to powered sewage stations/plants and backup detection.
 */
export function evaluateCityUtilities(state: CityState): UtilityGridReport {
  const size = state.grid.length || DEFAULT_GRID_SIZE;
  const totalCells = size * size;
  const cellFlags = new Uint8Array(totalCells);
  const waterRichness = new Uint8Array(totalCells);

  // Precompute natural water sources across the grid
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      const info = getWaterSourceInfo(state.grid, x, z, state.siteId);
      waterRichness[x * size + z] = Math.round(info.richness * 100);
      if (info.isWaterSource) {
        cellFlags[x * size + z] |= CELL_FLAG_WATER_SOURCE;
      }
    }
  }

  // Index buildings and urban conductivity mask
  const powerCellNodes: string[][] = Array.from({ length: totalCells }, () => []);
  const waterCellNodes: string[][] = Array.from({ length: totalCells }, () => []);
  const sewageCellNodes: string[][] = Array.from({ length: totalCells }, () => []);
  const urbanConductive = new Uint8Array(totalCells);
  const pavedRoadCell = new Uint8Array(totalCells);
  const byId = new Map<string, PlacedBuilding>();
  const powerConductors: PlacedBuilding[] = [];

  for (const b of state.buildings) {
    byId.set(b.id, b);
    const { w, d } = effectiveFootprint(b.type, b.orientation);

    if (isPowerConductorBuilding(b.type)) {
      powerConductors.push(b);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const cx = b.position.x + dx, cz = b.position.z + dz;
          if (cx >= 0 && cx < size && cz >= 0 && cz < size) {
            powerCellNodes[cx * size + cz].push(b.id);
          }
        }
      }
    }

    if (b.type === BuildingType.UTILITY_WATER_PIPE || isWaterFacilityBuilding(b.type)) {
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const cx = b.position.x + dx, cz = b.position.z + dz;
          if (cx >= 0 && cx < size && cz >= 0 && cz < size) {
            waterCellNodes[cx * size + cz].push(b.id);
          }
        }
      }
    }

    if (b.type === BuildingType.UTILITY_SEWAGE_PIPE || isSewageFacilityBuilding(b.type)) {
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const cx = b.position.x + dx, cz = b.position.z + dz;
          if (cx >= 0 && cx < size && cz >= 0 && cz < size) {
            sewageCellNodes[cx * size + cz].push(b.id);
          }
        }
      }
    }

    if (isRoad(b.type) && b.type !== BuildingType.ROAD_DIRT) {
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const cx = b.position.x + dx, cz = b.position.z + dz;
          if (cx >= 0 && cx < size && cz >= 0 && cz < size) {
            pavedRoadCell[cx * size + cz] = 1;
          }
        }
      }
    }

    // All zoned lots (even empty newly-zoned cells) and non-road/non-conduit buildings
    // pass low-voltage electricity continuously across contiguous city districts.
    const conductsDistrict = isZone(b.type)
      || (!isRoad(b.type) && !isUtilityConduit(b.type) && !isPowerConductorBuilding(b.type));
    if (conductsDistrict) {
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const cx = b.position.x + dx, cz = b.position.z + dz;
          if (cx >= 0 && cx < size && cz >= 0 && cz < size) {
            urbanConductive[cx * size + cz] = 1;
          }
        }
      }
    }
  }

  // Helper to build connected components from cell-indexed building IDs
  const buildComponents = (cellBuckets: string[][]): { compOfBuilding: Map<string, number>; compMembers: string[][] } => {
    const compOfBuilding = new Map<string, number>();
    const compMembers: string[][] = [];
    const cellOccupied = new Int32Array(totalCells).fill(-1);

    for (let idx = 0; idx < totalCells; idx++) {
      if (cellBuckets[idx].length === 0 || cellOccupied[idx] !== -1) continue;
      const compId = compMembers.length;
      const members = new Set<string>();
      const queue = [idx];
      cellOccupied[idx] = compId;

      while (queue.length > 0) {
        const cur = queue.pop()!;
        const cx = Math.floor(cur / size);
        const cz = cur % size;
        for (const bid of cellBuckets[cur]) {
          if (!members.has(bid)) {
            members.add(bid);
            compOfBuilding.set(bid, compId);
            // Enqueue all footprint cells of multi-tile buildings
            const b = byId.get(bid)!;
            const { w, d } = effectiveFootprint(b.type, b.orientation);
            for (let dx = 0; dx < w; dx++) {
              for (let dz = 0; dz < d; dz++) {
                const fx = b.position.x + dx, fz = b.position.z + dz;
                if (fx >= 0 && fx < size && fz >= 0 && fz < size) {
                  const fIdx = fx * size + fz;
                  if (cellOccupied[fIdx] === -1) {
                    cellOccupied[fIdx] = compId;
                    queue.push(fIdx);
                  }
                }
              }
            }
          }
        }
        for (const [dx, dz] of CARDINAL_DIRS) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
          const nIdx = nx * size + nz;
          if (cellBuckets[nIdx].length > 0 && cellOccupied[nIdx] === -1) {
            cellOccupied[nIdx] = compId;
            queue.push(nIdx);
          }
        }
      }
      compMembers.push(Array.from(members));
    }
    return { compOfBuilding, compMembers };
  };

  // ── PASS 1: Power Grid (Stretched Spans + Range + Zoned Conduction) ──
  // 1a. Group contiguous zoned & civic blocks into Urban Clusters (hopping across streets/avenues <= 3 tiles)
  const urbanClusterOfCell = new Int32Array(totalCells).fill(-1);
  const urbanClusters: number[][] = [];
  const hopR = POWER_URBAN_HOP_LIMIT;
  const hopSqMax = hopR * hopR + 1; // <= 10 (3.16 tiles: crosses 1-tile streets, 2-tile avenues & intersections)

  for (let idx = 0; idx < totalCells; idx++) {
    if (!urbanConductive[idx] || urbanClusterOfCell[idx] !== -1) continue;
    const uId = urbanClusters.length;
    const cells: number[] = [];
    const queue = [idx];
    urbanClusterOfCell[idx] = uId;

    while (queue.length > 0) {
      const cur = queue.pop()!;
      cells.push(cur);
      const cx = Math.floor(cur / size);
      const cz = cur % size;
      const x0 = Math.max(0, cx - hopR);
      const x1 = Math.min(size - 1, cx + hopR);
      const z0 = Math.max(0, cz - hopR);
      const z1 = Math.min(size - 1, cz + hopR);
      for (let nx = x0; nx <= x1; nx++) {
        const dx = nx - cx;
        const row = nx * size;
        for (let nz = z0; nz <= z1; nz++) {
          const dz = nz - cz;
          if (dx * dx + dz * dz > hopSqMax) continue;
          const nIdx = row + nz;
          if (urbanConductive[nIdx] && urbanClusterOfCell[nIdx] === -1) {
            urbanClusterOfCell[nIdx] = uId;
            queue.push(nIdx);
          }
        }
      }
    }
    urbanClusters.push(cells);
  }

  // 1b. Union-Find uniting overhead conductors (via stretched cable spans <= POWER_MAX_SPAN)
  //     AND bridging conductors that energize the same contiguous Urban Cluster!
  const kCond = powerConductors.length;
  const ufCount = kCond + urbanClusters.length;
  const ufParent = new Int32Array(ufCount);
  for (let i = 0; i < ufCount; i++) ufParent[i] = i;
  const ufFind = (x: number): number => {
    let r = x;
    while (ufParent[r] !== r) r = ufParent[r];
    let c = x;
    while (c !== r) {
      const next = ufParent[c];
      ufParent[c] = r;
      c = next;
    }
    return r;
  };
  const ufUnion = (a: number, b: number): void => {
    const ra = ufFind(a);
    const rb = ufFind(b);
    if (ra !== rb) ufParent[rb] = ra;
  };

  const condIdxById = new Map<string, number>();
  powerConductors.forEach((b, i) => condIdxById.set(b.id, i));

  const cableSpans = computePowerCableSpans(powerConductors, POWER_MAX_SPAN);
  for (const span of cableSpans) {
    const ia = condIdxById.get(span.fromId);
    const ib = condIdxById.get(span.toId);
    if (ia !== undefined && ib !== undefined) ufUnion(ia, ib);
  }

  // Track unenergized conductor aura too so buildings near dead pylons report 'blackout'
  const anyConductorAura = new Uint8Array(totalCells);
  for (let ci = 0; ci < kCond; ci++) {
    const b = powerConductors[ci];
    const radius = b.type === BuildingType.ENERGY_SUBSTATION
      ? POWER_SUBSTATION_RADIUS
      : isGeneratorBuilding(b.type)
        ? POWER_GENERATOR_RADIUS
        : POWER_LINE_RADIUS;
    const rSq = (radius + 0.35) * (radius + 0.35);
    const { w, d } = effectiveFootprint(b.type, b.orientation);

    for (let fx = 0; fx < w; fx++) {
      for (let fz = 0; fz < d; fz++) {
        const cx = b.position.x + fx;
        const cz = b.position.z + fz;
        const x0 = Math.max(0, cx - radius);
        const x1 = Math.min(size - 1, cx + radius);
        const z0 = Math.max(0, cz - radius);
        const z1 = Math.min(size - 1, cz + radius);
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx;
          const row = x * size;
          for (let z = z0; z <= z1; z++) {
            const dz = z - cz;
            if (dx * dx + dz * dz > rSq) continue;
            const cellIdx = row + z;
            anyConductorAura[cellIdx] = 1;
            const uId = urbanClusterOfCell[cellIdx];
            if (uId !== -1) {
              ufUnion(ci, kCond + uId);
            }
          }
        }
      }
    }
  }

  // Propagate dead-conductor aura across connected urban clusters as well
  for (let uId = 0; uId < urbanClusters.length; uId++) {
    const cells = urbanClusters[uId];
    let touchesConductor = false;
    for (const cIdx of cells) {
      if (anyConductorAura[cIdx]) {
        touchesConductor = true;
        break;
      }
    }
    if (touchesConductor) {
      for (const cIdx of cells) anyConductorAura[cIdx] = 1;
    }
  }

  // Group conductors into unified subgrids
  const rootToSubgrid = new Map<number, number>();
  const powerCompMembers: string[][] = [];
  const powerCompOfBuilding = new Map<string, number>();

  for (let ci = 0; ci < kCond; ci++) {
    const root = ufFind(ci);
    let cid = rootToSubgrid.get(root);
    if (cid === undefined) {
      cid = powerCompMembers.length;
      rootToSubgrid.set(root, cid);
      powerCompMembers.push([]);
    }
    const bid = powerConductors[ci].id;
    powerCompMembers[cid].push(bid);
    powerCompOfBuilding.set(bid, cid);
  }
  const powerComps = { compOfBuilding: powerCompOfBuilding, compMembers: powerCompMembers };

  const subgridGenMW: number[] = [];
  const subgridGenCount: number[] = [];
  const subgridGenCenters: Position[][] = [];

  for (let cid = 0; cid < powerComps.compMembers.length; cid++) {
    let genMW = 0;
    let genCount = 0;
    const centers: Position[] = [];
    for (const bid of powerComps.compMembers[cid]) {
      const b = byId.get(bid)!;
      const mw = BUILDING_DEFS[b.type]?.effects?.powerGenerationMW ?? 0;
      if (mw > 0) {
        genMW += mw;
        genCount++;
        centers.push(b.position);
      }
    }
    subgridGenMW.push(genMW);
    subgridGenCount.push(genCount);
    subgridGenCenters.push(centers);
  }

  const powerCoverage = new Int16Array(totalCells).fill(-1);
  const preferMoreGen = (cur: number, inc: number) => subgridGenMW[inc] > subgridGenMW[cur];

  // Stamp circular power range around energized pylons, substations, and generators
  for (let cid = 0; cid < powerComps.compMembers.length; cid++) {
    if (subgridGenMW[cid] <= 0) continue;
    for (const bid of powerComps.compMembers[cid]) {
      const b = byId.get(bid)!;
      const radius = b.type === BuildingType.ENERGY_SUBSTATION
        ? POWER_SUBSTATION_RADIUS
        : isGeneratorBuilding(b.type)
          ? POWER_GENERATOR_RADIUS
          : POWER_LINE_RADIUS;
      const { w, d } = effectiveFootprint(b.type, b.orientation);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          stampCircle(powerCoverage, size, b.position.x + dx, b.position.z + dz, radius, cid, preferMoreGen);
        }
      }
    }
  }

  // Flood electricity across every energized Urban Cluster (plus adjacent street frontage)
  for (let uId = 0; uId < urbanClusters.length; uId++) {
    const cid = rootToSubgrid.get(ufFind(kCond + uId));
    if (cid === undefined || subgridGenMW[cid] <= 0) continue;
    for (const cIdx of urbanClusters[uId]) {
      const cur = powerCoverage[cIdx];
      if (cur === -1 || (cur !== cid && preferMoreGen(cur, cid))) {
        powerCoverage[cIdx] = cid;
      }
      const cx = Math.floor(cIdx / size);
      const cz = cIdx % size;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= size) continue;
        const row = nx * size;
        for (let dz = -1; dz <= 1; dz++) {
          const nz = cz + dz;
          if (nz < 0 || nz >= size) continue;
          const rIdx = row + nz;
          if (pavedRoadCell[rIdx] && powerCoverage[rIdx] === -1) {
            powerCoverage[rIdx] = cid;
          }
        }
      }
    }
  }

  for (let idx = 0; idx < totalCells; idx++) {
    if (powerCoverage[idx] !== -1) cellFlags[idx] |= CELL_FLAG_POWER;
  }

  // Group power consumers by subgrid and dispatch MW
  const profiles = new Map<string, UtilityResourceProfile>();
  const statusMap = new Map<string, BuildingUtilityStatus>();
  const subgridConsumers: Array<Array<{ b: PlacedBuilding; profile: UtilityResourceProfile; dist: number }>> =
    Array.from({ length: powerComps.compMembers.length }, () => []);

  for (const b of state.buildings) {
    const profile = getBuildingUtilityProfile(b);
    profiles.set(b.id, profile);

    const { w, d } = effectiveFootprint(b.type, b.orientation);
    let bestSubgrid = -1;
    let touchedDeadPowerLine = false;
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const cx = b.position.x + dx, cz = b.position.z + dz;
        if (cx < 0 || cx >= size || cz < 0 || cz >= size) continue;
        const cellIdx = cx * size + cz;
        const sub = powerCoverage[cellIdx];
        if (sub !== -1 && (bestSubgrid === -1 || subgridGenMW[sub] > subgridGenMW[bestSubgrid])) {
          bestSubgrid = sub;
        }
        if (bestSubgrid === -1 && profile.powerDemandMW > 0 && anyConductorAura[cellIdx]) {
          touchedDeadPowerLine = true;
        }
      }
    }

    const needsPower = profile.powerDemandMW > 0;
    const status: BuildingUtilityStatus = {
      buildingId: b.id,
      powerDemandMW: profile.powerDemandMW,
      powerRatio: needsPower ? 0 : 1,
      powered: !needsPower,
      powerState: !needsPower ? 'not_needed' : touchedDeadPowerLine ? 'blackout' : 'unconnected',
      subgridId: bestSubgrid === -1 ? null : bestSubgrid,

      waterDemandM3: profile.waterDemandM3,
      waterRatio: profile.waterDemandM3 > 0 ? 0 : 1,
      watered: profile.waterDemandM3 <= 0,
      waterTreated: false,
      waterState: profile.waterDemandM3 > 0 ? 'unconnected' : 'not_needed',

      sewageOutputM3: profile.sewageOutputM3,
      sewageRatio: profile.sewageOutputM3 > 0 ? 0 : 1,
      drained: profile.sewageOutputM3 <= 0,
      sewageState: profile.sewageOutputM3 > 0 ? 'unconnected' : 'not_needed',

      efficiency: 1,
    };
    statusMap.set(b.id, status);

    if (needsPower && bestSubgrid !== -1) {
      const centers = subgridGenCenters[bestSubgrid];
      let minDist = 999;
      for (const c of centers) {
        const dist = Math.hypot(b.position.x - c.x, b.position.z - c.z);
        if (dist < minDist) minDist = dist;
      }
      subgridConsumers[bestSubgrid].push({ b, profile, dist: minDist });
    }
  }

  const subgrids: PowerSubgridInfo[] = [];
  const subgridOverloaded = new Set<number>();

  for (let cid = 0; cid < powerComps.compMembers.length; cid++) {
    const genMW = subgridGenMW[cid];
    const consumers = subgridConsumers[cid];
    consumers.sort((a, b) => (a.profile.priority - b.profile.priority) || (a.dist - b.dist));

    const demandMW = consumers.reduce((s, c) => s + c.profile.powerDemandMW, 0);
    const loadPct = genMW > 0 ? Math.round((demandMW / genMW) * 100) : (demandMW > 0 ? 999 : 0);
    const overloaded = demandMW > genMW + 1e-6;
    if (overloaded) subgridOverloaded.add(cid);

    let usedMW = 0;
    const brownoutCeiling = genMW * 1.25;
    for (const { b, profile } of consumers) {
      const st = statusMap.get(b.id)!;
      usedMW += profile.powerDemandMW;
      if (usedMW <= genMW + 1e-6) {
        st.powerRatio = 1;
        st.powered = true;
        st.powerState = 'powered';
      } else if (usedMW <= brownoutCeiling) {
        st.powerRatio = Math.max(0.35, Math.round((genMW / Math.max(demandMW, 0.1)) * 100) / 100);
        st.powered = true;
        st.powerState = 'brownout';
      } else {
        st.powerRatio = 0;
        st.powered = false;
        st.powerState = 'blackout';
      }
    }

    if (genMW > 0 || consumers.length > 0) {
      subgrids.push({
        id: cid + 1,
        generationMW: Math.round(genMW * 10) / 10,
        demandMW: Math.round(demandMW * 10) / 10,
        loadPct,
        overloaded,
        generatorCount: subgridGenCount[cid],
      });
    }
  }

  const powerLineState = new Map<string, 'energized' | 'overloaded' | 'unenergized'>();
  for (const [bid, cid] of powerComps.compOfBuilding) {
    if (subgridGenMW[cid] <= 0) powerLineState.set(bid, 'unenergized');
    else if (subgridOverloaded.has(cid)) powerLineState.set(bid, 'overloaded');
    else powerLineState.set(bid, 'energized');
  }

  const facilityNotes = new Map<string, string>();

  // ── PASS 2: Water Network (Sources → Pipes → Consumers) ────
  const waterComps = buildComponents(waterCellNodes);
  const waterSubnetSupply: number[] = [];
  const waterSubnetTreated: boolean[] = [];
  const waterSubnetHasSource: boolean[] = [];
  let activeWaterSources = 0;

  for (let wid = 0; wid < waterComps.compMembers.length; wid++) {
    let hasSource = false;
    let rawSupply = 0;
    let reservoirSupply = 0;
    let hasTreatment = false;

    for (const bid of waterComps.compMembers[wid]) {
      const b = byId.get(bid)!;
      if (!isWaterFacilityBuilding(b.type)) continue;
      const st = statusMap.get(b.id)!;
      const { w, d } = effectiveFootprint(b.type, b.orientation);

      let maxSourceRichness = 0;
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          const info = getWaterSourceInfo(state.grid, b.position.x + dx, b.position.z + dz, state.siteId);
          if (info.isWaterSource && info.kind !== 'open_water' && info.richness > maxSourceRichness) {
            maxSourceRichness = info.richness;
          }
        }
      }
      const onSource = maxSourceRichness >= WATER_SOURCE_THRESHOLD;

      if (b.type === BuildingType.WATER_PUMP_STATION) {
        if (!onSource) {
          facilityNotes.set(b.id, 'Dry: not placed on a water source');
        } else if (st.powerRatio <= 0) {
          facilityNotes.set(b.id, 'Unpowered: connect Pump Station to the Power Grid');
        } else {
          hasSource = true;
          activeWaterSources++;
          rawSupply += 450 * maxSourceRichness * st.powerRatio;
        }
      } else if (b.type === BuildingType.WATER_TOWER) {
        const effPower = Math.max(0.35, st.powerRatio);
        if (onSource) {
          hasSource = true;
          activeWaterSources++;
          rawSupply += 150 * effPower;
          if (st.powerRatio <= 0) {
            facilityNotes.set(b.id, 'Gravity reserve only (35%): connect Power Grid for full pressure');
          }
        } else {
          reservoirSupply += 120 * effPower;
        }
      } else if (b.type === BuildingType.WATER_TREATMENT) {
        if (st.powerRatio <= 0) {
          facilityNotes.set(b.id, 'Unpowered: connect Treatment Plant to the Power Grid');
        } else {
          hasTreatment = true;
          if (onSource) {
            hasSource = true;
            activeWaterSources++;
            rawSupply += 1000 * st.powerRatio;
          } else {
            reservoirSupply += 900 * st.powerRatio;
          }
        }
      }
    }

    // Annotate upland towers/treatment plants if their subnet has no primary water source
    if (!hasSource) {
      for (const bid of waterComps.compMembers[wid]) {
        const b = byId.get(bid)!;
        if ((b.type === BuildingType.WATER_TOWER || b.type === BuildingType.WATER_TREATMENT) && !facilityNotes.has(b.id)) {
          facilityNotes.set(b.id, 'Dry: connect via Water Pipes to a Pump Station or Aquifer');
        }
      }
    }

    waterSubnetHasSource.push(hasSource);
    waterSubnetTreated.push(hasSource && hasTreatment);
    waterSubnetSupply.push(hasSource ? rawSupply + reservoirSupply : 0);
  }

  const waterCoverage = new Int16Array(totalCells).fill(-1);
  const allPipeCoverage = new Int16Array(totalCells).fill(-1);
  const preferMoreWater = (cur: number, inc: number) => waterSubnetSupply[inc] > waterSubnetSupply[cur];

  for (let wid = 0; wid < waterComps.compMembers.length; wid++) {
    const pressurized = waterSubnetSupply[wid] > 0;
    for (const bid of waterComps.compMembers[wid]) {
      const b = byId.get(bid)!;
      const radius = b.type === BuildingType.WATER_TOWER
        ? WATER_TOWER_RADIUS
        : isWaterFacilityBuilding(b.type)
          ? WATER_FACILITY_RADIUS
          : WATER_PIPE_RADIUS;
      const { w, d } = effectiveFootprint(b.type, b.orientation);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          stampSquare(allPipeCoverage, size, b.position.x + dx, b.position.z + dz, radius, wid);
          if (pressurized) {
            stampSquare(waterCoverage, size, b.position.x + dx, b.position.z + dz, radius, wid, preferMoreWater);
          }
        }
      }
    }
  }

  for (let idx = 0; idx < totalCells; idx++) {
    if (waterCoverage[idx] !== -1) cellFlags[idx] |= CELL_FLAG_WATER;
  }

  const waterSubnetConsumers: Array<Array<{ b: PlacedBuilding; profile: UtilityResourceProfile }>> =
    Array.from({ length: waterComps.compMembers.length }, () => []);

  for (const b of state.buildings) {
    const profile = profiles.get(b.id)!;
    if (profile.waterDemandM3 <= 0) continue;
    const { w, d } = effectiveFootprint(b.type, b.orientation);
    let bestSubnet = -1;
    let dryPipeNearby = false;
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const cx = b.position.x + dx, cz = b.position.z + dz;
        if (cx < 0 || cx >= size || cz < 0 || cz >= size) continue;
        const wid = waterCoverage[cx * size + cz];
        if (wid !== -1 && (bestSubnet === -1 || waterSubnetSupply[wid] > waterSubnetSupply[bestSubnet])) {
          bestSubnet = wid;
        }
        if (allPipeCoverage[cx * size + cz] !== -1) dryPipeNearby = true;
      }
    }
    if (bestSubnet !== -1) {
      waterSubnetConsumers[bestSubnet].push({ b, profile });
    } else if (dryPipeNearby) {
      statusMap.get(b.id)!.waterState = 'dry_pipe';
    }
  }

  const waterSubnetLowPressure = new Set<number>();
  for (let wid = 0; wid < waterComps.compMembers.length; wid++) {
    const supply = waterSubnetSupply[wid];
    if (supply <= 0) continue;
    const consumers = waterSubnetConsumers[wid];
    consumers.sort((a, b) => a.profile.priority - b.profile.priority);
    const demand = consumers.reduce((s, c) => s + c.profile.waterDemandM3, 0);
    if (demand > supply + 1e-6) waterSubnetLowPressure.add(wid);

    let used = 0;
    for (const { b, profile } of consumers) {
      const st = statusMap.get(b.id)!;
      used += profile.waterDemandM3;
      st.waterTreated = waterSubnetTreated[wid];
      if (used <= supply + 1e-6) {
        st.waterRatio = 1;
        st.watered = true;
        st.waterState = 'supplied';
      } else if (used <= supply * 1.35) {
        st.waterRatio = Math.max(0.3, Math.round((supply / demand) * 100) / 100);
        st.watered = true;
        st.waterState = 'low_pressure';
      } else {
        st.waterRatio = 0;
        st.watered = false;
        st.waterState = 'low_pressure';
      }
    }
  }

  const waterPipeState = new Map<string, 'pressurized' | 'low_pressure' | 'dry'>();
  for (const [bid, wid] of waterComps.compOfBuilding) {
    if (waterSubnetSupply[wid] <= 0) waterPipeState.set(bid, 'dry');
    else if (waterSubnetLowPressure.has(wid)) waterPipeState.set(bid, 'low_pressure');
    else waterPipeState.set(bid, 'pressurized');
  }

  // ── PASS 3: Sewage Network (Producers → Sewer Pipes → Treatment) ──
  const sewageComps = buildComponents(sewageCellNodes);
  const sewageSubnetCap: number[] = [];

  for (let sid = 0; sid < sewageComps.compMembers.length; sid++) {
    let cap = 0;
    for (const bid of sewageComps.compMembers[sid]) {
      const b = byId.get(bid)!;
      if (!isSewageFacilityBuilding(b.type)) continue;
      const st = statusMap.get(b.id)!;
      const rated = BUILDING_DEFS[b.type]?.effects?.sewageCapacityM3 ?? 300;
      const effPower = b.type === BuildingType.SEWAGE_PUMP_STATION
        ? Math.max(0.25, st.powerRatio)
        : Math.max(0.15, st.powerRatio);
      if (st.powerRatio <= 0) {
        facilityNotes.set(b.id, 'Unpowered: running on emergency gravity bypass only');
      }
      cap += rated * effPower;
    }
    sewageSubnetCap.push(cap);
  }

  const sewageCoverage = new Int16Array(totalCells).fill(-1);
  const allSewerPipeCoverage = new Int16Array(totalCells).fill(-1);
  const preferMoreSewage = (cur: number, inc: number) => sewageSubnetCap[inc] > sewageSubnetCap[cur];

  for (let sid = 0; sid < sewageComps.compMembers.length; sid++) {
    const active = sewageSubnetCap[sid] > 0;
    for (const bid of sewageComps.compMembers[sid]) {
      const b = byId.get(bid)!;
      const radius = isSewageFacilityBuilding(b.type) ? SEWAGE_FACILITY_RADIUS : SEWAGE_PIPE_RADIUS;
      const { w, d } = effectiveFootprint(b.type, b.orientation);
      for (let dx = 0; dx < w; dx++) {
        for (let dz = 0; dz < d; dz++) {
          stampSquare(allSewerPipeCoverage, size, b.position.x + dx, b.position.z + dz, radius, sid);
          if (active) {
            stampSquare(sewageCoverage, size, b.position.x + dx, b.position.z + dz, radius, sid, preferMoreSewage);
          }
        }
      }
    }
  }

  for (let idx = 0; idx < totalCells; idx++) {
    if (sewageCoverage[idx] !== -1) cellFlags[idx] |= CELL_FLAG_SEWAGE;
  }

  const sewageSubnetConsumers: Array<Array<{ b: PlacedBuilding; profile: UtilityResourceProfile }>> =
    Array.from({ length: sewageComps.compMembers.length }, () => []);

  for (const b of state.buildings) {
    const profile = profiles.get(b.id)!;
    if (profile.sewageOutputM3 <= 0) continue;
    const { w, d } = effectiveFootprint(b.type, b.orientation);
    let bestSubnet = -1;
    let disconnectedPipeNearby = false;
    for (let dx = 0; dx < w; dx++) {
      for (let dz = 0; dz < d; dz++) {
        const cx = b.position.x + dx, cz = b.position.z + dz;
        if (cx < 0 || cx >= size || cz < 0 || cz >= size) continue;
        const sid = sewageCoverage[cx * size + cz];
        if (sid !== -1 && (bestSubnet === -1 || sewageSubnetCap[sid] > sewageSubnetCap[bestSubnet])) {
          bestSubnet = sid;
        }
        if (allSewerPipeCoverage[cx * size + cz] !== -1) disconnectedPipeNearby = true;
      }
    }
    if (bestSubnet !== -1) {
      sewageSubnetConsumers[bestSubnet].push({ b, profile });
    } else if (disconnectedPipeNearby) {
      statusMap.get(b.id)!.sewageState = 'disconnected_pipe';
    }
  }

  const sewageSubnetBackedUp = new Set<number>();
  for (let sid = 0; sid < sewageComps.compMembers.length; sid++) {
    const cap = sewageSubnetCap[sid];
    if (cap <= 0) continue;
    const consumers = sewageSubnetConsumers[sid];
    consumers.sort((a, b) => a.profile.priority - b.profile.priority);
    const load = consumers.reduce((s, c) => s + c.profile.sewageOutputM3, 0);
    if (load > cap + 1e-6) sewageSubnetBackedUp.add(sid);

    let used = 0;
    for (const { b, profile } of consumers) {
      const st = statusMap.get(b.id)!;
      used += profile.sewageOutputM3;
      if (used <= cap + 1e-6) {
        st.sewageRatio = 1;
        st.drained = true;
        st.sewageState = 'drained';
      } else if (used <= cap * 1.3) {
        st.sewageRatio = Math.max(0.3, Math.round((cap / load) * 100) / 100);
        st.drained = false;
        st.sewageState = 'backed_up';
      } else {
        st.sewageRatio = 0;
        st.drained = false;
        st.sewageState = 'backed_up';
      }
    }
  }

  const sewagePipeState = new Map<string, 'draining' | 'backed_up' | 'disconnected'>();
  for (const [bid, sid] of sewageComps.compOfBuilding) {
    if (sewageSubnetCap[sid] <= 0) sewagePipeState.set(bid, 'disconnected');
    else if (sewageSubnetBackedUp.has(sid)) sewagePipeState.set(bid, 'backed_up');
    else sewagePipeState.set(bid, 'draining');
  }

  // ── Compute Composite Building Efficiency & Citywide Summary ──
  let totalPowerDemand = 0;
  let totalWaterDemand = 0;
  let totalSewageDemand = 0;
  let poweredBuildings = 0;
  let unpoweredBuildings = 0;
  let brownoutBuildings = 0;
  let wateredBuildings = 0;
  let unwateredBuildings = 0;
  let drainedBuildings = 0;
  let backedUpBuildings = 0;

  for (const b of state.buildings) {
    const profile = profiles.get(b.id)!;
    const st = statusMap.get(b.id)!;
    totalPowerDemand += profile.powerDemandMW;
    totalWaterDemand += profile.waterDemandM3;
    totalSewageDemand += profile.sewageOutputM3;

    // Composite operating efficiency for civic buildings & workplaces
    const pFactor = profile.powerDemandMW > 0 ? (0.15 + 0.85 * st.powerRatio) : 1;
    const wFactor = profile.waterDemandM3 > 0 ? (0.60 + 0.40 * st.waterRatio) : 1;
    const sFactor = profile.sewageOutputM3 > 0 ? (0.75 + 0.25 * st.sewageRatio) : 1;
    st.efficiency = Math.round(pFactor * wFactor * sFactor * 100) / 100;

    if (profile.countedConsumer) {
      if (st.powered) {
        poweredBuildings++;
        if (st.powerState === 'brownout') brownoutBuildings++;
      } else {
        unpoweredBuildings++;
      }

      if (profile.waterDemandM3 > 0) {
        if (st.watered) wateredBuildings++;
        else unwateredBuildings++;
      }

      if (profile.sewageOutputM3 > 0) {
        if (st.drained) drainedBuildings++;
        else backedUpBuildings++;
      }
    }
  }

  const totalGenMW = subgridGenMW.reduce((s, v) => s + v, 0);
  const totalWaterSupply = waterSubnetSupply.reduce((s, v) => s + v, 0);
  const totalSewageCap = sewageSubnetCap.reduce((s, v) => s + v, 0);

  const round1 = (n: number) => Math.round(n * 10) / 10;

  const summary: UtilitySummary = {
    powerGenerationMW: round1(totalGenMW),
    powerDemandMW: round1(totalPowerDemand),
    powerLoadPct: totalGenMW > 0 ? Math.round((totalPowerDemand / totalGenMW) * 100) : (totalPowerDemand > 0 ? 100 : 0),
    poweredBuildings,
    unpoweredBuildings,
    brownoutBuildings,
    powerSubgrids: subgrids.filter(g => g.generationMW > 0).length,

    waterSupplyM3: Math.round(totalWaterSupply),
    waterDemandM3: Math.round(totalWaterDemand),
    waterLoadPct: totalWaterSupply > 0 ? Math.round((totalWaterDemand / totalWaterSupply) * 100) : (totalWaterDemand > 0 ? 100 : 0),
    wateredBuildings,
    unwateredBuildings,
    activeWaterSources,

    sewageCapacityM3: Math.round(totalSewageCap),
    sewageDemandM3: Math.round(totalSewageDemand),
    sewageLoadPct: totalSewageCap > 0 ? Math.round((totalSewageDemand / totalSewageCap) * 100) : (totalSewageDemand > 0 ? 100 : 0),
    drainedBuildings,
    backedUpBuildings,
  };

  return {
    gridSize: size,
    summary,
    subgrids,
    buildings: statusMap,
    powerLineState,
    waterPipeState,
    sewagePipeState,
    facilityNotes,
    cellFlags,
    waterRichness,
  };
}

/** Quick cell coverage lookup from a computed `UtilityGridReport`. */
export function getCellUtilityCoverage(report: UtilityGridReport, x: number, z: number): {
  power: boolean;
  water: boolean;
  sewage: boolean;
  waterSource: boolean;
} {
  if (x < 0 || z < 0 || x >= report.gridSize || z >= report.gridSize) {
    return { power: false, water: false, sewage: false, waterSource: false };
  }
  const flags = report.cellFlags[x * report.gridSize + z];
  return {
    power: (flags & CELL_FLAG_POWER) !== 0,
    water: (flags & CELL_FLAG_WATER) !== 0,
    sewage: (flags & CELL_FLAG_SEWAGE) !== 0,
    waterSource: (flags & CELL_FLAG_WATER_SOURCE) !== 0,
  };
}

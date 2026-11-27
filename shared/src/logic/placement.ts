import type { Grid, GridCell, Position, UtilityLayer } from '../types/grid.js';
import type { ResourceState } from '../types/resources.js';
import type { PlacedBuilding } from '../types/building.js';
import {
  BuildingType,
  type RoadOrientation,
  type ZoneDensity,
  getBuildingUtilityLayer,
  isRoad,
  isUtilityConduit,
  isWaterfront,
  isZone,
} from '../types/building.js';
import { BUILDING_DEFS, ROAD_GRADING_COST, ROAD_GRADING_MARGIN, ZONE_DENSITY_COSTS } from '../constants/buildings.js';
import { DEFAULT_GRID_SIZE } from '../constants/grid.js';
import { hasWaterSourceInFootprint } from './utilities.js';

export type WaterfrontFacing = 'N' | 'S' | 'E' | 'W';

export function getEffectiveSize(
  type: BuildingType,
  orientation?: RoadOrientation,
): { w: number; d: number } {
  const def = BUILDING_DEFS[type];
  if (!orientation || orientation === 'EW') {
    return { w: def.size.w, d: def.size.d };
  }
  return { w: def.size.d, d: def.size.w };
}

/**
 * Steep-slope cells a road placement will grade flat: the road's own footprint
 * plus `ROAD_GRADING_MARGIN` tile(s) around it so fronting lots can be zoned.
 * Water cells are never leveled.
 */
export function getRoadGradingCells(
  grid: Grid,
  pos: Position,
  type: BuildingType,
  orientation?: RoadOrientation,
): Position[] {
  if (!isRoad(type)) return [];
  const { w, d } = getEffectiveSize(type, orientation);
  const cells: Position[] = [];
  const sizeX = grid.length;
  for (let dx = -ROAD_GRADING_MARGIN; dx < w + ROAD_GRADING_MARGIN; dx++) {
    const cx = pos.x + dx;
    if (cx < 0 || cx >= sizeX) continue;
    const col = grid[cx];
    const sizeZ = col.length;
    for (let dz = -ROAD_GRADING_MARGIN; dz < d + ROAD_GRADING_MARGIN; dz++) {
      const cz = pos.z + dz;
      if (cz < 0 || cz >= sizeZ) continue;
      if (col[cz]?.terrain === 'steep') {
        cells.push({ x: cx, z: cz });
      }
    }
  }
  return cells;
}

/**
 * Levels steep terrain along a road's footprint and 1-tile shoulders.
 * Returns the number of steep cells that were leveled.
 */
export function levelRoadTerrain(
  grid: Grid,
  pos: Position,
  type: BuildingType,
  orientation?: RoadOrientation,
): number {
  const cells = getRoadGradingCells(grid, pos, type, orientation);
  for (const { x, z } of cells) {
    delete grid[x][z].terrain;
  }
  return cells.length;
}

export interface PlacementCostQuote {
  baseCost: number;
  gradingCost: number;
  totalCost: number;
  gradedCells: Position[];
}

/**
 * Computes the cost of placing one building/segment, including earthwork fees
 * for any steep cells leveled by a road (excluding cells in `alreadyLeveled`
 * when quoting a multi-segment drag stroke).
 */
export function getPlacementCost(
  grid: Grid,
  pos: Position,
  type: BuildingType,
  density?: ZoneDensity,
  orientation?: RoadOrientation,
  alreadyLeveled?: ReadonlySet<string>,
): PlacementCostQuote {
  const def = BUILDING_DEFS[type];
  const baseCost = isZone(type) && density ? ZONE_DENSITY_COSTS[density] : def.cost;
  const gradedCells = getRoadGradingCells(grid, pos, type, orientation).filter(
    c => !alreadyLeveled?.has(`${c.x},${c.z}`),
  );
  const gradingCost = gradedCells.length * ROAD_GRADING_COST;
  return {
    baseCost,
    gradingCost,
    totalCost: baseCost + gradingCost,
    gradedCells,
  };
}

/** Types that may be dropped onto existing roads, replacing them (e.g. a roundabout on a crossing). */
export function replacesRoads(type: BuildingType): boolean {
  return type === BuildingType.ROAD_ROUNDABOUT;
}

/**
 * Whether placing `type` may clear an existing `occupant` out of the way:
 * a roundabout replaces plain roads, and any non-zone building (roads, parks,
 * parking, services) may be built over zoned tiles (the zone, and whatever
 * grew on it, is removed).
 */
export function canReplace(type: BuildingType, occupant: BuildingType): boolean {
  if (isZone(occupant) && !isZone(type)) return true;
  if (replacesRoads(type)) return isRoad(occupant) && !replacesRoads(occupant);
  return false;
}

/** Existing buildings (roads under a roundabout, zones under a road or service building) a placement would replace. */
export function getReplacedBuildings(
  grid: Grid,
  pos: Position,
  type: BuildingType,
  buildings: PlacedBuilding[],
  orientation?: RoadOrientation,
): PlacedBuilding[] {
  if (isZone(type) || isUtilityConduit(type)) return [];
  const { w, d } = getEffectiveSize(type, orientation);
  const ids = new Set<string>();
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      const id = grid[pos.x + dx]?.[pos.z + dz]?.buildingId;
      if (id) ids.add(id);
    }
  }
  return buildings.filter(b => ids.has(b.id) && canReplace(type, b.type));
}

export const getReplacedRoads = getReplacedBuildings;

function getConduitCellId(cell: GridCell, type: BuildingType): string | null {
  if (type === BuildingType.UTILITY_POWER_LINE) return cell.powerLineId ?? null;
  if (type === BuildingType.UTILITY_WATER_PIPE) return cell.waterPipeId ?? null;
  if (type === BuildingType.UTILITY_SEWAGE_PIPE) return cell.sewagePipeId ?? null;
  return cell.buildingId;
}

/** Registers a placed building or utility conduit onto the appropriate layer slot(s) of `grid`. */
export function setGridBuilding(grid: Grid, building: PlacedBuilding): void {
  const { x, z } = building.position;
  if (building.type === BuildingType.UTILITY_POWER_LINE) {
    if (grid[x]?.[z]) grid[x][z].powerLineId = building.id;
    return;
  }
  if (building.type === BuildingType.UTILITY_WATER_PIPE) {
    if (grid[x]?.[z]) grid[x][z].waterPipeId = building.id;
    return;
  }
  if (building.type === BuildingType.UTILITY_SEWAGE_PIPE) {
    if (grid[x]?.[z]) grid[x][z].sewagePipeId = building.id;
    return;
  }
  const { w, d } = getEffectiveSize(building.type, building.orientation);
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      const cell = grid[x + dx]?.[z + dz];
      if (cell) cell.buildingId = building.id;
    }
  }
}

/** Clears a building or utility conduit from its layer slot(s) in `grid`. */
export function clearGridBuilding(grid: Grid, building: PlacedBuilding): void {
  const { x, z } = building.position;
  if (building.type === BuildingType.UTILITY_POWER_LINE) {
    if (grid[x]?.[z]?.powerLineId === building.id) grid[x][z].powerLineId = null;
    return;
  }
  if (building.type === BuildingType.UTILITY_WATER_PIPE) {
    if (grid[x]?.[z]?.waterPipeId === building.id) grid[x][z].waterPipeId = null;
    return;
  }
  if (building.type === BuildingType.UTILITY_SEWAGE_PIPE) {
    if (grid[x]?.[z]?.sewagePipeId === building.id) grid[x][z].sewagePipeId = null;
    return;
  }
  const { w, d } = getEffectiveSize(building.type, building.orientation);
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      const cell = grid[x + dx]?.[z + dz];
      if (cell && cell.buildingId === building.id) cell.buildingId = null;
    }
  }
}

/**
 * Resolves which building at `position` should be demolished given the active editor `layer`.
 * Dedicated utility layers target their own conduit first, then matching utility buildings,
 * without accidentally bulldozing surface roads, zones, or buildings above underground pipes.
 */
export function findGridBuildingToDemolish(
  grid: Grid,
  buildings: readonly PlacedBuilding[],
  position: Position,
  layer: UtilityLayer = 'surface',
): PlacedBuilding | undefined {
  const cell = grid[position.x]?.[position.z];
  if (!cell) return undefined;

  const byId = (id: string | null | undefined) => (id ? buildings.find(b => b.id === id) : undefined);

  if (layer === 'water') {
    const pipe = byId(cell.waterPipeId);
    if (pipe) return pipe;
    const surface = byId(cell.buildingId);
    return surface && getBuildingUtilityLayer(surface.type) === 'water' ? surface : undefined;
  }
  if (layer === 'sewage') {
    const pipe = byId(cell.sewagePipeId);
    if (pipe) return pipe;
    const surface = byId(cell.buildingId);
    return surface && getBuildingUtilityLayer(surface.type) === 'sewage' ? surface : undefined;
  }
  if (layer === 'power') {
    const line = byId(cell.powerLineId);
    if (line) return line;
    const surface = byId(cell.buildingId);
    return surface && getBuildingUtilityLayer(surface.type) === 'power' ? surface : undefined;
  }

  // Surface mode: surface building first, or exposed overhead power line on empty ground
  return byId(cell.buildingId) ?? byId(cell.powerLineId);
}

export interface PlacementResult {
  valid: boolean;
  reason?: string;
}

/**
 * Determines which cardinal direction ('N' = -z, 'S' = +z, 'W' = -x, 'E' = +x)
 * a waterfront building faces toward open water, or null if the footprint does
 * not sit on a valid shoreline.
 */
export function getWaterfrontFacing(
  grid: Grid,
  pos: Position,
  type: BuildingType,
  orientation?: RoadOrientation,
  ignoreWaterOccupants = false,
): WaterfrontFacing | null {
  const def = BUILDING_DEFS[type];
  const { w, d } = getEffectiveSize(type, orientation);
  const sizeX = grid.length;
  const sizeZ = grid[0]?.length ?? DEFAULT_GRID_SIZE;
  if (pos.x < 0 || pos.z < 0 || pos.x + w > sizeX || pos.z + d > sizeZ) return null;

  const candidates: WaterfrontFacing[] = orientation === 'NS'
    ? ['W', 'E']
    : orientation === 'EW'
      ? ['N', 'S']
      : def.size.w === def.size.d
        ? ['N', 'S', 'W', 'E']
        : ['N', 'S'];

  const cellAt = (x: number, z: number) =>
    x >= 0 && x < sizeX && z >= 0 && z < sizeZ ? grid[x][z] : undefined;

  let bestFacing: WaterfrontFacing | null = null;
  let bestScore = -Infinity;

  for (const facing of candidates) {
    const ns = facing === 'N' || facing === 'S';
    const span = ns ? w : d;
    let openWater = 0;
    let waterEdge = 0;
    let frontWater = 0;
    let backWater = 0;
    let shoreBuildable = 0;

    for (let i = 0; i < span; i++) {
      const outsideWater = facing === 'N'
        ? cellAt(pos.x + i, pos.z - 1)
        : facing === 'S'
          ? cellAt(pos.x + i, pos.z + d)
          : facing === 'W'
            ? cellAt(pos.x - 1, pos.z + i)
            : cellAt(pos.x + w, pos.z + i);

      const frontInner = facing === 'N'
        ? cellAt(pos.x + i, pos.z)
        : facing === 'S'
          ? cellAt(pos.x + i, pos.z + d - 1)
          : facing === 'W'
            ? cellAt(pos.x, pos.z + i)
            : cellAt(pos.x + w - 1, pos.z + i);

      const backInner = facing === 'N'
        ? cellAt(pos.x + i, pos.z + d - 1)
        : facing === 'S'
          ? cellAt(pos.x + i, pos.z)
          : facing === 'W'
            ? cellAt(pos.x + w - 1, pos.z + i)
            : cellAt(pos.x, pos.z + i);

      const outsideShore = facing === 'N'
        ? cellAt(pos.x + i, pos.z + d)
        : facing === 'S'
          ? cellAt(pos.x + i, pos.z - 1)
          : facing === 'W'
            ? cellAt(pos.x + w, pos.z + i)
            : cellAt(pos.x - 1, pos.z + i);

      if (outsideWater?.terrain === 'water') {
        waterEdge++;
        frontWater++;
        if (ignoreWaterOccupants || outsideWater.buildingId === null) openWater++;
      }
      if (frontInner?.terrain === 'water') frontWater++;
      if (backInner?.terrain === 'water') backWater++;
      if (outsideShore?.terrain === 'water') backWater++;

      const innerLand = backInner && backInner.terrain !== 'water' && backInner.terrain !== 'steep';
      const outerLand = outsideShore && outsideShore.terrain !== 'water' && outsideShore.terrain !== 'steep';
      if (innerLand || outerLand) shoreBuildable++;
    }

    const gradient = frontWater - backWater;
    if (openWater < 1 || waterEdge < Math.ceil(span / 2) || shoreBuildable < 1 || gradient <= 0) {
      continue;
    }

    const score = gradient * 10 + openWater;
    if (score > bestScore) {
      bestScore = score;
      bestFacing = facing;
    }
  }

  return bestFacing;
}

/**
 * Picks the orientation ('EW' or 'NS') that lets a waterfront building align
 * cleanly with the shoreline at `pos`, preferring `preferred` when valid.
 */
export function resolveWaterfrontOrientation(
  grid: Grid,
  pos: Position,
  type: BuildingType,
  buildings?: PlacedBuilding[],
  preferred: RoadOrientation = 'EW',
): RoadOrientation {
  const alt: RoadOrientation = preferred === 'EW' ? 'NS' : 'EW';
  const dummyRes: ResourceState = {
    money: 1e9, population: 0, happiness: 50, taxRate: 10,
    demand: { residential: 0, commercial: 0, industrial: 0 },
  };
  if (canPlaceBuilding(grid, pos, type, dummyRes, true, buildings, undefined, preferred).valid
    && getWaterfrontFacing(grid, pos, type, preferred)) {
    return preferred;
  }
  if (canPlaceBuilding(grid, pos, type, dummyRes, true, buildings, undefined, alt).valid
    && getWaterfrontFacing(grid, pos, type, alt)) {
    return alt;
  }
  if (getWaterfrontFacing(grid, pos, type, preferred)) return preferred;
  if (getWaterfrontFacing(grid, pos, type, alt)) return alt;
  return preferred;
}

function classifyWaterfrontFailure(grid: Grid, pos: Position, w: number, d: number): string {
  const sizeX = grid.length;
  const sizeZ = grid[0]?.length ?? DEFAULT_GRID_SIZE;
  let hasWater = false;
  let hasLand = false;
  for (let dx = -1; dx <= w; dx++) {
    for (let dz = -1; dz <= d; dz++) {
      const cx = pos.x + dx;
      const cz = pos.z + dz;
      if (cx < 0 || cx >= sizeX || cz < 0 || cz >= sizeZ) continue;
      if ((dx === -1 || dx === w) && (dz === -1 || dz === d)) continue;
      const t = grid[cx][cz].terrain;
      if (t === 'water') hasWater = true;
      else if (t !== 'steep') hasLand = true;
    }
  }
  if (!hasWater) return 'Must be placed on waterfront';
  if (!hasLand) return 'Must connect to shore';
  return 'Needs open water access';
}

export function canPlaceBuilding(
  grid: Grid,
  pos: Position,
  type: BuildingType,
  resources: ResourceState,
  unlimitedMoney = false,
  buildings?: PlacedBuilding[],
  density?: ZoneDensity,
  orientation?: RoadOrientation,
): PlacementResult {
  const conduit = isUtilityConduit(type);
  if (conduit) {
    const sizeX = grid.length;
    const sizeZ = grid[0]?.length ?? DEFAULT_GRID_SIZE;
    if (pos.x < 0 || pos.x >= sizeX || pos.z < 0 || pos.z >= sizeZ) {
      return { valid: false, reason: 'Out of bounds' };
    }
    const cell = grid[pos.x][pos.z];
    if (cell.terrain === 'water') {
      return { valid: false, reason: 'Open water' };
    }
    if (getConduitCellId(cell, type) !== null) {
      return { valid: false, reason: 'Cell occupied' };
    }
    const { totalCost } = getPlacementCost(grid, pos, type, density, orientation);
    if (!unlimitedMoney && resources.money < totalCost) {
      return { valid: false, reason: 'Not enough money' };
    }
    return { valid: true };
  }

  const waterfront = isWaterfront(type);
  const resolvedOrientation = waterfront && !orientation
    ? (getWaterfrontFacing(grid, pos, type, 'EW') ? 'EW' : getWaterfrontFacing(grid, pos, type, 'NS') ? 'NS' : undefined)
    : orientation;
  const { w, d } = getEffectiveSize(type, resolvedOrientation);
  const road = isRoad(type);
  const canStraddleShore = waterfront || type === BuildingType.TRANS_HARBOR;
  let hasWaterInFootprint = false;

  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      const cx = pos.x + dx;
      const cz = pos.z + dz;

      if (cx < 0 || cx >= DEFAULT_GRID_SIZE || cz < 0 || cz >= DEFAULT_GRID_SIZE) {
        return { valid: false, reason: 'Out of bounds' };
      }

      const terrain = grid[cx][cz].terrain;
      if (terrain === 'water') {
        if (!canStraddleShore) return { valid: false, reason: 'Open water' };
        hasWaterInFootprint = true;
      }
      if (terrain === 'steep' && !road) return { valid: false, reason: 'Slope too steep' };

      const occupantId = grid[cx][cz].buildingId;
      if (occupantId !== null) {
        const occupant = !isZone(type) ? buildings?.find(b => b.id === occupantId) : undefined;
        if (!occupant || !canReplace(type, occupant.type)) {
          return { valid: false, reason: 'Cell occupied' };
        }
      }
    }
  }

  if (waterfront || (type === BuildingType.TRANS_HARBOR && hasWaterInFootprint)) {
    const facing = getWaterfrontFacing(grid, pos, type, resolvedOrientation);
    if (!facing) {
      return { valid: false, reason: classifyWaterfrontFailure(grid, pos, w, d) };
    }
  }

  if (BUILDING_DEFS[type]?.effects?.requiresWaterSource) {
    if (!hasWaterSourceInFootprint(grid, pos, w, d)) {
      return { valid: false, reason: 'Requires a water source (coastline or aquifer — open Water layer)' };
    }
  }

  const { totalCost } = getPlacementCost(grid, pos, type, density, resolvedOrientation);
  if (!unlimitedMoney && resources.money < totalCost) {
    return { valid: false, reason: 'Not enough money' };
  }

  return { valid: true };
}

export function createEmptyGrid(size: number = DEFAULT_GRID_SIZE): Grid {
  const grid: Grid = [];
  for (let x = 0; x < size; x++) {
    grid[x] = [];
    for (let z = 0; z < size; z++) {
      grid[x][z] = { buildingId: null };
    }
  }
  return grid;
}

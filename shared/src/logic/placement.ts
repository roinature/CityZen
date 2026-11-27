import type { Grid, Position } from '../types/grid.js';
import type { ResourceState } from '../types/resources.js';
import type { PlacedBuilding } from '../types/building.js';
import { BuildingType, type RoadOrientation, type ZoneDensity, isRoad, isZone } from '../types/building.js';
import { BUILDING_DEFS, ROAD_GRADING_COST, ROAD_GRADING_MARGIN, ZONE_DENSITY_COSTS } from '../constants/buildings.js';
import { DEFAULT_GRID_SIZE } from '../constants/grid.js';

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
  if (isZone(type)) return [];
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

export interface PlacementResult {
  valid: boolean;
  reason?: string;
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
  const { w, d } = getEffectiveSize(type, orientation);
  const road = isRoad(type);
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      const cx = pos.x + dx;
      const cz = pos.z + dz;

      if (cx < 0 || cx >= DEFAULT_GRID_SIZE || cz < 0 || cz >= DEFAULT_GRID_SIZE) {
        return { valid: false, reason: 'Out of bounds' };
      }

      const terrain = grid[cx][cz].terrain;
      if (terrain === 'water') return { valid: false, reason: 'Open water' };
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

  const { totalCost } = getPlacementCost(grid, pos, type, density, orientation);
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

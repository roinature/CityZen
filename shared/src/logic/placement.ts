import type { Grid, Position } from '../types/grid.js';
import type { ResourceState } from '../types/resources.js';
import type { PlacedBuilding } from '../types/building.js';
import { BuildingType, type RoadOrientation, type ZoneDensity, isZone } from '../types/building.js';
import { BUILDING_DEFS, ZONE_DENSITY_COSTS } from '../constants/buildings.js';
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
  const def = BUILDING_DEFS[type];
  const cost = isZone(type) && density ? ZONE_DENSITY_COSTS[density] : def.cost;

  if (!unlimitedMoney && resources.money < cost) {
    return { valid: false, reason: 'Not enough money' };
  }

  const { w, d } = getEffectiveSize(type, orientation);
  for (let dx = 0; dx < w; dx++) {
    for (let dz = 0; dz < d; dz++) {
      const cx = pos.x + dx;
      const cz = pos.z + dz;

      if (cx < 0 || cx >= DEFAULT_GRID_SIZE || cz < 0 || cz >= DEFAULT_GRID_SIZE) {
        return { valid: false, reason: 'Out of bounds' };
      }

      if (grid[cx][cz].buildingId !== null) {
        return { valid: false, reason: 'Cell occupied' };
      }
    }
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

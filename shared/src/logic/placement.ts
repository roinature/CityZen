import type { Grid, Position } from '../types/grid.js';
import type { ResourceState } from '../types/resources.js';
import type { PlacedBuilding } from '../types/building.js';
import { BuildingType, type ZoneDensity, isZone } from '../types/building.js';
import { BUILDING_DEFS, ZONE_DENSITY_COSTS } from '../constants/buildings.js';
import { DEFAULT_GRID_SIZE } from '../constants/grid.js';

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
): PlacementResult {
  const def = BUILDING_DEFS[type];
  const cost = isZone(type) && density ? ZONE_DENSITY_COSTS[density] : def.cost;

  if (!unlimitedMoney && resources.money < cost) {
    return { valid: false, reason: 'Not enough money' };
  }

  for (let dx = 0; dx < def.size.w; dx++) {
    for (let dz = 0; dz < def.size.d; dz++) {
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

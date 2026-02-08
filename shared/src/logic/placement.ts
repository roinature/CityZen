import type { Grid, Position } from '../types/grid.js';
import type { ResourceState } from '../types/resources.js';
import type { PlacedBuilding } from '../types/building.js';
import { BuildingType, isZone, isRoad } from '../types/building.js';
import { BUILDING_DEFS } from '../constants/buildings.js';
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
): PlacementResult {
  const def = BUILDING_DEFS[type];

  if (!unlimitedMoney && resources.money < def.cost) {
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

  // Zones must be adjacent to a road or another zone
  if (isZone(type) && buildings) {
    if (!hasAdjacentRoadOrZone(pos, def.size, buildings)) {
      return { valid: false, reason: 'Zone must be adjacent to a road or zone' };
    }
  }

  return { valid: true };
}

function hasAdjacentRoadOrZone(
  pos: Position,
  size: { w: number; d: number },
  buildings: PlacedBuilding[],
): boolean {
  const validPositions = new Set<string>();
  for (const b of buildings) {
    if (isRoad(b.type) || isZone(b.type)) {
      const def = BUILDING_DEFS[b.type];
      for (let dx = 0; dx < def.size.w; dx++) {
        for (let dz = 0; dz < def.size.d; dz++) {
          validPositions.add(`${b.position.x + dx},${b.position.z + dz}`);
        }
      }
    }
  }

  for (let dx = 0; dx < size.w; dx++) {
    for (let dz = 0; dz < size.d; dz++) {
      const cx = pos.x + dx;
      const cz = pos.z + dz;
      const neighbors = [
        `${cx - 1},${cz}`,
        `${cx + 1},${cz}`,
        `${cx},${cz - 1}`,
        `${cx},${cz + 1}`,
      ];
      for (const n of neighbors) {
        if (validPositions.has(n)) return true;
      }
    }
  }

  return false;
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

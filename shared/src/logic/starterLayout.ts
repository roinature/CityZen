import { DEFAULT_GRID_SIZE } from '../constants/grid.js';
import { BuildingType, type PlacedBuilding } from '../types/building.js';
import { createEmptyGrid, levelRoadTerrain } from './placement.js';

import { applySiteTerrain } from '../terrain/sites.js';

export function getStarterEntranceX(gridSize: number): number {
  return Math.floor(gridSize * 0.56);
}

export function isStarterEntranceRoad(building: PlacedBuilding, gridSize: number): boolean {
  return building.type === BuildingType.ROAD_STREET
    && building.position.x === getStarterEntranceX(gridSize)
    && building.position.z === gridSize - 1;
}

export function createStarterLayout(cityId: string, ownerId: string, siteId?: string) {
  const grid = createEmptyGrid();
  applySiteTerrain(grid, siteId);
  const buildings: PlacedBuilding[] = [];
  const x = getStarterEntranceX(DEFAULT_GRID_SIZE);

  // Give the player a short street to extend into the open plot.
  for (let z = DEFAULT_GRID_SIZE - 9; z < DEFAULT_GRID_SIZE; z++) {
    const id = `${cityId}:starter-street:${z}`;
    buildings.push({
      id,
      type: BuildingType.ROAD_STREET,
      position: { x, z },
      placedBy: ownerId,
      placedAt: 0,
      orientation: 'NS',
    });
    levelRoadTerrain(grid, { x, z }, BuildingType.ROAD_STREET, 'NS');
    grid[x][z].buildingId = id;
  }

  return { grid, buildings };
}

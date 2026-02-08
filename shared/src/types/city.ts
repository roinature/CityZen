import type { Grid } from './grid.js';
import type { PlacedBuilding } from './building.js';
import type { ResourceState } from './resources.js';
import type { GameClock } from './time.js';

export interface CityState {
  id: string;
  name: string;
  ownerId: string;
  grid: Grid;
  buildings: PlacedBuilding[];
  resources: ResourceState;
  clock: GameClock;
  tick: number;
  createdAt: number;
  updatedAt: number;
}

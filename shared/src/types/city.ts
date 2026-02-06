import type { Grid } from './grid.js';
import type { PlacedBuilding } from './building.js';
import type { ResourceState } from './resources.js';

export interface CityState {
  id: string;
  name: string;
  grid: Grid;
  buildings: PlacedBuilding[];
  resources: ResourceState;
  tick: number;
  createdAt: number;
  updatedAt: number;
}

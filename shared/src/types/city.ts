import type { Grid } from './grid.js';
import type { PlacedBuilding } from './building.js';
import type { ResourceState } from './resources.js';
import type { GameClock } from './time.js';
import type { CityEmergency } from './emergencies.js';

export interface CityState {
  siteId?: string;
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
  /** Active city incidents awaiting or receiving emergency vehicle response. */
  emergencies?: CityEmergency[];
}

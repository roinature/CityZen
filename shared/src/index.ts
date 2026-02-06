// Types
export type { Position, GridCell, Grid } from './types/grid.js';
export { BuildingType } from './types/building.js';
export type { BuildingDef, BuildingEffects, PlacedBuilding } from './types/building.js';
export type { ResourceState } from './types/resources.js';
export type { CityState } from './types/city.js';
export type { Player } from './types/player.js';
export {
  C2S, S2C,
  type JoinCityPayload,
  type CreateCityPayload,
  type PlaceBuildingPayload,
  type DemolishPayload,
  type CityStatePayload,
  type BuildingPlacedPayload,
  type BuildingDemolishedPayload,
  type ErrorPayload,
  type CityListItem,
} from './types/events.js';

// Constants
export { DEFAULT_GRID_SIZE, CELL_SIZE } from './constants/grid.js';
export { TICK_INTERVAL_MS, INITIAL_RESOURCES, AUTO_SAVE_INTERVAL_MS } from './constants/simulation.js';
export { BUILDING_DEFS } from './constants/buildings.js';

// Logic
export { canPlaceBuilding, createEmptyGrid } from './logic/placement.js';
export { calculateIncome, calculatePopulationGrowth, calculateHappiness, clamp } from './logic/resources.js';
export { simulateTick } from './logic/simulation.js';

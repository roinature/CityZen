// Types
export type { Position, GridCell, Grid } from './types/grid.js';
export { BuildingType, isZone, isRoad, ZONE_TYPES, ROAD_TYPES } from './types/building.js';
export type { BuildingDef, BuildingEffects, PlacedBuilding, ZoneType, RoadType } from './types/building.js';
export type { ResourceState, DemandState } from './types/resources.js';
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
  type ZoneGrowthPayload,
  type ErrorPayload,
  type CityListItem,
  type SetTaxRatePayload,
  type SetUnlimitedMoneyPayload,
} from './types/events.js';

// Constants
export { DEFAULT_GRID_SIZE, CELL_SIZE } from './constants/grid.js';
export { TICK_INTERVAL_MS, INITIAL_RESOURCES, AUTO_SAVE_INTERVAL_MS, MIN_TAX_RATE, MAX_TAX_RATE, TAX_RATE_STEP, DEMAND_GROWTH_RATE, ZONE_GROWTH_CHANCE, MIN_DEMAND_TO_GROW } from './constants/simulation.js';
export { BUILDING_DEFS, ZONE_LEVELS } from './constants/buildings.js';
export type { ZoneLevelDef } from './constants/buildings.js';

// Logic
export { canPlaceBuilding, createEmptyGrid } from './logic/placement.js';
export { calculateTaxRevenue, calculateMaintenance, calculateNetIncome, calculatePopulationGrowth, calculateHappiness, clamp } from './logic/resources.js';
export { simulateTick } from './logic/simulation.js';
export { calculateDemand, processZoneGrowth } from './logic/demand.js';

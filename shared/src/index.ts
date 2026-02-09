// Types
export type { Position, GridCell, Grid } from './types/grid.js';
export { BuildingType, isZone, isRoad, ZONE_TYPES, ROAD_TYPES, INFRA_CATEGORIES } from './types/building.js';
export type { BuildingDef, BuildingEffects, PlacedBuilding, ZoneType, RoadType, InfraCategory } from './types/building.js';
export type { ResourceState, DemandState } from './types/resources.js';
export type { CityState } from './types/city.js';
export type { Player, PlayerProfile } from './types/player.js';
export type { GameClock } from './types/time.js';
export type { WorldState, WorldCityEntry, WorldPosition, EdgeDirection, EdgeConnection } from './types/world.js';
export {
  C2S, S2C,
  type JoinCityPayload,
  type CreateCityPayload,
  type ClaimPlotPayload,
  type PlaceBuildingPayload,
  type DemolishPayload,
  type CityStatePayload,
  type WorldStatePayload,
  type BuildingPlacedPayload,
  type BuildingDemolishedPayload,
  type ResourcesUpdatePayload,
  type ZoneGrowthPayload,
  type ErrorPayload,
  type CityListItem,
  type SetTaxRatePayload,
  type SetUnlimitedMoneyPayload,
  type SetGameSpeedPayload,
} from './types/events.js';

// Constants
export { DEFAULT_GRID_SIZE, CELL_SIZE } from './constants/grid.js';
export {
  TICK_INTERVAL_MS, INITIAL_RESOURCES, AUTO_SAVE_INTERVAL_MS,
  MIN_TAX_RATE, MAX_TAX_RATE, TAX_RATE_STEP,
  DEMAND_GROWTH_RATE, ZONE_GROWTH_CHANCE, MIN_DEMAND_TO_GROW,
  GAME_MS_PER_TICK, TICKS_PER_GAME_DAY, DAYS_PER_GAME_YEAR,
  DEFAULT_GAME_SPEED, MAX_GAME_SPEED,
} from './constants/simulation.js';
export { WORLD_MAP_SIZE, DEFAULT_WORLD_NAME } from './constants/world.js';
export { BUILDING_DEFS, ZONE_LEVELS } from './constants/buildings.js';
export type { ZoneLevelDef } from './constants/buildings.js';

// Logic
export { canPlaceBuilding, createEmptyGrid } from './logic/placement.js';
export { calculateTaxRevenue, calculateMaintenance, calculateNetIncome, calculatePopulationGrowth, calculateHappiness, clamp, calculateCityScore } from './logic/resources.js';
export { simulateTick, advanceClock } from './logic/simulation.js';
export { calculateDemand, processZoneGrowth } from './logic/demand.js';
export {
  calculateEdgeConnections,
  getOppositeDirection,
  getNeighborDirection,
  findMatchingConnections,
  findAdjacentCity
} from './logic/edgeConnections.js';

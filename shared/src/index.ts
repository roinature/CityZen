// Types
export type { Position, GridCell, Grid, UtilityLayer } from './types/grid.js';
export {
  BuildingType, ZoneDensity, isZone, isRoad, isUtilityConduit, getBuildingUtilityLayer, isWaterfront, canDockBoats,
  ZONE_TYPES, ROAD_TYPES, UTILITY_CONDUIT_TYPES,
  INFRA_CATEGORIES, INFRA_ART_TYPES, INFRA_WATERFRONT_TYPES,
  INFRA_ENERGY_TYPES, INFRA_WATER_TYPES, INFRA_SEWAGE_TYPES,
  INFRA_POLICE_TYPES, INFRA_FIRE_TYPES,
  INFRA_HEALTH_TYPES, INFRA_EDU_TYPES,
  INFRA_GOV_TYPES, INFRA_TOUR_TYPES,
  INFRA_TRANS_TYPES,
} from './types/building.js';
export type {
  BuildingDef, BuildingEffects, MaslowContribution, PlacedBuilding,
  ZoneType, RoadType, UtilityConduitType, WaterfrontType, RoadOrientation, InfraCategory,
} from './types/building.js';
export type { ResourceState, DemandState, PopulationSummary, ZonePopulationEntry, Loan, UtilitySummary } from './types/resources.js';
export type { CityState } from './types/city.js';
export type { CityEmergency, CityEmergencyKind, CityEmergencyOutcome } from './types/emergencies.js';
export type { Player, PlayerProfile } from './types/player.js';
export type { GameClock } from './types/time.js';
export type { WorldState, WorldCityEntry, WorldPosition, EdgeDirection, EdgeConnection } from './types/world.js';

// Person & Maslow
export {
  LifeStage, LIFE_STAGE_AGE_RANGES, getLifeStage,
  MaslowNeed, MASLOW_NEEDS_ORDERED,
  createDefaultMaslow, getPersonHappiness,
} from './types/person.js';
export type { MaslowState, Person } from './types/person.js';

// Messages
export {
  MessageType, MessageCategory, MessagePriority, DisplayType,
} from './types/messages.js';
export type { GameMessage, MessageTemplate, MessageCondition, MessageContext, MessageState } from './types/messages.js';

// Events
export {
  C2S, S2C,
  type JoinCityPayload,
  type CreateCityPayload,
  type ClaimPlotPayload,
  type PlaceBuildingPayload,
  type PlaceBuildingsPayload,
  type DemolishPayload,
  type CityStatePayload,
  type WorldStatePayload,
  type BuildingPlacedPayload,
  type BuildingsPlacedPayload,
  type BuildingDemolishedPayload,
  type ResourcesUpdatePayload,
  type ZoneGrowthPayload,
  type ErrorPayload,
  type CityListItem,
  type SetTaxRatePayload,
  type SetUnlimitedMoneyPayload,
  type SetGameSpeedPayload,
  type PopulationUpdatePayload,
  type MigrationEventPayload,
  type WorldTickPayload,
  type EmergencyStartedPayload,
  type EmergencyRespondingPayload,
  type EmergencyOutcomePayload,
} from './types/events.js';

// Constants
export { DEFAULT_GRID_SIZE, CELL_SIZE } from './constants/grid.js';
export {
  TICK_INTERVAL_MS, INITIAL_RESOURCES, AUTO_SAVE_INTERVAL_MS,
  MIN_TAX_RATE, MAX_TAX_RATE, TAX_RATE_STEP,
  DEMAND_GROWTH_RATE, ZONE_GROWTH_MIN_CHANCE, ZONE_GROWTH_CHANCE, MIN_DEMAND_TO_GROW,
  COMMERCIAL_JOBS_PER_WORKER, INDUSTRIAL_JOBS_PER_WORKER, MIN_JOBS_WANTED,
  HOUSING_BUFFER_RATIO, HOUSING_BUFFER_MIN,
  ZONE_LEVEL_MIN_HAPPINESS, DEMAND_UNHAPPY_BELOW,
  SERVICE_BASE_SATISFACTION, SERVICE_QUALITY_FACTOR,
  SMALL_TOWN_SATISFACTION, SMALL_TOWN_POPULATION, SMALL_TOWN_FADE_POPULATION,
  IMMIGRATION_RATE, IMMIGRATION_MAX_PER_TICK, IMMIGRATION_MIN_ATTRACTIVENESS,
  EMIGRATION_HAPPINESS_THRESHOLD, EMIGRATION_MAX_RATE,
  WORLD_POOL_RESERVE, WORLD_POOL_RESERVE_PER_CITY, WORLD_POOL_GROWTH_PER_CITY,
  GAME_MS_PER_TICK, TICKS_PER_GAME_DAY, DAYS_PER_GAME_YEAR,
  DEFAULT_GAME_SPEED, MAX_GAME_SPEED,
  BIRTH_RATE_PER_YEAR, ELDER_MORTALITY_BASE_AGE, ELDER_MORTALITY_RATE_PER_YEAR,
  MAX_PERSON_AGE, LOW_PHYSIO_DEATH_MULTIPLIER, INITIAL_CITY_SEED,
  MASLOW_LERP_RATE,
  MIGRATION_HAPPINESS_THRESHOLD, MIGRATION_HAPPINESS_DELTA, MIGRATION_MAX_RATE,
} from './constants/simulation.js';
export { WORLD_MAP_SIZE, DEFAULT_WORLD_NAME } from './constants/world.js';
export {
  TAX_PER_PERSON, DEFICIT_MASLOW_PENALTY_RATE, MIN_BUDGET_MULTIPLIER,
  MAX_DEBT, TAX_COMFORT_RATE, TAX_MASLOW_PENALTY_PER_POINT,
  TAX_PER_PERSON_FALLBACK, WORKFORCE_PARTICIPATION, WORKFORCE_SHARE_FALLBACK,
  COMMUTER_JOBS, UNEMPLOYED_INCOME_SHARE, BUSINESS_INCOME_PER_JOB,
} from './constants/economy.js';
export { calculateImmigrationCount, calculateEmigrationCount } from './logic/immigration.js';
export { calculateLaborStats } from './logic/labor.js';
export type { LaborStats } from './logic/labor.js';
export {
  LOAN_TERMS, LOAN_MIN_AMOUNT, LOAN_AMOUNT_STEP, LOAN_BASE_CREDIT_LIMIT,
  LOAN_CREDIT_PER_CITIZEN, MAX_ACTIVE_LOANS,
} from './constants/economy.js';
export {
  getCreditLimit, getOutstandingDebt, getAvailableCredit, calculateLoanPayments,
  quoteLoan, validateLoanRequest, createLoan, applyLoanPayments,
} from './logic/loans.js';
export type { LoanQuote } from './logic/loans.js';
export { BUILDING_DEFS, ZONE_LEVELS, ZONE_DENSITY_COSTS, ROAD_GRADING_COST, ROAD_GRADING_MARGIN, getZoneLevelDef } from './constants/buildings.js';
export type { ZoneLevelDef } from './constants/buildings.js';

// Logic
export {
  canPlaceBuilding, canReplace, clearGridBuilding, createEmptyGrid, findGridBuildingToDemolish, getEffectiveSize,
  getPlacementCost, getReplacedBuildings, getReplacedRoads, getRoadGradingCells,
  getWaterfrontFacing, levelRoadTerrain, replacesRoads, resolveWaterfrontOrientation, setGridBuilding,
} from './logic/placement.js';
export type { PlacementCostQuote, PlacementResult, WaterfrontFacing } from './logic/placement.js';
export {
  WATER_SOURCE_THRESHOLD,
  POWER_MAX_SPAN, POWER_PYLON_STEP,
  POWER_LINE_RADIUS, POWER_GENERATOR_RADIUS, POWER_SUBSTATION_RADIUS, POWER_URBAN_HOP_LIMIT,
  WATER_PIPE_RADIUS, WATER_FACILITY_RADIUS, WATER_TOWER_RADIUS,
  SEWAGE_PIPE_RADIUS, SEWAGE_FACILITY_RADIUS,
  CELL_FLAG_POWER, CELL_FLAG_WATER, CELL_FLAG_SEWAGE, CELL_FLAG_WATER_SOURCE,
  getWaterSourceInfo, hasWaterSourceInFootprint,
  isGeneratorBuilding, isPowerConductorBuilding, isWaterFacilityBuilding, isSewageFacilityBuilding,
  computePowerCableSpans, getBuildingUtilityProfile, evaluateCityUtilities, getCellUtilityCoverage,
} from './logic/utilities.js';
export type {
  WaterSourceKind, WaterSourceInfo,
  PowerSupplyState, WaterSupplyState, SewageSupplyState,
  BuildingUtilityStatus, PowerCableSpan, PowerSubgridInfo, UtilityGridReport, UtilityResourceProfile,
} from './logic/utilities.js';
export { createStarterLayout, getStarterEntranceX, isStarterEntranceRoad } from './logic/starterLayout.js';
export {
  MAX_ACTIVE_EMERGENCIES,
  EMERGENCY_SPAWN_COOLDOWN_TICKS,
  EMERGENCY_MIN_DEVELOPED_ZONES,
  EMERGENCY_DEADLINE_TICKS,
  EMERGENCY_AUTO_RESPONSE_TICKS,
  EMERGENCY_LABELS,
  hasRoadFrontage,
  hasOperationalResponder,
  maybeSpawnEmergency,
  createEmergency,
  failEmergency,
  resolveEmergencyOutcome,
} from './logic/emergencies.js';
export {
  planTown, normalizeTownSettings, TOWN_CHARACTERS, TOWN_CHARACTER_KNOBS, DEFAULT_TOWN,
} from './logic/townPlan.js';
export type { TownSettings, TownCharacter, TownPlan } from './logic/townPlan.js';
export type { TaxBreakdown } from './logic/resources.js';
export { calculateTaxBreakdown, calculateTaxRevenue, calculateMaintenance, calculateNetIncome, calculatePopulationGrowth, calculateHappiness, calculateHousingCapacity, calculateBudgetPenalty, calculateTaxPenalty, clamp, calculateCityScore } from './logic/resources.js';
export { simulateTick, simulateCityTick, advanceClock } from './logic/simulation.js';
export { calculateDemand, calculateDemandTargets, calculateGrowthBudget, getZoneGrowthChance, getZoneLevelHappinessRequirement, processZoneGrowth } from './logic/demand.js';
export { calculateBirthCount } from './logic/birth.js';
export { getDeathProbability } from './logic/death.js';
export {
  calculateCityMaslowCapacity,
  calculateBaseMaslowTargets,
  adjustTargetsForLifeStage,
  getServiceSatisfaction,
  getSmallTownSatisfaction,
  LIFE_STAGE_MASLOW_WEIGHTS,
} from './logic/maslow.js';
export type { CityMaslowCapacity, CityMaslowProfile } from './logic/maslow.js';
export { findConnectedCities, evaluateMigration } from './logic/migration.js';
export type { MigrationCandidate } from './logic/migration.js';
export {
  calculateEdgeConnections,
  getOppositeDirection,
  getNeighborDirection,
  findMatchingConnections,
  findAdjacentCity
} from './logic/edgeConnections.js';
export * from './terrain/sites.js';

// Simulation runtime (runs on the server or in a peer-to-peer host's browser)
export { newId } from './sim/id.js';
export { PopulationManager } from './sim/PopulationManager.js';
export type { SerializedPerson } from './sim/PopulationManager.js';
export { CityRoom } from './sim/CityRoom.js';
export type { CityMessageSink } from './sim/CityRoom.js';
export { WorldTickEngine } from './sim/WorldTickEngine.js';
export type { TickRoom, WorldBroadcaster, WorldTickEngineOptions } from './sim/WorldTickEngine.js';

import type { BuildingType, RoadOrientation, ZoneDensity } from './building.js';
import type { Position, UtilityLayer } from './grid.js';
import type { CityState } from './city.js';
import type { ResourceState, PopulationSummary } from './resources.js';
import type { PlacedBuilding } from './building.js';
import type { Player } from './player.js';
import type { GameClock } from './time.js';
import type { WorldState } from './world.js';
import type { CityEmergency, CityEmergencyOutcome } from './emergencies.js';

// Client -> Server event names
export const C2S = {
  JOIN_CITY: 'city:join',
  CREATE_CITY: 'city:create',
  CLAIM_PLOT: 'world:claimPlot',
  PLACE_BUILDING: 'building:place',
  DEMOLISH: 'building:demolish',
  LEAVE: 'city:leave',
  SAVE: 'city:save',
  RESTART: 'city:restart',
  SET_TAX_RATE: 'city:taxRate',
  SET_UNLIMITED_MONEY: 'city:unlimitedMoney',
  SET_GAME_SPEED: 'city:gameSpeed',
  EMERGENCY_RESPOND: 'city:emergencyRespond',
  EMERGENCY_RESOLVE: 'city:emergencyResolve',
  SET_BUILDING_FLEET: 'building:fleet',
} as const;

// Server -> Client event names
export const S2C = {
  CITY_STATE: 'city:state',
  WORLD_STATE: 'world:state',
  BUILDING_PLACED: 'building:placed',
  BUILDINGS_PLACED: 'buildings:placed',
  BUILDING_UPDATED: 'building:updated',
  BUILDING_DEMOLISHED: 'building:demolished',
  RESOURCES_UPDATE: 'city:resources',
  ZONE_GROWTH: 'zone:growth',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  ERROR: 'error',
  CITY_LIST: 'city:list',
  SAVE_OK: 'city:saved',
  POPULATION_UPDATE: 'city:population',
  MIGRATION_EVENT: 'world:migration',
  WORLD_TICK: 'world:tick',
  EMERGENCY_STARTED: 'city:emergencyStarted',
  EMERGENCY_RESPONDING: 'city:emergencyResponding',
  EMERGENCY_OUTCOME: 'city:emergencyOutcome',
} as const;

// Client -> Server payloads
export interface JoinCityPayload {
  cityId: string;
  playerName: string;
  playerId?: string;
}

export interface CreateCityPayload {
  cityName: string;
  playerName: string;
  playerId?: string;
}

export interface ClaimPlotPayload {
  siteId: string;
  cityName: string;
  playerName: string;
  playerId?: string;
  /** Older clients may explicitly request the default world. */
  worldId?: string;
}

export interface PlaceBuildingPayload {
  position: Position;
  type: BuildingType;
  density?: ZoneDensity;
  orientation?: RoadOrientation;
}

export interface PlaceBuildingsPayload extends Omit<PlaceBuildingPayload, 'position'> {
  positions: Position[];
}

export interface DemolishPayload {
  position: Position;
  layer?: UtilityLayer;
}

export interface TakeLoanPayload {
  amount: number;
  termDays: number;
}

export interface RepayLoanPayload {
  loanId: string;
}

export interface SetTaxRatePayload {
  taxRate: number;
}

export interface SetUnlimitedMoneyPayload {
  enabled: boolean;
}

export interface SetGameSpeedPayload {
  speed: number;
}

export interface SetBuildingFleetPayload {
  buildingId: string;
  fleetSize: number;
}

// Server -> Client payloads
export interface CityStatePayload {
  city: CityState;
  players: Player[];
}

export interface WorldStatePayload {
  world: WorldState;
}

export interface BuildingPlacedPayload {
  building: PlacedBuilding;
  resources: ResourceState;
}

export interface BuildingUpdatedPayload {
  building: PlacedBuilding;
  resources: ResourceState;
}

export interface BuildingsPlacedPayload {
  buildings: PlacedBuilding[];
  resources: ResourceState;
}

export interface BuildingDemolishedPayload {
  position: Position;
  buildingId: string;
  resources: ResourceState;
}

export interface ResourcesUpdatePayload {
  resources: ResourceState;
  tick: number;
  clock: GameClock;
}

export interface ZoneGrowthPayload {
  buildings: Array<{
    id: string;
    developmentLevel: number;
    developedAt: number;
  }>;
}

export interface ErrorPayload {
  message: string;
  code: string;
}

export interface CityListItem {
  id: string;
  name: string;
  ownerName: string;
  playerCount: number;
  buildingCount: number;
}

export interface PopulationUpdatePayload {
  summary: PopulationSummary;
}

export interface MigrationEventPayload {
  personCount: number;
  fromCityId: string;
  toCityId: string;
  reason: string;
}

export interface WorldTickPayload {
  clock: GameClock;
  totalPopulation: number;
  citySummaries: Array<{ cityId: string; population: number; happiness: number }>;
}

export interface EmergencyStartedPayload {
  emergency: CityEmergency;
}

export interface EmergencyRespondingPayload {
  emergencyId: string;
  respondingAtTick: number;
}

export interface EmergencyOutcomePayload {
  outcome: CityEmergencyOutcome;
  resources: ResourceState;
}

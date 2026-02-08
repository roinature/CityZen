import type { BuildingType } from './building.js';
import type { Position } from './grid.js';
import type { CityState } from './city.js';
import type { ResourceState } from './resources.js';
import type { PlacedBuilding } from './building.js';
import type { Player } from './player.js';
import type { GameClock } from './time.js';
import type { WorldState, WorldPosition } from './world.js';

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
} as const;

// Server -> Client event names
export const S2C = {
  CITY_STATE: 'city:state',
  WORLD_STATE: 'world:state',
  BUILDING_PLACED: 'building:placed',
  BUILDING_DEMOLISHED: 'building:demolished',
  RESOURCES_UPDATE: 'city:resources',
  ZONE_GROWTH: 'zone:growth',
  PLAYER_JOINED: 'player:joined',
  PLAYER_LEFT: 'player:left',
  ERROR: 'error',
  CITY_LIST: 'city:list',
  SAVE_OK: 'city:saved',
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
  position: WorldPosition;
  cityName: string;
  playerName: string;
  playerId?: string;
}

export interface PlaceBuildingPayload {
  position: Position;
  type: BuildingType;
}

export interface DemolishPayload {
  position: Position;
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

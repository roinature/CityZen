import type { Position } from './grid.js';

export enum BuildingType {
  // Zones (player places these; buildings grow inside them)
  ZONE_RESIDENTIAL = 'zone_residential',
  ZONE_COMMERCIAL = 'zone_commercial',
  ZONE_INDUSTRIAL = 'zone_industrial',

  // Roads (4 tiers)
  ROAD_DIRT = 'road_dirt',
  ROAD_STREET = 'road_street',
  ROAD_AVENUE = 'road_avenue',
  ROAD_HIGHWAY = 'road_highway',

  // Standalone
  PARK = 'park',

  // --- Infrastructure ---
  // Energy
  ENERGY_WIND_TURBINE = 'energy_wind_turbine',
  ENERGY_SOLAR_FARM = 'energy_solar_farm',
  ENERGY_COAL_PLANT = 'energy_coal_plant',
  ENERGY_NUCLEAR_PLANT = 'energy_nuclear_plant',

  // Water & Sewage
  WATER_TOWER = 'water_tower',
  WATER_PUMP_STATION = 'water_pump_station',
  WATER_TREATMENT = 'water_treatment',
  WATER_SEWAGE_PLANT = 'water_sewage_plant',

  // Police
  POLICE_STATION = 'police_station',
  POLICE_HQ = 'police_hq',
  POLICE_JAIL = 'police_jail',
  POLICE_ACADEMY = 'police_academy',

  // Fire Department
  FIRE_STATION = 'fire_station',
  FIRE_HQ = 'fire_hq',
  FIRE_HELICOPTER = 'fire_helicopter',
  FIRE_TRAINING = 'fire_training',

  // Education
  EDU_ELEMENTARY = 'edu_elementary',
  EDU_HIGH_SCHOOL = 'edu_high_school',
  EDU_UNIVERSITY = 'edu_university',
  EDU_LIBRARY = 'edu_library',

  // Government
  GOV_CITY_HALL = 'gov_city_hall',
  GOV_COURTHOUSE = 'gov_courthouse',
  GOV_PARLIAMENT = 'gov_parliament',
  GOV_MONUMENT = 'gov_monument',

  // Tourism
  TOUR_LANDMARK = 'tour_landmark',
  TOUR_MUSEUM = 'tour_museum',
  TOUR_STADIUM = 'tour_stadium',
  TOUR_AMUSEMENT = 'tour_amusement',

  // Transportation
  TRANS_BUS_DEPOT = 'trans_bus_depot',
  TRANS_TRAIN_STATION = 'trans_train_station',
  TRANS_AIRPORT = 'trans_airport',
  TRANS_HARBOR = 'trans_harbor',
}

export const ZONE_TYPES = [
  BuildingType.ZONE_RESIDENTIAL,
  BuildingType.ZONE_COMMERCIAL,
  BuildingType.ZONE_INDUSTRIAL,
] as const;

export const ROAD_TYPES = [
  BuildingType.ROAD_DIRT,
  BuildingType.ROAD_STREET,
  BuildingType.ROAD_AVENUE,
  BuildingType.ROAD_HIGHWAY,
] as const;

// Infrastructure category arrays
export const INFRA_ENERGY_TYPES = [
  BuildingType.ENERGY_WIND_TURBINE, BuildingType.ENERGY_SOLAR_FARM,
  BuildingType.ENERGY_COAL_PLANT, BuildingType.ENERGY_NUCLEAR_PLANT,
] as const;

export const INFRA_WATER_TYPES = [
  BuildingType.WATER_TOWER, BuildingType.WATER_PUMP_STATION,
  BuildingType.WATER_TREATMENT, BuildingType.WATER_SEWAGE_PLANT,
] as const;

export const INFRA_POLICE_TYPES = [
  BuildingType.POLICE_STATION, BuildingType.POLICE_HQ,
  BuildingType.POLICE_JAIL, BuildingType.POLICE_ACADEMY,
] as const;

export const INFRA_FIRE_TYPES = [
  BuildingType.FIRE_STATION, BuildingType.FIRE_HQ,
  BuildingType.FIRE_HELICOPTER, BuildingType.FIRE_TRAINING,
] as const;

export const INFRA_EDU_TYPES = [
  BuildingType.EDU_ELEMENTARY, BuildingType.EDU_HIGH_SCHOOL,
  BuildingType.EDU_UNIVERSITY, BuildingType.EDU_LIBRARY,
] as const;

export const INFRA_GOV_TYPES = [
  BuildingType.GOV_CITY_HALL, BuildingType.GOV_COURTHOUSE,
  BuildingType.GOV_PARLIAMENT, BuildingType.GOV_MONUMENT,
] as const;

export const INFRA_TOUR_TYPES = [
  BuildingType.TOUR_LANDMARK, BuildingType.TOUR_MUSEUM,
  BuildingType.TOUR_STADIUM, BuildingType.TOUR_AMUSEMENT,
] as const;

export const INFRA_TRANS_TYPES = [
  BuildingType.TRANS_BUS_DEPOT, BuildingType.TRANS_TRAIN_STATION,
  BuildingType.TRANS_AIRPORT, BuildingType.TRANS_HARBOR,
] as const;

export interface InfraCategory {
  id: string;
  label: string;
  icon: string;
  types: readonly BuildingType[];
}

export const INFRA_CATEGORIES: InfraCategory[] = [
  { id: 'energy', label: 'Energy', icon: '\u26A1', types: INFRA_ENERGY_TYPES },
  { id: 'water', label: 'Water & Sewage', icon: '\uD83D\uDCA7', types: INFRA_WATER_TYPES },
  { id: 'police', label: 'Police', icon: '\uD83D\uDEA8', types: INFRA_POLICE_TYPES },
  { id: 'fire', label: 'Fire Dept', icon: '\uD83D\uDE92', types: INFRA_FIRE_TYPES },
  { id: 'education', label: 'Education', icon: '\uD83C\uDF93', types: INFRA_EDU_TYPES },
  { id: 'government', label: 'Government', icon: '\uD83C\uDFDB', types: INFRA_GOV_TYPES },
  { id: 'tourism', label: 'Tourism', icon: '\uD83C\uDFA1', types: INFRA_TOUR_TYPES },
  { id: 'transport', label: 'Transport', icon: '\uD83D\uDE8C', types: INFRA_TRANS_TYPES },
];

export type ZoneType = (typeof ZONE_TYPES)[number];
export type RoadType = (typeof ROAD_TYPES)[number];

export function isZone(type: BuildingType): type is ZoneType {
  return (ZONE_TYPES as readonly BuildingType[]).includes(type);
}

export function isRoad(type: BuildingType): type is RoadType {
  return (ROAD_TYPES as readonly BuildingType[]).includes(type);
}

export interface BuildingEffects {
  populationCapacity?: number;
  jobs?: number;
  maintenance?: number;
  happiness?: number;
}

export interface BuildingDef {
  type: BuildingType;
  label: string;
  cost: number;
  size: { w: number; d: number };
  effects: BuildingEffects;
  color: string;
  height: number;
  speedMultiplier?: number;
}

export interface PlacedBuilding {
  id: string;
  type: BuildingType;
  position: Position;
  placedBy: string;
  placedAt: number;
  developmentLevel?: number;
  developedAt?: number;
}

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

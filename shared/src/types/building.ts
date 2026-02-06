import type { Position } from './grid.js';

export enum BuildingType {
  RESIDENTIAL = 'residential',
  COMMERCIAL = 'commercial',
  INDUSTRIAL = 'industrial',
  ROAD = 'road',
  PARK = 'park',
}

export interface BuildingEffects {
  populationCapacity?: number;
  jobs?: number;
  income?: number;
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
}

export interface PlacedBuilding {
  id: string;
  type: BuildingType;
  position: Position;
  placedBy: string;
  placedAt: number;
}

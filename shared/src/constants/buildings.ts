import { BuildingType, type BuildingDef, type ZoneType } from '../types/building.js';

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  // === ZONES ===
  [BuildingType.ZONE_RESIDENTIAL]: {
    type: BuildingType.ZONE_RESIDENTIAL,
    label: 'Residential Zone',
    cost: 50,
    size: { w: 1, d: 1 },
    effects: { maintenance: 1 },
    color: '#66BB6A',
    height: 0.05,
  },
  [BuildingType.ZONE_COMMERCIAL]: {
    type: BuildingType.ZONE_COMMERCIAL,
    label: 'Commercial Zone',
    cost: 50,
    size: { w: 1, d: 1 },
    effects: { maintenance: 1 },
    color: '#42A5F5',
    height: 0.05,
  },
  [BuildingType.ZONE_INDUSTRIAL]: {
    type: BuildingType.ZONE_INDUSTRIAL,
    label: 'Industrial Zone',
    cost: 50,
    size: { w: 1, d: 1 },
    effects: { maintenance: 1 },
    color: '#FFA726',
    height: 0.05,
  },

  // === ROADS ===
  [BuildingType.ROAD_DIRT]: {
    type: BuildingType.ROAD_DIRT,
    label: 'Dirt Road',
    cost: 5,
    size: { w: 1, d: 1 },
    effects: { maintenance: 0 },
    color: '#8D6E63',
    height: 0.1,
    speedMultiplier: 0.5,
  },
  [BuildingType.ROAD_STREET]: {
    type: BuildingType.ROAD_STREET,
    label: 'Street',
    cost: 15,
    size: { w: 1, d: 1 },
    effects: { maintenance: 1 },
    color: '#424242',
    height: 0.1,
    speedMultiplier: 1.0,
  },
  [BuildingType.ROAD_AVENUE]: {
    type: BuildingType.ROAD_AVENUE,
    label: 'Avenue',
    cost: 80,
    size: { w: 2, d: 2 },
    effects: { maintenance: 4 },
    color: '#616161',
    height: 0.1,
    speedMultiplier: 1.5,
  },
  [BuildingType.ROAD_HIGHWAY]: {
    type: BuildingType.ROAD_HIGHWAY,
    label: 'Highway',
    cost: 225,
    size: { w: 3, d: 3 },
    effects: { maintenance: 10 },
    color: '#37474F',
    height: 0.15,
    speedMultiplier: 2.5,
  },

  // === STANDALONE ===
  [BuildingType.PARK]: {
    type: BuildingType.PARK,
    label: 'Park',
    cost: 50,
    size: { w: 1, d: 1 },
    effects: { happiness: 10, maintenance: 3 },
    color: '#8BC34A',
    height: 0.2,
  },
};

export interface ZoneLevelDef {
  populationCapacity: number;
  jobs: number;
  happiness: number;
  maintenance: number;
  height: number;
  color: string;
  ticksRequired: number;
}

export const ZONE_LEVELS: Record<ZoneType, ZoneLevelDef[]> = {
  [BuildingType.ZONE_RESIDENTIAL]: [
    { populationCapacity: 5, jobs: 0, happiness: 0, maintenance: 1, height: 2, color: '#4CAF50', ticksRequired: 5 },
    { populationCapacity: 15, jobs: 0, happiness: 1, maintenance: 2, height: 4, color: '#388E3C', ticksRequired: 15 },
    { populationCapacity: 30, jobs: 0, happiness: 2, maintenance: 4, height: 7, color: '#2E7D32', ticksRequired: 30 },
  ],
  [BuildingType.ZONE_COMMERCIAL]: [
    { populationCapacity: 0, jobs: 3, happiness: 2, maintenance: 2, height: 3, color: '#2196F3', ticksRequired: 5 },
    { populationCapacity: 0, jobs: 8, happiness: 3, maintenance: 4, height: 5, color: '#1976D2', ticksRequired: 15 },
    { populationCapacity: 0, jobs: 15, happiness: 5, maintenance: 7, height: 8, color: '#1565C0', ticksRequired: 30 },
  ],
  [BuildingType.ZONE_INDUSTRIAL]: [
    { populationCapacity: 0, jobs: 8, happiness: -2, maintenance: 3, height: 3, color: '#FF9800', ticksRequired: 5 },
    { populationCapacity: 0, jobs: 18, happiness: -4, maintenance: 6, height: 5, color: '#F57C00', ticksRequired: 15 },
    { populationCapacity: 0, jobs: 30, happiness: -6, maintenance: 10, height: 7, color: '#E65100', ticksRequired: 30 },
  ],
};

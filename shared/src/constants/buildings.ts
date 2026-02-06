import { BuildingType, type BuildingDef } from '../types/building.js';

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  [BuildingType.RESIDENTIAL]: {
    type: BuildingType.RESIDENTIAL,
    label: 'House',
    cost: 100,
    size: { w: 1, d: 1 },
    effects: { populationCapacity: 10, income: -2 },
    color: '#4CAF50',
    height: 3,
  },
  [BuildingType.COMMERCIAL]: {
    type: BuildingType.COMMERCIAL,
    label: 'Shop',
    cost: 200,
    size: { w: 1, d: 1 },
    effects: { jobs: 5, income: 10, happiness: 2 },
    color: '#2196F3',
    height: 4,
  },
  [BuildingType.INDUSTRIAL]: {
    type: BuildingType.INDUSTRIAL,
    label: 'Factory',
    cost: 300,
    size: { w: 2, d: 2 },
    effects: { jobs: 20, income: 25, happiness: -5 },
    color: '#9E9E9E',
    height: 5,
  },
  [BuildingType.ROAD]: {
    type: BuildingType.ROAD,
    label: 'Road',
    cost: 10,
    size: { w: 1, d: 1 },
    effects: {},
    color: '#424242',
    height: 0.1,
  },
  [BuildingType.PARK]: {
    type: BuildingType.PARK,
    label: 'Park',
    cost: 50,
    size: { w: 1, d: 1 },
    effects: { happiness: 10 },
    color: '#8BC34A',
    height: 0.2,
  },
};

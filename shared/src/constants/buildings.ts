import { BuildingType, type BuildingDef, type ZoneType } from '../types/building.js';
import { MaslowNeed } from '../types/person.js';

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
    effects: {
      happiness: 10, maintenance: 3,
      maslowContributions: [
        { need: MaslowNeed.AESTHETIC, value: 8, capacityServed: 100 },
        { need: MaslowNeed.LOVE_BELONGING, value: 5, capacityServed: 80 },
      ],
    },
    color: '#8BC34A',
    height: 0.2,
  },

  // === ENERGY → Maslow: PHYSIOLOGICAL ===
  [BuildingType.ENERGY_WIND_TURBINE]: {
    type: BuildingType.ENERGY_WIND_TURBINE,
    label: 'Wind Turbine',
    cost: 500,
    size: { w: 1, d: 1 },
    effects: {
      maintenance: 5, happiness: 2,
      maslowContributions: [
        { need: MaslowNeed.PHYSIOLOGICAL, value: 10, capacityServed: 100 },
      ],
    },
    color: '#E0E0E0',
    height: 6,
  },
  [BuildingType.ENERGY_SOLAR_FARM]: {
    type: BuildingType.ENERGY_SOLAR_FARM,
    label: 'Solar Farm',
    cost: 800,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 8, happiness: 1,
      maslowContributions: [
        { need: MaslowNeed.PHYSIOLOGICAL, value: 12, capacityServed: 250 },
      ],
    },
    color: '#1565C0',
    height: 0.5,
  },
  [BuildingType.ENERGY_COAL_PLANT]: {
    type: BuildingType.ENERGY_COAL_PLANT,
    label: 'Coal Plant',
    cost: 2000,
    size: { w: 3, d: 3 },
    effects: {
      maintenance: 25, happiness: -10,
      maslowContributions: [
        { need: MaslowNeed.PHYSIOLOGICAL, value: 18, capacityServed: 800 },
      ],
    },
    color: '#424242',
    height: 5,
  },
  [BuildingType.ENERGY_NUCLEAR_PLANT]: {
    type: BuildingType.ENERGY_NUCLEAR_PLANT,
    label: 'Nuclear Plant',
    cost: 10000,
    size: { w: 4, d: 4 },
    effects: {
      maintenance: 50, happiness: -5,
      maslowContributions: [
        { need: MaslowNeed.PHYSIOLOGICAL, value: 25, capacityServed: 2000 },
      ],
    },
    color: '#7B1FA2',
    height: 7,
  },

  // === WATER & SEWAGE → Maslow: PHYSIOLOGICAL ===
  [BuildingType.WATER_TOWER]: {
    type: BuildingType.WATER_TOWER,
    label: 'Water Tower',
    cost: 300,
    size: { w: 1, d: 1 },
    effects: {
      maintenance: 3,
      maslowContributions: [
        { need: MaslowNeed.PHYSIOLOGICAL, value: 10, capacityServed: 150 },
      ],
    },
    color: '#4FC3F7',
    height: 5,
  },
  [BuildingType.WATER_PUMP_STATION]: {
    type: BuildingType.WATER_PUMP_STATION,
    label: 'Pump Station',
    cost: 600,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 8,
      maslowContributions: [
        { need: MaslowNeed.PHYSIOLOGICAL, value: 14, capacityServed: 400 },
      ],
    },
    color: '#0288D1',
    height: 2,
  },
  [BuildingType.WATER_TREATMENT]: {
    type: BuildingType.WATER_TREATMENT,
    label: 'Treatment Plant',
    cost: 2500,
    size: { w: 3, d: 3 },
    effects: {
      maintenance: 20,
      maslowContributions: [
        { need: MaslowNeed.PHYSIOLOGICAL, value: 20, capacityServed: 1000 },
      ],
    },
    color: '#00ACC1',
    height: 3,
  },
  [BuildingType.WATER_SEWAGE_PLANT]: {
    type: BuildingType.WATER_SEWAGE_PLANT,
    label: 'Sewage Plant',
    cost: 3000,
    size: { w: 3, d: 3 },
    effects: {
      maintenance: 25, happiness: -8,
      maslowContributions: [
        { need: MaslowNeed.PHYSIOLOGICAL, value: 15, capacityServed: 1200 },
      ],
    },
    color: '#5D4037',
    height: 3,
  },

  // === POLICE → Maslow: SAFETY ===
  [BuildingType.POLICE_STATION]: {
    type: BuildingType.POLICE_STATION,
    label: 'Police Station',
    cost: 500,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 10, happiness: 5,
      maslowContributions: [
        { need: MaslowNeed.SAFETY, value: 12, capacityServed: 300 },
      ],
    },
    color: '#1E88E5',
    height: 3,
  },
  [BuildingType.POLICE_HQ]: {
    type: BuildingType.POLICE_HQ,
    label: 'Police HQ',
    cost: 2000,
    size: { w: 3, d: 3 },
    effects: {
      maintenance: 25, happiness: 10,
      maslowContributions: [
        { need: MaslowNeed.SAFETY, value: 20, capacityServed: 800 },
      ],
    },
    color: '#1565C0',
    height: 5,
  },
  [BuildingType.POLICE_JAIL]: {
    type: BuildingType.POLICE_JAIL,
    label: 'Jail',
    cost: 1500,
    size: { w: 2, d: 3 },
    effects: {
      maintenance: 20, happiness: -3,
      maslowContributions: [
        { need: MaslowNeed.SAFETY, value: 8, capacityServed: 500 },
      ],
    },
    color: '#546E7A',
    height: 4,
  },
  [BuildingType.POLICE_ACADEMY]: {
    type: BuildingType.POLICE_ACADEMY,
    label: 'Police Academy',
    cost: 1200,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 15, happiness: 3,
      maslowContributions: [
        { need: MaslowNeed.SAFETY, value: 10, capacityServed: 400 },
      ],
    },
    color: '#283593',
    height: 3,
  },

  // === FIRE DEPARTMENT → Maslow: SAFETY ===
  [BuildingType.FIRE_STATION]: {
    type: BuildingType.FIRE_STATION,
    label: 'Fire Station',
    cost: 500,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 10, happiness: 5,
      maslowContributions: [
        { need: MaslowNeed.SAFETY, value: 12, capacityServed: 300 },
      ],
    },
    color: '#E53935',
    height: 3,
  },
  [BuildingType.FIRE_HQ]: {
    type: BuildingType.FIRE_HQ,
    label: 'Fire HQ',
    cost: 2000,
    size: { w: 3, d: 3 },
    effects: {
      maintenance: 25, happiness: 8,
      maslowContributions: [
        { need: MaslowNeed.SAFETY, value: 18, capacityServed: 800 },
      ],
    },
    color: '#C62828',
    height: 5,
  },
  [BuildingType.FIRE_HELICOPTER]: {
    type: BuildingType.FIRE_HELICOPTER,
    label: 'Helicopter Pad',
    cost: 3000,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 30, happiness: 4,
      maslowContributions: [
        { need: MaslowNeed.SAFETY, value: 15, capacityServed: 600 },
      ],
    },
    color: '#FF7043',
    height: 2,
  },
  [BuildingType.FIRE_TRAINING]: {
    type: BuildingType.FIRE_TRAINING,
    label: 'Training Center',
    cost: 1000,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 12, happiness: 2,
      maslowContributions: [
        { need: MaslowNeed.SAFETY, value: 8, capacityServed: 400 },
      ],
    },
    color: '#D84315',
    height: 3,
  },

  // === HEALTH → Maslow: LOVE/BELONGING ===
  [BuildingType.HEALTH_CLINIC]: {
    type: BuildingType.HEALTH_CLINIC,
    label: 'Clinic',
    cost: 400,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 8, happiness: 6,
      maslowContributions: [
        { need: MaslowNeed.LOVE_BELONGING, value: 10, capacityServed: 200 },
      ],
    },
    color: '#80CBC4',
    height: 2,
  },
  [BuildingType.HEALTH_HOSPITAL]: {
    type: BuildingType.HEALTH_HOSPITAL,
    label: 'Hospital',
    cost: 3000,
    size: { w: 3, d: 3 },
    effects: {
      maintenance: 25, happiness: 15,
      maslowContributions: [
        { need: MaslowNeed.LOVE_BELONGING, value: 20, capacityServed: 600 },
      ],
    },
    color: '#009688',
    height: 5,
  },
  [BuildingType.HEALTH_RESEARCH_CENTER]: {
    type: BuildingType.HEALTH_RESEARCH_CENTER,
    label: 'Research Center',
    cost: 8000,
    size: { w: 4, d: 4 },
    effects: {
      maintenance: 50, happiness: 20,
      maslowContributions: [
        { need: MaslowNeed.LOVE_BELONGING, value: 25, capacityServed: 1500 },
      ],
    },
    color: '#004D40',
    height: 6,
  },
  [BuildingType.HEALTH_CEMETERY]: {
    type: BuildingType.HEALTH_CEMETERY,
    label: 'Cemetery',
    cost: 200,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 3, happiness: -2,
      maslowContributions: [
        { need: MaslowNeed.LOVE_BELONGING, value: 5, capacityServed: 500 },
      ],
    },
    color: '#455A64',
    height: 0.5,
  },

  // === EDUCATION → Maslow: COGNITIVE ===
  [BuildingType.EDU_ELEMENTARY]: {
    type: BuildingType.EDU_ELEMENTARY,
    label: 'Elementary School',
    cost: 400,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 8, happiness: 8,
      maslowContributions: [
        { need: MaslowNeed.COGNITIVE, value: 15, capacityServed: 150 },
      ],
    },
    color: '#FDD835',
    height: 2,
  },
  [BuildingType.EDU_HIGH_SCHOOL]: {
    type: BuildingType.EDU_HIGH_SCHOOL,
    label: 'High School',
    cost: 800,
    size: { w: 3, d: 2 },
    effects: {
      maintenance: 15, happiness: 10,
      maslowContributions: [
        { need: MaslowNeed.COGNITIVE, value: 18, capacityServed: 300 },
      ],
    },
    color: '#F9A825',
    height: 3,
  },
  [BuildingType.EDU_UNIVERSITY]: {
    type: BuildingType.EDU_UNIVERSITY,
    label: 'University',
    cost: 5000,
    size: { w: 4, d: 4 },
    effects: {
      maintenance: 40, happiness: 20,
      maslowContributions: [
        { need: MaslowNeed.COGNITIVE, value: 25, capacityServed: 800 },
      ],
    },
    color: '#F57F17',
    height: 5,
  },
  [BuildingType.EDU_LIBRARY]: {
    type: BuildingType.EDU_LIBRARY,
    label: 'Library',
    cost: 300,
    size: { w: 1, d: 1 },
    effects: {
      maintenance: 5, happiness: 6,
      maslowContributions: [
        { need: MaslowNeed.COGNITIVE, value: 10, capacityServed: 200 },
      ],
    },
    color: '#FFB300',
    height: 3,
  },

  // === GOVERNMENT → Maslow: SELF_ACTUALIZATION ===
  [BuildingType.GOV_CITY_HALL]: {
    type: BuildingType.GOV_CITY_HALL,
    label: 'City Hall',
    cost: 2000,
    size: { w: 3, d: 3 },
    effects: {
      maintenance: 20, happiness: 15,
      maslowContributions: [
        { need: MaslowNeed.SELF_ACTUALIZATION, value: 15, capacityServed: 500 },
      ],
    },
    color: '#ECEFF1',
    height: 5,
  },
  [BuildingType.GOV_COURTHOUSE]: {
    type: BuildingType.GOV_COURTHOUSE,
    label: 'Courthouse',
    cost: 1500,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 15, happiness: 8,
      maslowContributions: [
        { need: MaslowNeed.SELF_ACTUALIZATION, value: 12, capacityServed: 400 },
      ],
    },
    color: '#CFD8DC',
    height: 4,
  },
  [BuildingType.GOV_PARLIAMENT]: {
    type: BuildingType.GOV_PARLIAMENT,
    label: 'Parliament',
    cost: 8000,
    size: { w: 4, d: 4 },
    effects: {
      maintenance: 50, happiness: 25,
      maslowContributions: [
        { need: MaslowNeed.SELF_ACTUALIZATION, value: 25, capacityServed: 2000 },
      ],
    },
    color: '#B0BEC5',
    height: 7,
  },
  [BuildingType.GOV_MONUMENT]: {
    type: BuildingType.GOV_MONUMENT,
    label: 'Monument',
    cost: 1000,
    size: { w: 1, d: 1 },
    effects: {
      maintenance: 5, happiness: 12,
      maslowContributions: [
        { need: MaslowNeed.SELF_ACTUALIZATION, value: 10, capacityServed: 300 },
      ],
    },
    color: '#90A4AE',
    height: 8,
  },

  // === TOURISM → Maslow: ESTEEM ===
  [BuildingType.TOUR_LANDMARK]: {
    type: BuildingType.TOUR_LANDMARK,
    label: 'Landmark',
    cost: 3000,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 15, happiness: 20,
      maslowContributions: [
        { need: MaslowNeed.ESTEEM, value: 18, capacityServed: 400 },
      ],
    },
    color: '#FF8A65',
    height: 6,
  },
  [BuildingType.TOUR_MUSEUM]: {
    type: BuildingType.TOUR_MUSEUM,
    label: 'Museum',
    cost: 2500,
    size: { w: 3, d: 2 },
    effects: {
      maintenance: 20, happiness: 18,
      maslowContributions: [
        { need: MaslowNeed.ESTEEM, value: 16, capacityServed: 350 },
      ],
    },
    color: '#A1887F',
    height: 4,
  },
  [BuildingType.TOUR_STADIUM]: {
    type: BuildingType.TOUR_STADIUM,
    label: 'Stadium',
    cost: 8000,
    size: { w: 4, d: 4 },
    effects: {
      maintenance: 40, happiness: 30,
      maslowContributions: [
        { need: MaslowNeed.ESTEEM, value: 25, capacityServed: 1500 },
      ],
    },
    color: '#4DB6AC',
    height: 4,
  },
  [BuildingType.TOUR_AMUSEMENT]: {
    type: BuildingType.TOUR_AMUSEMENT,
    label: 'Amusement Park',
    cost: 6000,
    size: { w: 4, d: 3 },
    effects: {
      maintenance: 35, happiness: 35,
      maslowContributions: [
        { need: MaslowNeed.ESTEEM, value: 22, capacityServed: 1200 },
      ],
    },
    color: '#FF4081',
    height: 5,
  },

  // === TRANSPORTATION → Maslow: LOVE/BELONGING ===
  [BuildingType.TRANS_BUS_DEPOT]: {
    type: BuildingType.TRANS_BUS_DEPOT,
    label: 'Bus Depot',
    cost: 400,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 8, happiness: 5,
      maslowContributions: [
        { need: MaslowNeed.LOVE_BELONGING, value: 8, capacityServed: 200 },
      ],
    },
    color: '#66BB6A',
    height: 2,
  },
  [BuildingType.TRANS_TRAIN_STATION]: {
    type: BuildingType.TRANS_TRAIN_STATION,
    label: 'Train Station',
    cost: 3000,
    size: { w: 3, d: 2 },
    effects: {
      maintenance: 20, happiness: 12,
      maslowContributions: [
        { need: MaslowNeed.LOVE_BELONGING, value: 15, capacityServed: 600 },
      ],
    },
    color: '#78909C',
    height: 4,
  },
  [BuildingType.TRANS_AIRPORT]: {
    type: BuildingType.TRANS_AIRPORT,
    label: 'Airport',
    cost: 15000,
    size: { w: 5, d: 5 },
    effects: {
      maintenance: 60, happiness: 15,
      maslowContributions: [
        { need: MaslowNeed.LOVE_BELONGING, value: 20, capacityServed: 2000 },
      ],
    },
    color: '#B0BEC5',
    height: 3,
  },
  [BuildingType.TRANS_HARBOR]: {
    type: BuildingType.TRANS_HARBOR,
    label: 'Harbor',
    cost: 5000,
    size: { w: 4, d: 3 },
    effects: {
      maintenance: 25, happiness: 10,
      maslowContributions: [
        { need: MaslowNeed.LOVE_BELONGING, value: 12, capacityServed: 1000 },
      ],
    },
    color: '#0097A7',
    height: 3,
  },

  // === ART & CULTURE → Maslow: AESTHETIC ===
  [BuildingType.ART_GALLERY]: {
    type: BuildingType.ART_GALLERY,
    label: 'Art Gallery',
    cost: 1500,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 12, happiness: 12,
      maslowContributions: [
        { need: MaslowNeed.AESTHETIC, value: 15, capacityServed: 200 },
      ],
    },
    color: '#E040FB',
    height: 3,
  },
  [BuildingType.ART_THEATER]: {
    type: BuildingType.ART_THEATER,
    label: 'Theater',
    cost: 2500,
    size: { w: 3, d: 2 },
    effects: {
      maintenance: 18, happiness: 16,
      maslowContributions: [
        { need: MaslowNeed.AESTHETIC, value: 20, capacityServed: 400 },
      ],
    },
    color: '#CE93D8',
    height: 4,
  },
  [BuildingType.ART_CONCERT_HALL]: {
    type: BuildingType.ART_CONCERT_HALL,
    label: 'Concert Hall',
    cost: 6000,
    size: { w: 4, d: 3 },
    effects: {
      maintenance: 35, happiness: 25,
      maslowContributions: [
        { need: MaslowNeed.AESTHETIC, value: 25, capacityServed: 1000 },
      ],
    },
    color: '#AB47BC',
    height: 5,
  },
  [BuildingType.ART_SCULPTURE_PARK]: {
    type: BuildingType.ART_SCULPTURE_PARK,
    label: 'Sculpture Park',
    cost: 800,
    size: { w: 2, d: 2 },
    effects: {
      maintenance: 5, happiness: 8,
      maslowContributions: [
        { need: MaslowNeed.AESTHETIC, value: 10, capacityServed: 150 },
      ],
    },
    color: '#BA68C8',
    height: 1,
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

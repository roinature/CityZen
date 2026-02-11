import type { CityState } from '../types/city.js';
import type { DemandState } from '../types/resources.js';
import { BuildingType, isZone, type ZoneType } from '../types/building.js';
import { getZoneLevelDef } from '../constants/buildings.js';
import { DEMAND_GROWTH_RATE, MIN_DEMAND_TO_GROW, ZONE_GROWTH_CHANCE } from '../constants/simulation.js';
import { clamp } from './resources.js';

export function calculateDemand(state: CityState): DemandState {
  let totalPopCapacity = 0;
  let totalJobs = 0;
  let totalCommercialJobs = 0;

  for (const b of state.buildings) {
    if (!isZone(b.type) || !b.developmentLevel || b.developmentLevel === 0) continue;
    const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
    totalPopCapacity += levelDef.populationCapacity;
    totalJobs += levelDef.jobs;
    if (b.type === BuildingType.ZONE_COMMERCIAL) {
      totalCommercialJobs += levelDef.jobs;
    }
  }

  const pop = state.resources.population;

  // Residential demand: more jobs than people = people want to move in
  const jobRatio = totalJobs > 0 ? pop / totalJobs : 2;
  const residentialTarget = clamp(1 - jobRatio, -1, 1);

  // Commercial demand: more people = more shops needed
  const commercialRatio = pop > 0 ? totalCommercialJobs / (pop * 0.3) : 2;
  const commercialTarget = clamp(1 - commercialRatio, -1, 1);

  // Industrial demand: base growth, slows as industrial develops
  const industrialJobRatio = totalJobs > 0 ? (totalJobs - totalCommercialJobs) / Math.max(pop * 0.5, 10) : 0;
  const industrialTarget = clamp(0.5 - industrialJobRatio, -1, 1);

  // Smooth toward target (lerp from current demand)
  const current = state.resources.demand ?? { residential: 0.5, commercial: 0, industrial: 0.3 };
  return {
    residential: current.residential + (residentialTarget - current.residential) * DEMAND_GROWTH_RATE,
    commercial: current.commercial + (commercialTarget - current.commercial) * DEMAND_GROWTH_RATE,
    industrial: current.industrial + (industrialTarget - current.industrial) * DEMAND_GROWTH_RATE,
  };
}

export interface ZoneGrowthResult {
  upgradedBuildings: string[];
}

export function processZoneGrowth(state: CityState): ZoneGrowthResult {
  const demand = state.resources.demand;
  const result: ZoneGrowthResult = { upgradedBuildings: [] };
  const currentTick = state.tick;

  for (const building of state.buildings) {
    if (!isZone(building.type)) continue;

    const level = building.developmentLevel ?? 0;
    if (level >= 3) continue;

    // Check if demand is high enough for this zone type
    let zoneDemand = 0;
    if (building.type === BuildingType.ZONE_RESIDENTIAL) zoneDemand = demand.residential;
    if (building.type === BuildingType.ZONE_COMMERCIAL) zoneDemand = demand.commercial;
    if (building.type === BuildingType.ZONE_INDUSTRIAL) zoneDemand = demand.industrial;

    if (zoneDemand < MIN_DEMAND_TO_GROW) continue;

    // Check time requirement (now using game ticks instead of Date.now())
    const nextLevelDef = getZoneLevelDef(building.type as ZoneType, building.density, level + 1);
    const ticksRequired = nextLevelDef.ticksRequired;
    const referenceTime = building.developedAt ?? building.placedAt;
    const ticksSinceLast = currentTick - referenceTime;

    if (ticksSinceLast < ticksRequired) continue;

    // Random chance scaled by demand
    if (Math.random() < ZONE_GROWTH_CHANCE * zoneDemand) {
      building.developmentLevel = level + 1;
      building.developedAt = currentTick;
      result.upgradedBuildings.push(building.id);
    }
  }

  return result;
}

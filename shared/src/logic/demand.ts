import type { CityState } from '../types/city.js';
import type { DemandState } from '../types/resources.js';
import { BuildingType, isZone, type ZoneType } from '../types/building.js';
import { getZoneLevelDef, type ZoneLevelDef } from '../constants/buildings.js';
import {
  DEMAND_GROWTH_RATE, MIN_DEMAND_TO_GROW, ZONE_GROWTH_CHANCE,
  ZONE_LEVEL_MIN_HAPPINESS, DEMAND_UNHAPPY_BELOW,
  COMMERCIAL_JOBS_PER_RESIDENT, INDUSTRIAL_JOBS_PER_RESIDENT, MIN_JOBS_WANTED,
  HOUSING_BUFFER_RATIO, HOUSING_BUFFER_MIN,
} from '../constants/simulation.js';
import { clamp } from './resources.js';
import { calculateLaborStats } from './labor.js';

/**
 * Where each demand meter is heading, before smoothing (-1 to 1).
 *
 * Residential: people want to move in while there is work for them and the
 * existing homes are mostly taken. An unhappy city puts newcomers off.
 * Commercial / industrial: businesses open while the city has fewer of those
 * jobs than its residents can fill. The two job targets add up to slightly more
 * than the workforce, so a city zoned in balance keeps growing instead of
 * settling into a standstill.
 */
export function calculateDemandTargets(state: CityState): DemandState {
  const { commercialJobs, industrialJobs, jobs, workers, employmentRate, housingCapacity } =
    calculateLaborStats(state);
  const pop = state.resources.population;

  // Jobs: full demand when there is a job for everyone, fading out as unemployment
  // passes ~13% and turning negative past 20%.
  const unemployment = 1 - employmentRate;
  const labourShortage = workers > 0 ? clamp(jobs / workers - 1, 0, 1) : 1;
  const jobPull = clamp(0.6 - 3 * unemployment + 0.4 * labourShortage, -1, 1);

  // Housing: no point building more homes while a third of them stand empty.
  const vacancy = housingCapacity > 0 ? Math.max(0, 1 - pop / housingCapacity) : 0;
  const housingPull = clamp(1 - 3 * vacancy, -1, 1);

  // Mood: below DEMAND_UNHAPPY_BELOW the city's reputation drags demand down.
  const moodPenalty = Math.max(0, (DEMAND_UNHAPPY_BELOW - state.resources.happiness) / DEMAND_UNHAPPY_BELOW);

  const commercialWanted = Math.max(pop * COMMERCIAL_JOBS_PER_RESIDENT, MIN_JOBS_WANTED);
  const industrialWanted = Math.max(pop * INDUSTRIAL_JOBS_PER_RESIDENT, MIN_JOBS_WANTED);

  return {
    residential: clamp(Math.min(jobPull, housingPull) - moodPenalty, -1, 1),
    commercial: clamp(1 - commercialJobs / commercialWanted, -1, 1),
    industrial: clamp(1 - industrialJobs / industrialWanted, -1, 1),
  };
}

export function calculateDemand(state: CityState): DemandState {
  const target = calculateDemandTargets(state);

  // Smooth toward target (lerp from current demand)
  const current = state.resources.demand ?? { residential: 0.5, commercial: 0, industrial: 0.3 };
  return {
    residential: current.residential + (target.residential - current.residential) * DEMAND_GROWTH_RATE,
    commercial: current.commercial + (target.commercial - current.commercial) * DEMAND_GROWTH_RATE,
    industrial: current.industrial + (target.industrial - current.industrial) * DEMAND_GROWTH_RATE,
  };
}

/** Happiness the city needs before a zone can develop to `level` (1-3). */
export function getZoneLevelHappinessRequirement(level: number): number {
  return ZONE_LEVEL_MIN_HAPPINESS[level] ?? 0;
}

export interface ZoneGrowthResult {
  upgradedBuildings: string[];
}

/**
 * How much each zone type may still add this tick: homes for residential, jobs
 * for commercial and industrial. The demand meters are smoothed, so without a
 * budget a city with hundreds of empty lots would develop all of them in the
 * few ticks before the meter catches up, and then pay upkeep on buildings
 * nobody uses.
 */
export function calculateGrowthBudget(state: CityState): DemandState {
  const { commercialJobs, industrialJobs, housingCapacity } = calculateLaborStats(state);
  const pop = state.resources.population;

  return {
    residential: pop * HOUSING_BUFFER_RATIO + HOUSING_BUFFER_MIN - housingCapacity,
    commercial: Math.max(pop * COMMERCIAL_JOBS_PER_RESIDENT, MIN_JOBS_WANTED) - commercialJobs,
    industrial: Math.max(pop * INDUSTRIAL_JOBS_PER_RESIDENT, MIN_JOBS_WANTED) - industrialJobs,
  };
}

export function processZoneGrowth(state: CityState): ZoneGrowthResult {
  const demand = state.resources.demand;
  const result: ZoneGrowthResult = { upgradedBuildings: [] };
  const currentTick = state.tick;
  const budget = calculateGrowthBudget(state);
  const count = state.buildings.length;

  // Start at a different building each tick so the budget isn't always spent on the oldest zones
  for (let i = 0; i < count; i++) {
    const building = state.buildings[(i + currentTick) % count];
    if (!isZone(building.type)) continue;

    const level = building.developmentLevel ?? 0;
    if (level >= 3) continue;

    // Check if demand is high enough for this zone type
    let zoneDemand = 0;
    let kind: keyof DemandState = 'residential';
    if (building.type === BuildingType.ZONE_RESIDENTIAL) { zoneDemand = demand.residential; kind = 'residential'; }
    if (building.type === BuildingType.ZONE_COMMERCIAL) { zoneDemand = demand.commercial; kind = 'commercial'; }
    if (building.type === BuildingType.ZONE_INDUSTRIAL) { zoneDemand = demand.industrial; kind = 'industrial'; }

    if (zoneDemand < MIN_DEMAND_TO_GROW) continue;
    if (budget[kind] <= 0) continue;

    // Bigger buildings only go up in a city people actually like living in
    if (state.resources.happiness < getZoneLevelHappinessRequirement(level + 1)) continue;

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

      // The upgrade that crosses the line still happens; the next one waits.
      const added = (def: ZoneLevelDef | undefined) =>
        kind === 'residential' ? (def?.populationCapacity ?? 0) : (def?.jobs ?? 0);
      const previous = level > 0 ? getZoneLevelDef(building.type as ZoneType, building.density, level) : undefined;
      budget[kind] -= added(nextLevelDef) - added(previous);
    }
  }

  return result;
}

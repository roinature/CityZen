import type { CityState } from '../types/city.js';
import type { DemandState } from '../types/resources.js';
import { BuildingType, isZone, type ZoneType } from '../types/building.js';
import { getZoneLevelDef, type ZoneLevelDef } from '../constants/buildings.js';
import {
  DEMAND_GROWTH_RATE, MIN_DEMAND_TO_GROW, ZONE_GROWTH_MIN_CHANCE, ZONE_GROWTH_CHANCE,
  ZONE_LEVEL_MIN_HAPPINESS, DEMAND_UNHAPPY_BELOW,
  COMMERCIAL_JOBS_PER_WORKER, INDUSTRIAL_JOBS_PER_WORKER, MIN_JOBS_WANTED,
  HOUSING_BUFFER_RATIO, HOUSING_BUFFER_MIN,
} from '../constants/simulation.js';
import { clamp } from './resources.js';
import { calculateLaborStats } from './labor.js';
import { evaluateCityUtilities, getCellUtilityCoverage } from './utilities.js';

function housingTarget(population: number): number {
  return population * HOUSING_BUFFER_RATIO + HOUSING_BUFFER_MIN;
}

/**
 * Where each demand meter is heading, before smoothing (-1 to 1).
 *
 * Residential: people want to move in while there is work for them and housing
 * is below the target buffer. An unhappy city puts newcomers off.
 * Commercial / industrial: businesses open while the city has fewer of those
 * jobs than its workers can fill. Both targets and growth budgets share the
 * exact same thresholds so positive demand always correlates with actualization.
 */
function jobTargets(workers: number): { commercial: number; industrial: number } {
  return {
    commercial: Math.max(workers * COMMERCIAL_JOBS_PER_WORKER, MIN_JOBS_WANTED),
    industrial: Math.max(workers * INDUSTRIAL_JOBS_PER_WORKER, MIN_JOBS_WANTED),
  };
}

export function calculateDemandTargets(state: CityState): DemandState {
  const { commercialJobs, industrialJobs, jobs, workers, employmentRate, housingCapacity } =
    calculateLaborStats(state);
  const pop = state.resources.population;

  // Jobs: full demand when there is a job for everyone, fading out as unemployment
  // passes ~13% and turning negative past 20%.
  const unemployment = 1 - employmentRate;
  const labourShortage = workers > 0 ? clamp(jobs / workers - 1, 0, 1) : 1;
  const jobPull = clamp(0.6 - 3 * unemployment + 0.4 * labourShortage, -1, 1);

  // Housing: +1 when homes are full (capacity <= pop), 0 at the exact growth
  // budget ceiling (housingTarget), and negative when overbuilt.
  const wantedHousing = housingTarget(pop);
  const housingPull = clamp((wantedHousing - housingCapacity) / (wantedHousing - pop), -1, 1);

  // Mood: below DEMAND_UNHAPPY_BELOW the city's reputation drags demand down.
  const moodPenalty = Math.max(0, (DEMAND_UNHAPPY_BELOW - state.resources.happiness) / DEMAND_UNHAPPY_BELOW);

  const wanted = jobTargets(workers);

  return {
    residential: clamp(Math.min(jobPull, housingPull) - moodPenalty, -1, 1),
    commercial: clamp(1 - commercialJobs / wanted.commercial, -1, 1),
    industrial: clamp(1 - industrialJobs / wanted.industrial, -1, 1),
  };
}

function smoothDemand(current: number, target: number): number {
  // Keep demand sign aligned with the target so the meter never reports
  // positive demand after the growth budget is exhausted (or stalls negative
  // once new demand appears).
  if ((target <= 0 && current > 0) || (target > 0 && current <= 0)) {
    return target * DEMAND_GROWTH_RATE;
  }
  return current + (target - current) * DEMAND_GROWTH_RATE;
}

export function calculateDemand(state: CityState): DemandState {
  const target = calculateDemandTargets(state);

  // Smooth toward target while keeping sign aligned with actual growth eligibility
  const current = state.resources.demand ?? { residential: 0.5, commercial: 0, industrial: 0.3 };
  return {
    residential: smoothDemand(current.residential, target.residential),
    commercial: smoothDemand(current.commercial, target.commercial),
    industrial: smoothDemand(current.industrial, target.industrial),
  };
}

/** Per-tick probability that an eligible zone tile develops, scaled by demand. */
export function getZoneGrowthChance(zoneDemand: number): number {
  if (zoneDemand <= MIN_DEMAND_TO_GROW) return 0;
  const clamped = clamp(zoneDemand, 0, 1);
  return ZONE_GROWTH_MIN_CHANCE + (ZONE_GROWTH_CHANCE - ZONE_GROWTH_MIN_CHANCE) * clamped;
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
 * for commercial and industrial. Without a per-tick budget a city with hundreds
 * of empty lots would develop all of them in a single tick and then pay upkeep
 * on buildings nobody uses.
 */
export function calculateGrowthBudget(state: CityState): DemandState {
  const { commercialJobs, industrialJobs, workers, housingCapacity } = calculateLaborStats(state);
  const pop = state.resources.population;
  const wanted = jobTargets(workers);

  return {
    residential: housingTarget(pop) - housingCapacity,
    commercial: wanted.commercial - commercialJobs,
    industrial: wanted.industrial - industrialJobs,
  };
}

export function processZoneGrowth(state: CityState): ZoneGrowthResult {
  const demand = state.resources.demand;
  const result: ZoneGrowthResult = { upgradedBuildings: [] };
  const currentTick = state.tick;
  const budget = calculateGrowthBudget(state);
  const count = state.buildings.length;
  const utilities = evaluateCityUtilities(state);

  // Start at a different building each tick so the budget isn't always spent on the oldest zones
  for (let i = 0; i < count; i++) {
    const building = state.buildings[(i + currentTick) % count];
    if (!isZone(building.type)) continue;

    const level = building.developmentLevel ?? 0;
    if (level >= 3) continue;

    // Check if demand is positive for this zone type
    let zoneDemand = 0;
    let kind: keyof DemandState = 'residential';
    if (building.type === BuildingType.ZONE_RESIDENTIAL) { zoneDemand = demand.residential; kind = 'residential'; }
    if (building.type === BuildingType.ZONE_COMMERCIAL) { zoneDemand = demand.commercial; kind = 'commercial'; }
    if (building.type === BuildingType.ZONE_INDUSTRIAL) { zoneDemand = demand.industrial; kind = 'industrial'; }

    if (zoneDemand <= MIN_DEMAND_TO_GROW) continue;
    if (budget[kind] <= 0) continue;

    // Bigger buildings only go up in a city people actually like living in
    if (state.resources.happiness < getZoneLevelHappinessRequirement(level + 1)) continue;

    // Utility dependencies:
    // - Upgrading to Level 2 requires active Electricity + Water
    // - Upgrading to Level 3 requires active Electricity + Water + Sewage
    // - Initial Level 1 pioneer buildings can still rise off-grid, but slower than serviced lots
    let utilityChanceFactor = 1;
    if (level >= 1) {
      const bStatus = utilities.buildings.get(building.id);
      if (!bStatus || !bStatus.powered || !bStatus.watered) continue;
      if (level >= 2 && !bStatus.drained) continue;
    } else {
      const cov = getCellUtilityCoverage(utilities, building.position.x, building.position.z);
      utilityChanceFactor = cov.power && cov.water ? 1.0 : (cov.power || cov.water ? 0.8 : 0.6);
    }

    // Check time requirement (now using game ticks instead of Date.now())
    const nextLevelDef = getZoneLevelDef(building.type as ZoneType, building.density, level + 1);
    const ticksRequired = nextLevelDef.ticksRequired;
    const referenceTime = building.developedAt ?? building.placedAt;
    const ticksSinceLast = currentTick - referenceTime;

    if (ticksSinceLast < ticksRequired) continue;

    // Random chance scaled monotonically by demand and utility readiness
    if (Math.random() < getZoneGrowthChance(zoneDemand) * utilityChanceFactor) {
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

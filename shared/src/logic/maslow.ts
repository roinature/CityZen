import type { CityState } from '../types/city.js';
import type { MaslowContribution } from '../types/building.js';
import { MaslowNeed, MASLOW_NEEDS_ORDERED, LifeStage } from '../types/person.js';
import { BUILDING_DEFS } from '../constants/buildings.js';
import { isZone } from '../types/building.js';
import {
  SERVICE_BASE_SATISFACTION, SERVICE_QUALITY_FACTOR,
  SMALL_TOWN_SATISFACTION, SMALL_TOWN_POPULATION, SMALL_TOWN_FADE_POPULATION,
} from '../constants/simulation.js';

// ── City Maslow Capacity ────────────────────────────────────

/** Per-need capacity summary from city infrastructure. */
export interface CityMaslowCapacity {
  totalValue: number;      // Sum of all building values for this need
  totalCapacity: number;   // Sum of all capacityServed for this need
  /** Every building serving this need: how good it is and how many people it reaches. */
  providers: Array<{ value: number; capacity: number }>;
}

export type CityMaslowProfile = Record<MaslowNeed, CityMaslowCapacity>;

/** Sum maslowContributions across all buildings in the city. */
export function calculateCityMaslowCapacity(state: CityState): CityMaslowProfile {
  const profile = {} as CityMaslowProfile;
  for (const need of MASLOW_NEEDS_ORDERED) {
    profile[need] = { totalValue: 0, totalCapacity: 0, providers: [] };
  }

  for (const building of state.buildings) {
    // Skip undeveloped zones — only infra buildings contribute
    if (isZone(building.type)) continue;

    const def = BUILDING_DEFS[building.type];
    const contributions = def?.effects?.maslowContributions;
    if (!contributions) continue;

    for (const mc of contributions) {
      profile[mc.need].totalValue += mc.value;
      profile[mc.need].totalCapacity += mc.capacityServed;
      profile[mc.need].providers.push({ value: mc.value, capacity: mc.capacityServed });
    }
  }

  return profile;
}

// ── Life Stage Maslow Weights ───────────────────────────────

/**
 * Life stage weights modify how much each age group benefits from
 * city infrastructure per Maslow need.
 * > 1.0 = this group benefits more (and suffers more from lack)
 * < 1.0 = this group needs less of this
 */
export const LIFE_STAGE_MASLOW_WEIGHTS: Record<LifeStage, Record<MaslowNeed, number>> = {
  [LifeStage.CHILD]: {
    [MaslowNeed.PHYSIOLOGICAL]: 1.2,
    [MaslowNeed.SAFETY]: 1.5,
    [MaslowNeed.LOVE_BELONGING]: 1.3,
    [MaslowNeed.ESTEEM]: 0.5,
    [MaslowNeed.COGNITIVE]: 2.0,      // Children need schools most
    [MaslowNeed.AESTHETIC]: 0.7,
    [MaslowNeed.SELF_ACTUALIZATION]: 0.3,
  },
  [LifeStage.TEEN]: {
    [MaslowNeed.PHYSIOLOGICAL]: 1.0,
    [MaslowNeed.SAFETY]: 1.2,
    [MaslowNeed.LOVE_BELONGING]: 1.3,
    [MaslowNeed.ESTEEM]: 1.2,
    [MaslowNeed.COGNITIVE]: 1.5,      // Teens still need education
    [MaslowNeed.AESTHETIC]: 1.0,
    [MaslowNeed.SELF_ACTUALIZATION]: 0.5,
  },
  [LifeStage.YOUNG_ADULT]: {
    [MaslowNeed.PHYSIOLOGICAL]: 1.0,
    [MaslowNeed.SAFETY]: 1.0,
    [MaslowNeed.LOVE_BELONGING]: 1.2,
    [MaslowNeed.ESTEEM]: 1.3,
    [MaslowNeed.COGNITIVE]: 1.0,
    [MaslowNeed.AESTHETIC]: 1.1,
    [MaslowNeed.SELF_ACTUALIZATION]: 1.0,
  },
  [LifeStage.ADULT]: {
    [MaslowNeed.PHYSIOLOGICAL]: 1.0,
    [MaslowNeed.SAFETY]: 1.0,
    [MaslowNeed.LOVE_BELONGING]: 1.0,
    [MaslowNeed.ESTEEM]: 1.0,
    [MaslowNeed.COGNITIVE]: 1.0,
    [MaslowNeed.AESTHETIC]: 1.0,
    [MaslowNeed.SELF_ACTUALIZATION]: 1.0,
  },
  [LifeStage.ELDER]: {
    [MaslowNeed.PHYSIOLOGICAL]: 1.3,  // Elders need more health services
    [MaslowNeed.SAFETY]: 1.3,
    [MaslowNeed.LOVE_BELONGING]: 1.1,
    [MaslowNeed.ESTEEM]: 0.8,
    [MaslowNeed.COGNITIVE]: 0.7,
    [MaslowNeed.AESTHETIC]: 1.2,
    [MaslowNeed.SELF_ACTUALIZATION]: 1.2,
  },
};

// ── Target Satisfaction Calculation ─────────────────────────

/** Satisfaction (0–100) of someone served by a building of the given quality. */
export function getServiceSatisfaction(value: number): number {
  return Math.min(100, SERVICE_BASE_SATISFACTION + SERVICE_QUALITY_FACTOR * value);
}

/** What every need sits at in a town too small to expect real services (fades with size). */
export function getSmallTownSatisfaction(population: number): number {
  const fade = (SMALL_TOWN_FADE_POPULATION - population) / (SMALL_TOWN_FADE_POPULATION - SMALL_TOWN_POPULATION);
  return SMALL_TOWN_SATISFACTION * Math.max(0, Math.min(1, fade));
}

/**
 * Calculate the base target satisfaction (0–100) for each Maslow need,
 * given the city's infrastructure profile and population count.
 *
 * Per need, residents are served by the best buildings first, each up to its
 * capacity. Someone served gets that building's satisfaction (see
 * getServiceSatisfaction); someone left without service gets 0. The target is
 * the average across the population, so coverage and quality both matter and
 * it no longer takes a dozen buildings to satisfy a village.
 * Small towns never drop below getSmallTownSatisfaction.
 */
export function calculateBaseMaslowTargets(
  profile: CityMaslowProfile,
  population: number,
): Record<MaslowNeed, number> {
  const targets = {} as Record<MaslowNeed, number>;
  const floor = getSmallTownSatisfaction(population);

  for (const need of MASLOW_NEEDS_ORDERED) {
    if (population <= 0) {
      targets[need] = floor;
      continue;
    }

    const providers = [...profile[need].providers].sort((a, b) => b.value - a.value);
    let unserved = population;
    let total = 0;
    for (const provider of providers) {
      if (unserved <= 0) break;
      const served = Math.min(provider.capacity, unserved);
      total += served * getServiceSatisfaction(provider.value);
      unserved -= served;
    }

    targets[need] = Math.max(floor, total / population);
  }

  return targets;
}

/**
 * Adjust the base targets for a specific life stage.
 * Returns per-need target satisfaction for a person of this life stage.
 */
export function adjustTargetsForLifeStage(
  baseTargets: Record<MaslowNeed, number>,
  lifeStage: LifeStage,
): Record<MaslowNeed, number> {
  const weights = LIFE_STAGE_MASLOW_WEIGHTS[lifeStage];
  const adjusted = {} as Record<MaslowNeed, number>;

  for (const need of MASLOW_NEEDS_ORDERED) {
    adjusted[need] = Math.min(baseTargets[need] * weights[need], 100);
  }

  return adjusted;
}

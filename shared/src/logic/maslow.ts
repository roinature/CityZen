import type { CityState } from '../types/city.js';
import type { MaslowContribution } from '../types/building.js';
import { MaslowNeed, MASLOW_NEEDS_ORDERED, LifeStage } from '../types/person.js';
import { BUILDING_DEFS } from '../constants/buildings.js';
import { isZone } from '../types/building.js';

// ── City Maslow Capacity ────────────────────────────────────

/** Per-need capacity summary from city infrastructure. */
export interface CityMaslowCapacity {
  totalValue: number;      // Sum of all building values for this need
  totalCapacity: number;   // Sum of all capacityServed for this need
}

export type CityMaslowProfile = Record<MaslowNeed, CityMaslowCapacity>;

/** Sum maslowContributions across all buildings in the city. */
export function calculateCityMaslowCapacity(state: CityState): CityMaslowProfile {
  const profile = {} as CityMaslowProfile;
  for (const need of MASLOW_NEEDS_ORDERED) {
    profile[need] = { totalValue: 0, totalCapacity: 0 };
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

/**
 * Calculate the base target satisfaction (0–100) for each Maslow need,
 * given the city's infrastructure profile and population count.
 *
 * Formula per need:
 *   coverageRatio = min(totalCapacity / population, 1.0)
 *   targetSatisfaction = min(totalValue × coverageRatio, 100)
 */
export function calculateBaseMaslowTargets(
  profile: CityMaslowProfile,
  population: number,
): Record<MaslowNeed, number> {
  const targets = {} as Record<MaslowNeed, number>;

  for (const need of MASLOW_NEEDS_ORDERED) {
    const { totalValue, totalCapacity } = profile[need];
    if (population === 0 || totalCapacity === 0) {
      targets[need] = 0;
      continue;
    }
    const coverageRatio = Math.min(totalCapacity / population, 1.0);
    targets[need] = Math.min(totalValue * coverageRatio, 100);
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

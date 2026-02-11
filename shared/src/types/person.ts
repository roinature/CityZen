// ── Life Stages ──────────────────────────────────────────────

export enum LifeStage {
  CHILD = 'child',
  TEEN = 'teen',
  YOUNG_ADULT = 'young_adult',
  ADULT = 'adult',
  ELDER = 'elder',
}

export const LIFE_STAGE_AGE_RANGES: Record<LifeStage, { min: number; max: number }> = {
  [LifeStage.CHILD]: { min: 0, max: 12 },
  [LifeStage.TEEN]: { min: 13, max: 17 },
  [LifeStage.YOUNG_ADULT]: { min: 18, max: 25 },
  [LifeStage.ADULT]: { min: 26, max: 59 },
  [LifeStage.ELDER]: { min: 60, max: Infinity },
};

export function getLifeStage(age: number): LifeStage {
  if (age <= 12) return LifeStage.CHILD;
  if (age <= 17) return LifeStage.TEEN;
  if (age <= 25) return LifeStage.YOUNG_ADULT;
  if (age <= 59) return LifeStage.ADULT;
  return LifeStage.ELDER;
}

// ── Maslow Hierarchy of Needs ────────────────────────────────

export enum MaslowNeed {
  PHYSIOLOGICAL = 'physiological',
  SAFETY = 'safety',
  LOVE_BELONGING = 'love_belonging',
  ESTEEM = 'esteem',
  COGNITIVE = 'cognitive',
  AESTHETIC = 'aesthetic',
  SELF_ACTUALIZATION = 'self_actualization',
}

export const MASLOW_NEEDS_ORDERED: MaslowNeed[] = [
  MaslowNeed.PHYSIOLOGICAL,
  MaslowNeed.SAFETY,
  MaslowNeed.LOVE_BELONGING,
  MaslowNeed.ESTEEM,
  MaslowNeed.COGNITIVE,
  MaslowNeed.AESTHETIC,
  MaslowNeed.SELF_ACTUALIZATION,
];

export type MaslowState = Record<MaslowNeed, number>;

// Lower needs weigh more — this is the core of the hierarchy rule
const MASLOW_WEIGHTS: Record<MaslowNeed, number> = {
  [MaslowNeed.PHYSIOLOGICAL]: 3.0,
  [MaslowNeed.SAFETY]: 2.5,
  [MaslowNeed.LOVE_BELONGING]: 2.0,
  [MaslowNeed.ESTEEM]: 1.5,
  [MaslowNeed.COGNITIVE]: 1.0,
  [MaslowNeed.AESTHETIC]: 0.8,
  [MaslowNeed.SELF_ACTUALIZATION]: 0.5,
};

export function createDefaultMaslow(): MaslowState {
  return {
    [MaslowNeed.PHYSIOLOGICAL]: 50,
    [MaslowNeed.SAFETY]: 50,
    [MaslowNeed.LOVE_BELONGING]: 50,
    [MaslowNeed.ESTEEM]: 50,
    [MaslowNeed.COGNITIVE]: 50,
    [MaslowNeed.AESTHETIC]: 50,
    [MaslowNeed.SELF_ACTUALIZATION]: 50,
  };
}

/**
 * Calculate a person's overall happiness from their 7 Maslow satisfaction values.
 * Uses weighted average where lower-level needs dominate.
 * Additionally applies a penalty multiplier: if a lower need is critically unmet,
 * everything above it is dampened.
 */
export function getPersonHappiness(maslow: MaslowState): number {
  let totalWeight = 0;
  let totalScore = 0;

  // Cascading penalty: if a lower need is below 30%, needs above it are dampened
  let cascadeMultiplier = 1.0;

  for (const need of MASLOW_NEEDS_ORDERED) {
    const satisfaction = maslow[need];
    const weight = MASLOW_WEIGHTS[need] * cascadeMultiplier;

    totalWeight += weight;
    totalScore += satisfaction * weight;

    // If this need is critically unmet, dampen everything above
    if (satisfaction < 30) {
      cascadeMultiplier *= satisfaction / 30; // e.g. satisfaction=15 → multiplier *= 0.5
    }
  }

  return totalWeight > 0 ? totalScore / totalWeight : 50;
}

// ── Person Entity ────────────────────────────────────────────

export interface Person {
  id: string;
  age: number;
  cityId: string | null; // null = in world pool, not assigned to any city
  maslow: MaslowState;
  birthTick: number;
}

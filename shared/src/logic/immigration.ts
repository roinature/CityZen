import {
  IMMIGRATION_RATE,
  IMMIGRATION_MAX_PER_TICK,
  IMMIGRATION_MIN_ATTRACTIVENESS,
  EMIGRATION_HAPPINESS_THRESHOLD,
  EMIGRATION_MAX_RATE,
} from '../constants/simulation.js';

/**
 * How many people move from the unassigned world pool into a city this tick.
 *
 * Vacant housing pulls people in; happier cities fill up faster. The result is
 * capped by the vacancies, the pool size and a per-tick maximum so growth is
 * visible but gradual.
 */
export function calculateImmigrationCount(
  freeHousing: number,
  averageHappiness: number,
  poolSize: number,
): number {
  if (freeHousing <= 0 || poolSize <= 0) return 0;
  // Nobody moves to a city its own residents are fleeing (see calculateEmigrationCount)
  if (averageHappiness < EMIGRATION_HAPPINESS_THRESHOLD) return 0;

  const happiness = Math.max(0, Math.min(100, averageHappiness)) / 100;
  const attractiveness =
    IMMIGRATION_MIN_ATTRACTIVENESS + (1 - IMMIGRATION_MIN_ATTRACTIVENESS) * happiness;
  const wanted = Math.ceil(freeHousing * IMMIGRATION_RATE * attractiveness);

  return Math.min(wanted, IMMIGRATION_MAX_PER_TICK, freeHousing, poolSize);
}

/**
 * How many residents give up on a city this game day and return to the world pool.
 *
 * Nobody leaves while happiness is at or above EMIGRATION_HAPPINESS_THRESHOLD.
 * Below it the outflow scales with how bad things are, up to EMIGRATION_MAX_RATE
 * of the population per day.
 */
export function calculateEmigrationCount(population: number, averageHappiness: number): number {
  if (population <= 0 || averageHappiness >= EMIGRATION_HAPPINESS_THRESHOLD) return 0;

  const misery = (EMIGRATION_HAPPINESS_THRESHOLD - Math.max(0, averageHappiness)) / EMIGRATION_HAPPINESS_THRESHOLD;
  return Math.min(population, Math.ceil(population * EMIGRATION_MAX_RATE * misery));
}

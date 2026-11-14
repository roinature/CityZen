import {
  IMMIGRATION_RATE,
  IMMIGRATION_MAX_PER_TICK,
  IMMIGRATION_MIN_ATTRACTIVENESS,
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

  const happiness = Math.max(0, Math.min(100, averageHappiness)) / 100;
  const attractiveness =
    IMMIGRATION_MIN_ATTRACTIVENESS + (1 - IMMIGRATION_MIN_ATTRACTIVENESS) * happiness;
  const wanted = Math.ceil(freeHousing * IMMIGRATION_RATE * attractiveness);

  return Math.min(wanted, IMMIGRATION_MAX_PER_TICK, freeHousing, poolSize);
}

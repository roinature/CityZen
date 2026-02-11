import { BIRTH_RATE_PER_YEAR } from '../constants/simulation.js';

/**
 * Calculate the expected number of births for a city in one game year.
 * Returns a float — caller should floor + random-check the fractional part.
 */
export function calculateBirthCount(
  fertileCount: number,
  loveBelongingSatisfaction: number,
  housingCapacity: number,
  currentPopulation: number,
): number {
  if (fertileCount === 0) return 0;
  if (housingCapacity <= currentPopulation) return 0;

  // Love/Belonging scales birth rate: 0 satisfaction → 0.5x, 100 → 2x
  const loveMultiplier = 0.5 + (loveBelongingSatisfaction / 100) * 1.5;

  // Available housing room dampens births as city fills up
  const housingRoom = Math.max(0, (housingCapacity - currentPopulation) / housingCapacity);

  return fertileCount * BIRTH_RATE_PER_YEAR * loveMultiplier * housingRoom;
}

import type { Person } from '../types/person.js';
import { MaslowNeed } from '../types/person.js';
import {
  ELDER_MORTALITY_BASE_AGE,
  ELDER_MORTALITY_RATE_PER_YEAR,
  MAX_PERSON_AGE,
  LOW_PHYSIO_DEATH_MULTIPLIER,
} from '../constants/simulation.js';

/**
 * Determine if a person should die this game year.
 * Returns the annual probability of death (0–1). Caller rolls random.
 */
export function getDeathProbability(person: Person): number {
  if (person.age >= MAX_PERSON_AGE) return 1;
  if (person.age < ELDER_MORTALITY_BASE_AGE) {
    // Young people only die from extremely low physiological needs
    const physio = person.maslow[MaslowNeed.PHYSIOLOGICAL];
    if (physio < 10) return 0.02 * (1 - physio / 10); // up to 2% at 0 physiological
    return 0;
  }

  // Elder mortality: increases 1% per year over base age
  const yearsOver = person.age - ELDER_MORTALITY_BASE_AGE + 1;
  let probability = yearsOver * ELDER_MORTALITY_RATE_PER_YEAR;

  // Low physiological satisfaction increases death rate
  const physio = person.maslow[MaslowNeed.PHYSIOLOGICAL];
  if (physio < 30) {
    const physioMultiplier = 1 + ((30 - physio) / 30) * (LOW_PHYSIO_DEATH_MULTIPLIER - 1);
    probability *= physioMultiplier;
  }

  return Math.min(probability, 1);
}

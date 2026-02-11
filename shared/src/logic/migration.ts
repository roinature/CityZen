import type { Person } from '../types/person.js';
import type { WorldCityEntry } from '../types/world.js';
import { getPersonHappiness } from '../types/person.js';
import { findMatchingConnections } from './edgeConnections.js';
import {
  MIGRATION_HAPPINESS_THRESHOLD,
  MIGRATION_HAPPINESS_DELTA,
  MIGRATION_MAX_RATE,
} from '../constants/simulation.js';

export interface MigrationCandidate {
  personId: string;
  fromCityId: string;
  toCityId: string;
}

/**
 * Find all cities that share matching road connections with the given city.
 */
export function findConnectedCities(
  city: WorldCityEntry,
  allCities: WorldCityEntry[],
): WorldCityEntry[] {
  const connected: WorldCityEntry[] = [];

  for (const other of allCities) {
    if (other.cityId === city.cityId) continue;
    const match = findMatchingConnections(city, other);
    if (match) {
      connected.push(other);
    }
  }

  return connected;
}

/**
 * Evaluate which people in a city should migrate to a connected city.
 *
 * Rules:
 * - Only persons with happiness below MIGRATION_HAPPINESS_THRESHOLD consider leaving
 * - They migrate to the connected city with the highest happiness,
 *   but only if that city's happiness exceeds their own by MIGRATION_HAPPINESS_DELTA
 * - Max MIGRATION_MAX_RATE (5%) of the city population can leave per evaluation
 * - Isolated cities (no connections) → no migration
 */
export function evaluateMigration(
  cityEntry: WorldCityEntry,
  persons: Person[],
  connectedCities: WorldCityEntry[],
): MigrationCandidate[] {
  if (connectedCities.length === 0 || persons.length === 0) return [];

  // Find the best connected city by happiness
  let bestCity: WorldCityEntry | null = null;
  for (const c of connectedCities) {
    if (!bestCity || c.happiness > bestCity.happiness) {
      bestCity = c;
    }
  }
  if (!bestCity) return [];

  // Cap the number of migrants
  const maxMigrants = Math.max(1, Math.ceil(persons.length * MIGRATION_MAX_RATE));

  const candidates: MigrationCandidate[] = [];

  for (const person of persons) {
    if (candidates.length >= maxMigrants) break;

    const happiness = getPersonHappiness(person.maslow);
    if (happiness >= MIGRATION_HAPPINESS_THRESHOLD) continue;

    // Would this person be better off? Compare their happiness with the best city's average
    if (bestCity.happiness - happiness >= MIGRATION_HAPPINESS_DELTA) {
      candidates.push({
        personId: person.id,
        fromCityId: cityEntry.cityId,
        toCityId: bestCity.cityId,
      });
    }
  }

  return candidates;
}

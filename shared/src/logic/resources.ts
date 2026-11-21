import type { CityState } from '../types/city.js';
import { BUILDING_DEFS, getZoneLevelDef } from '../constants/buildings.js';
import { isZone, type ZoneType } from '../types/building.js';
import {
  TAX_PER_PERSON, TAX_PER_PERSON_FALLBACK, DEFICIT_MASLOW_PENALTY_RATE, MIN_BUDGET_MULTIPLIER,
  TAX_COMFORT_RATE, TAX_MASLOW_PENALTY_PER_POINT,
  UNEMPLOYED_INCOME_SHARE, BUSINESS_INCOME_PER_JOB,
} from '../constants/economy.js';
import { LifeStage } from '../types/person.js';
import { calculateLaborStats } from './labor.js';

export interface TaxBreakdown {
  /** Income tax paid by residents. */
  residents: number;
  /** Tax paid by shops and factories, per filled job. */
  businesses: number;
  total: number;
}

/**
 * Where the tax money comes from this tick.
 *
 * Residents pay on their income, which drops when they can't find work.
 * Businesses pay per filled job, so commercial and industrial zones earn
 * money directly once they have staff.
 */
export function calculateTaxBreakdown(state: CityState): TaxBreakdown {
  const rate = state.resources.taxRate / 100;
  const { employed, employmentRate } = calculateLaborStats(state);
  const incomeFactor = UNEMPLOYED_INCOME_SHARE + (1 - UNEMPLOYED_INCOME_SHARE) * employmentRate;

  const summary = state.resources.populationSummary;
  const residentIncome = summary
    ? (summary.youngAdults * TAX_PER_PERSON[LifeStage.YOUNG_ADULT] +
        summary.adults * TAX_PER_PERSON[LifeStage.ADULT]) * incomeFactor +
      summary.elders * TAX_PER_PERSON[LifeStage.ELDER]
    : state.resources.population * TAX_PER_PERSON_FALLBACK * incomeFactor;

  const residents = residentIncome * rate;
  const businesses = employed * BUSINESS_INCOME_PER_JOB * rate;
  return { residents, businesses, total: Math.floor(residents + businesses) };
}

export function calculateTaxRevenue(state: CityState): number {
  return calculateTaxBreakdown(state).total;
}

/**
 * Calculate budget penalty multiplier (0.5–1.0).
 * When money hits 0, infrastructure starts degrading.
 * Deeper deficit = lower multiplier = lower Maslow targets.
 */
export function calculateBudgetPenalty(money: number): number {
  if (money > 0) return 1.0;
  const deficit = Math.abs(money);
  const multiplier = 1.0 - deficit * DEFICIT_MASLOW_PENALTY_RATE;
  return Math.max(multiplier, MIN_BUDGET_MULTIPLIER);
}

/**
 * Tax penalty multiplier (0.55–1.0) applied to Maslow targets.
 * Taxes at or below the comfort rate are free; above it citizens get unhappier.
 */
export function calculateTaxPenalty(taxRate: number): number {
  const excess = Math.max(0, taxRate - TAX_COMFORT_RATE);
  return 1.0 - excess * TAX_MASLOW_PENALTY_PER_POINT;
}

export function calculateMaintenance(state: CityState): number {
  // Road upkeep is fractional per tile; the city is billed in whole dollars.
  return Math.round(state.buildings.reduce((sum, b) => {
    const def = BUILDING_DEFS[b.type];
    let maint = def?.effects?.maintenance ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
      maint += levelDef.maintenance;
    }

    return sum + maint;
  }, 0));
}

export function calculateNetIncome(state: CityState): number {
  return calculateTaxRevenue(state) - calculateMaintenance(state);
}

export function calculatePopulationGrowth(state: CityState): number {
  // When population is managed by PopulationManager (person entities exist),
  // growth is driven by births/deaths/migration — return 0 to avoid double-counting.
  if (state.resources.populationSummary) return 0;

  // Legacy fallback for cities without person entities
  let capacity = 0;
  let jobs = 0;

  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    capacity += def?.effects?.populationCapacity ?? 0;
    jobs += def?.effects?.jobs ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
      capacity += levelDef.populationCapacity;
      jobs += levelDef.jobs;
    }
  }

  if (state.resources.population >= capacity) return 0;
  if (state.resources.happiness < 30) return -1;
  if (jobs < state.resources.population * 0.5) return 0;

  return Math.min(5, capacity - state.resources.population);
}

export function calculateHappiness(state: CityState): number {
  // When population summary exists, use Maslow-based average happiness
  if (state.resources.populationSummary) {
    return state.resources.populationSummary.averageHappiness;
  }

  // Legacy fallback: building effects + penalties
  const base = 50;

  let buildingEffect = 0;
  let capacity = 0;

  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    buildingEffect += def?.effects?.happiness ?? 0;
    capacity += def?.effects?.populationCapacity ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
      buildingEffect += levelDef.happiness;
      capacity += levelDef.populationCapacity;
    }
  }

  const overcrowdingPenalty = capacity > 0 && state.resources.population > capacity
    ? Math.floor((state.resources.population - capacity) / 5) * -2
    : 0;

  const taxPenalty = state.resources.taxRate > 10
    ? -Math.floor((state.resources.taxRate - 10) / 2)
    : 0;

  return base + buildingEffect + overcrowdingPenalty + taxPenalty;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateHousingCapacity(state: CityState): number {
  let capacity = 0;
  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    capacity += def?.effects?.populationCapacity ?? 0;
    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
      capacity += levelDef.populationCapacity;
    }
  }
  return capacity;
}

export function calculateCityScore(state: CityState): number {
  // Simple score formula: Population + (Money/100) + (Happiness * 10)
  // This provides a growth metric based on overall city health and size
  const popScore = state.resources.population;
  const moneyScore = Math.floor(state.resources.money / 100);
  const happinessScore = state.resources.happiness * 10;

  return popScore + moneyScore + happinessScore;
}

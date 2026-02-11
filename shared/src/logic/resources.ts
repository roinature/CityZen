import type { CityState } from '../types/city.js';
import { BUILDING_DEFS, getZoneLevelDef } from '../constants/buildings.js';
import { isZone, type ZoneType } from '../types/building.js';
import { TAX_PER_PERSON, DEFICIT_MASLOW_PENALTY_RATE, MIN_BUDGET_MULTIPLIER } from '../constants/economy.js';
import { LifeStage } from '../types/person.js';

export function calculateTaxRevenue(state: CityState): number {
  const summary = state.resources.populationSummary;
  if (summary) {
    // Demographic-based tax: each life stage contributes differently
    const taxableIncome =
      summary.children * TAX_PER_PERSON[LifeStage.CHILD] +
      summary.teens * TAX_PER_PERSON[LifeStage.TEEN] +
      summary.youngAdults * TAX_PER_PERSON[LifeStage.YOUNG_ADULT] +
      summary.adults * TAX_PER_PERSON[LifeStage.ADULT] +
      summary.elders * TAX_PER_PERSON[LifeStage.ELDER];
    return Math.floor(taxableIncome * (state.resources.taxRate / 100));
  }

  // Legacy fallback
  return Math.floor(state.resources.population * (state.resources.taxRate / 100));
}

/**
 * Calculate budget penalty multiplier (0.2–1.0).
 * When money hits 0, infrastructure starts degrading.
 * Deeper deficit = lower multiplier = lower Maslow targets.
 */
export function calculateBudgetPenalty(money: number): number {
  if (money > 0) return 1.0;
  const deficit = Math.abs(money);
  const multiplier = 1.0 - deficit * DEFICIT_MASLOW_PENALTY_RATE;
  return Math.max(multiplier, MIN_BUDGET_MULTIPLIER);
}

export function calculateMaintenance(state: CityState): number {
  return state.buildings.reduce((sum, b) => {
    const def = BUILDING_DEFS[b.type];
    let maint = def?.effects?.maintenance ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = getZoneLevelDef(b.type as ZoneType, b.density, b.developmentLevel!);
      maint += levelDef.maintenance;
    }

    return sum + maint;
  }, 0);
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

import type { CityState } from '../types/city.js';
import { BUILDING_DEFS } from '../constants/buildings.js';
import { ZONE_LEVELS } from '../constants/buildings.js';
import { isZone, type ZoneType } from '../types/building.js';

export function calculateTaxRevenue(state: CityState): number {
  return Math.floor(state.resources.population * (state.resources.taxRate / 100));
}

export function calculateMaintenance(state: CityState): number {
  return state.buildings.reduce((sum, b) => {
    const def = BUILDING_DEFS[b.type];
    let maint = def.effects.maintenance ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = ZONE_LEVELS[b.type as ZoneType][b.developmentLevel - 1];
      maint += levelDef.maintenance;
    }

    return sum + maint;
  }, 0);
}

export function calculateNetIncome(state: CityState): number {
  return calculateTaxRevenue(state) - calculateMaintenance(state);
}

export function calculatePopulationGrowth(state: CityState): number {
  let capacity = 0;
  let jobs = 0;

  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    capacity += def.effects.populationCapacity ?? 0;
    jobs += def.effects.jobs ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = ZONE_LEVELS[b.type as ZoneType][b.developmentLevel - 1];
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
  const base = 50;

  let buildingEffect = 0;
  let capacity = 0;

  for (const b of state.buildings) {
    const def = BUILDING_DEFS[b.type];
    buildingEffect += def.effects.happiness ?? 0;
    capacity += def.effects.populationCapacity ?? 0;

    if (isZone(b.type) && b.developmentLevel && b.developmentLevel > 0) {
      const levelDef = ZONE_LEVELS[b.type as ZoneType][b.developmentLevel - 1];
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

export function calculateCityScore(state: CityState): number {
  // Simple score formula: Population + (Money/100) + (Happiness * 10)
  // This provides a growth metric based on overall city health and size
  const popScore = state.resources.population;
  const moneyScore = Math.floor(state.resources.money / 100);
  const happinessScore = state.resources.happiness * 10;

  return popScore + moneyScore + happinessScore;
}

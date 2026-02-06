import type { CityState } from '../types/city.js';
import { BUILDING_DEFS } from '../constants/buildings.js';

export function calculateIncome(state: CityState): number {
  return state.buildings.reduce((sum, b) => {
    const def = BUILDING_DEFS[b.type];
    return sum + (def.effects.income ?? 0);
  }, 0);
}

export function calculatePopulationGrowth(state: CityState): number {
  const capacity = state.buildings.reduce((sum, b) => {
    return sum + (BUILDING_DEFS[b.type].effects.populationCapacity ?? 0);
  }, 0);

  const jobs = state.buildings.reduce((sum, b) => {
    return sum + (BUILDING_DEFS[b.type].effects.jobs ?? 0);
  }, 0);

  if (state.resources.population >= capacity) return 0;
  if (state.resources.happiness < 30) return -1;
  if (jobs < state.resources.population * 0.5) return 0;

  return Math.min(5, capacity - state.resources.population);
}

export function calculateHappiness(state: CityState): number {
  const base = 50;
  const buildingEffect = state.buildings.reduce((sum, b) => {
    return sum + (BUILDING_DEFS[b.type].effects.happiness ?? 0);
  }, 0);

  const capacity = state.buildings.reduce((sum, b) => {
    return sum + (BUILDING_DEFS[b.type].effects.populationCapacity ?? 0);
  }, 0);

  const overcrowdingPenalty = capacity > 0 && state.resources.population > capacity
    ? Math.floor((state.resources.population - capacity) / 5) * -2
    : 0;

  return base + buildingEffect + overcrowdingPenalty;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

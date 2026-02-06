import type { CityState } from '../types/city.js';
import { calculateIncome, calculatePopulationGrowth, calculateHappiness, clamp } from './resources.js';

export function simulateTick(state: CityState): CityState {
  const income = calculateIncome(state);
  const popGrowth = calculatePopulationGrowth(state);
  const happiness = calculateHappiness(state);

  return {
    ...state,
    resources: {
      money: Math.max(0, state.resources.money + income),
      population: Math.max(0, state.resources.population + popGrowth),
      happiness: clamp(happiness, 0, 100),
    },
    tick: state.tick + 1,
    updatedAt: Date.now(),
  };
}

import type { CityState } from '../types/city.js';
import { calculateNetIncome, calculatePopulationGrowth, calculateHappiness, clamp } from './resources.js';
import { calculateDemand, processZoneGrowth } from './demand.js';

export function simulateTick(state: CityState): CityState {
  // Update demand first
  const newDemand = calculateDemand(state);

  // Create a working copy with updated demand and shallow-copied buildings
  const working: CityState = {
    ...state,
    resources: { ...state.resources, demand: newDemand },
    buildings: state.buildings.map(b => ({ ...b })),
  };

  // Process zone growth (mutates building copies in place)
  processZoneGrowth(working);

  // Calculate resource changes based on updated state
  const netIncome = calculateNetIncome(working);
  const popGrowth = calculatePopulationGrowth(working);
  const happiness = calculateHappiness(working);

  return {
    ...working,
    resources: {
      ...working.resources,
      money: Math.max(0, working.resources.money + netIncome),
      population: Math.max(0, working.resources.population + popGrowth),
      happiness: clamp(happiness, 0, 100),
    },
    tick: state.tick + 1,
    updatedAt: Date.now(),
  };
}

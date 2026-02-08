import type { CityState } from '../types/city.js';
import { calculateNetIncome, calculatePopulationGrowth, calculateHappiness, clamp } from './resources.js';
import { calculateDemand, processZoneGrowth } from './demand.js';
import { GAME_MS_PER_TICK, TICKS_PER_GAME_DAY, DAYS_PER_GAME_YEAR } from '../constants/simulation.js';

export function advanceClock(state: CityState): CityState {
  const speed = state.clock.speed;
  const gameTimeMs = state.clock.gameTimeMs + GAME_MS_PER_TICK * speed;
  const totalDays = Math.floor(gameTimeMs / (GAME_MS_PER_TICK * TICKS_PER_GAME_DAY));
  return {
    ...state,
    clock: {
      ...state.clock,
      gameTimeMs,
      gameDay: totalDays % DAYS_PER_GAME_YEAR,
      gameYear: Math.floor(totalDays / DAYS_PER_GAME_YEAR) + 1,
    },
  };
}

export function simulateTick(state: CityState): CityState {
  // Advance game clock
  let working = advanceClock(state);

  // If paused, only advance clock but skip simulation
  if (state.clock.speed === 0) {
    return { ...working, tick: state.tick + 1, updatedAt: Date.now() };
  }

  // Update demand first
  const newDemand = calculateDemand(working);

  // Create a working copy with updated demand and shallow-copied buildings
  working = {
    ...working,
    resources: { ...working.resources, demand: newDemand },
    buildings: working.buildings.map(b => ({ ...b })),
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

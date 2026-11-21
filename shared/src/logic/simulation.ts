import type { CityState } from '../types/city.js';
import { calculateNetIncome, calculatePopulationGrowth, calculateHappiness, clamp } from './resources.js';
import { calculateDemand, processZoneGrowth } from './demand.js';
import { MAX_DEBT } from '../constants/economy.js';
import { applyLoanPayments } from './loans.js';
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

/**
 * Simulate one tick without advancing the clock.
 * Used by WorldTickEngine which owns the shared world clock.
 */
export function simulateCityTick(state: CityState): CityState {
  // If paused, skip simulation
  if (state.clock.speed === 0) {
    return { ...state, tick: state.tick + 1, updatedAt: Date.now() };
  }

  // Update demand first
  const newDemand = calculateDemand(state);

  // Create a working copy with updated demand and shallow-copied buildings
  const working = {
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

  // Loan instalments come out after the regular budget. They can't push the
  // treasury past the debt floor; whatever can't be paid stays on the loan.
  const moneyAfterBudget = working.resources.money + netIncome;
  const { loans, paid: loanPayments } = applyLoanPayments(
    working.resources.loans ?? [],
    moneyAfterBudget + MAX_DEBT,
  );

  return {
    ...working,
    resources: {
      ...working.resources,
      // Allow limited debt so a running deficit has consequences (see calculateBudgetPenalty)
      money: Math.max(-MAX_DEBT, moneyAfterBudget - loanPayments),
      loans,
      population: Math.max(0, working.resources.population + popGrowth),
      happiness: clamp(happiness, 0, 100),
    },
    tick: state.tick + 1,
    updatedAt: Date.now(),
  };
}

/**
 * Full tick: advance clock + simulate. Legacy entry point.
 */
export function simulateTick(state: CityState): CityState {
  return simulateCityTick(advanceClock(state));
}

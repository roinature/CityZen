import { LifeStage } from '../types/person.js';

/**
 * Taxable income per person per tick, by life stage (revenue = income × tax rate).
 * Sized so a working adult at the 10% comfort rate pays for roughly one tile of upkeep.
 * Children and teens don't contribute taxes.
 * Young adults contribute partially, adults fully, elders reduced.
 */
export const TAX_PER_PERSON: Record<LifeStage, number> = {
  [LifeStage.CHILD]: 0,
  [LifeStage.TEEN]: 0,
  [LifeStage.YOUNG_ADULT]: 8,
  [LifeStage.ADULT]: 10,
  [LifeStage.ELDER]: 3,
};

/**
 * Budget deficit penalty parameters.
 * When money drops to 0, infrastructure starts degrading (Maslow targets reduced).
 * Deeper deficit = worse penalty, creating a cascading failure spiral:
 * deficit → lower Maslow → lower happiness → migration → less tax → deeper deficit
 */
export const DEFICIT_MASLOW_PENALTY_RATE = 0.0005; // Per money unit of deficit, reduce Maslow multiplier
export const MIN_BUDGET_MULTIPLIER = 0.2;          // Maslow targets never go below 20% even in deep deficit

/**
 * The treasury may go this far into debt before it bottoms out. Without debt the
 * deficit penalty above could never trigger (money used to clamp at 0).
 * Construction is blocked while funds are below the building cost.
 */
export const MAX_DEBT = 2000;

/**
 * Tax happiness trade-off: rates above the comfort rate reduce every Maslow
 * target by this fraction per percentage point (25% tax → targets × 0.7).
 */
export const TAX_COMFORT_RATE = 10;
export const TAX_MASLOW_PENALTY_PER_POINT = 0.02;

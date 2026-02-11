import { LifeStage } from '../types/person.js';

/**
 * Tax revenue per person per tick, by life stage.
 * Children and teens don't contribute taxes.
 * Young adults contribute partially, adults fully, elders reduced.
 */
export const TAX_PER_PERSON: Record<LifeStage, number> = {
  [LifeStage.CHILD]: 0,
  [LifeStage.TEEN]: 0,
  [LifeStage.YOUNG_ADULT]: 0.8,
  [LifeStage.ADULT]: 1.0,
  [LifeStage.ELDER]: 0.3,
};

/**
 * Budget deficit penalty parameters.
 * When money drops to 0, infrastructure starts degrading (Maslow targets reduced).
 * Deeper deficit = worse penalty, creating a cascading failure spiral:
 * deficit → lower Maslow → lower happiness → migration → less tax → deeper deficit
 */
export const DEFICIT_MASLOW_PENALTY_RATE = 0.0005; // Per money unit of deficit, reduce Maslow multiplier
export const MIN_BUDGET_MULTIPLIER = 0.2;          // Maslow targets never go below 20% even in deep deficit

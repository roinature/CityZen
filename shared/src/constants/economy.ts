import { LifeStage } from '../types/person.js';

/**
 * Taxable income per person per tick, by life stage (revenue = income × tax rate).
 * Children and teens don't contribute taxes.
 * Young adults contribute partially, adults fully, elders reduced.
 * Working-age income shrinks with unemployment (see UNEMPLOYED_INCOME_SHARE).
 */
export const TAX_PER_PERSON: Record<LifeStage, number> = {
  [LifeStage.CHILD]: 0,
  [LifeStage.TEEN]: 0,
  [LifeStage.YOUNG_ADULT]: 7,
  [LifeStage.ADULT]: 9,
  [LifeStage.ELDER]: 3,
};

/** Taxable income of a city without demographic data (legacy cities), per resident. */
export const TAX_PER_PERSON_FALLBACK = 5.75;

/** Share of working-age residents who want a job. */
export const WORKFORCE_PARTICIPATION = 0.85;
/** Workers per resident when a city has no demographic data yet. */
export const WORKFORCE_SHARE_FALLBACK = 0.55;
/** Residents who can find work outside the city, so a brand-new town isn't jobless. */
export const COMMUTER_JOBS = 20;
/** A jobless worker still earns this share of a normal income (savings, odd jobs). */
export const UNEMPLOYED_INCOME_SHARE = 0.4;
/** Taxable business income per filled job in a commercial or industrial zone, per tick. */
export const BUSINESS_INCOME_PER_JOB = 4;

/**
 * Budget deficit penalty parameters.
 * When money drops to 0, infrastructure starts degrading (Maslow targets reduced).
 * Deeper deficit = worse penalty, creating a cascading failure spiral:
 * deficit → lower Maslow → lower happiness → migration → less tax → deeper deficit
 */
export const DEFICIT_MASLOW_PENALTY_RATE = 0.00025; // Per money unit of deficit, reduce Maslow multiplier
export const MIN_BUDGET_MULTIPLIER = 0.5;           // Maslow targets never go below 50% even at the debt floor

/**
 * The treasury may go this far into debt before it bottoms out. Without debt the
 * deficit penalty above could never trigger (money used to clamp at 0).
 * Construction is blocked while funds are below the building cost.
 */
export const MAX_DEBT = 2000;

/**
 * Tax happiness trade-off: rates above the comfort rate reduce every Maslow
 * target by this fraction per percentage point (25% tax → targets × 0.55).
 */
export const TAX_COMFORT_RATE = 10;
export const TAX_MASLOW_PENALTY_PER_POINT = 0.03;

/**
 * City loans. The player picks the amount and the term; longer terms mean
 * smaller instalments but more interest (flat, charged over the whole term).
 */
export const LOAN_TERMS: ReadonlyArray<{ days: number; interestRate: number }> = [
  { days: 30, interestRate: 0.05 },
  { days: 90, interestRate: 0.10 },
  { days: 180, interestRate: 0.18 },
  { days: 365, interestRate: 0.30 },
];
export const LOAN_MIN_AMOUNT = 500;
export const LOAN_AMOUNT_STEP = 500;
export const LOAN_BASE_CREDIT_LIMIT = 5000;   // Any city can owe this much
export const LOAN_CREDIT_PER_CITIZEN = 100;   // Extra credit per resident
export const MAX_ACTIVE_LOANS = 3;

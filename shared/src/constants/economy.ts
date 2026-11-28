import { LifeStage } from '../types/person.js';
import { ZoneDensity } from '../types/building.js';
import type { CityMilestone, CreditRating } from '../types/resources.js';

/**
 * Initial founding capital for a new city.
 * Sized to cover starter roads, first R/C/I blocks, basic Power + Water + Sewage,
 * and starter Police/Fire with a healthy growth runway.
 */
export const INITIAL_CITY_MONEY = 15_000;
/** Minimum starting treasury for a pre-planned town (scales up with initial upkeep). */
export const PLANNED_TOWN_MIN_MONEY = 35_000;
export const PLANNED_TOWN_MAX_MONEY = 90_000;
/** Ticks of initial upkeep funded for a pre-planned town (15 game days). */
export const PLANNED_TOWN_RUNWAY_TICKS = 360;

/** Default neutral tax rate (%) for all sectors. */
export const DEFAULT_TAX_RATE = 9;

/**
 * Municipal population milestones: one-time charter grants awarded automatically
 * as the city grows, rewarding sustainable expansion instead of front-loading cash.
 */
export const CITY_MILESTONES: readonly CityMilestone[] = [
  { id: 'hamlet', label: 'Hamlet Charter', population: 25, grant: 2_500 },
  { id: 'village', label: 'Village Incorporation', population: 75, grant: 5_000 },
  { id: 'town', label: 'Town Charter', population: 150, grant: 8_000 },
  { id: 'small_city', label: 'Small City Grant', population: 350, grant: 15_000 },
  { id: 'city', label: 'Regional City Grant', population: 750, grant: 25_000 },
  { id: 'metropolis', label: 'Metropolis Charter', population: 1_500, grant: 50_000 },
];

/**
 * Tapering small-town municipal subsidy ($/tick).
 * Cushions essential starter utilities & civic services while the early tax base forms,
 * then tapers smoothly to $0 once the city becomes self-sustaining.
 */
export const SMALL_TOWN_SUBSIDY_MAX = 28;
export const SMALL_TOWN_SUBSIDY_FULL_POP = 30;
export const SMALL_TOWN_SUBSIDY_FADE_POP = 150;

/**
 * Taxable income per person per tick, by life stage (revenue = income × rate × valueFactor × compliance).
 * Children and teens don't contribute taxes.
 * Working-age income shrinks with unemployment (see UNEMPLOYED_INCOME_SHARE).
 */
export const TAX_PER_PERSON: Record<LifeStage, number> = {
  [LifeStage.CHILD]: 0,
  [LifeStage.TEEN]: 0,
  [LifeStage.YOUNG_ADULT]: 8,
  [LifeStage.ADULT]: 11,
  [LifeStage.ELDER]: 4,
};

/** Taxable income of a city without demographic data (legacy cities), per resident. */
export const TAX_PER_PERSON_FALLBACK = 7.0;

/** Share of working-age residents who want a job. */
export const WORKFORCE_PARTICIPATION = 0.85;
/** Workers per resident when a city has no demographic data yet. */
export const WORKFORCE_SHARE_FALLBACK = 0.55;
/** Residents who can find work outside the city, so a brand-new town isn't jobless. */
export const COMMUTER_JOBS = 20;
/** A jobless worker still earns this share of a normal income (savings, odd jobs). */
export const UNEMPLOYED_INCOME_SHARE = 0.4;

/** Taxable business output per filled job, per tick, by sector. */
export const COMMERCIAL_INCOME_PER_JOB = 6.5;
export const INDUSTRIAL_INCOME_PER_JOB = 5.5;
/** Legacy alias (average business income per job). */
export const BUSINESS_INCOME_PER_JOB = 6.0;

/**
 * Economic value scaling by zone development level (index 0 = L1, 1 = L2, 2 = L3)
 * and zone density. Higher-tier buildings have higher property/enterprise value,
 * making urban upgrading financially rewarding alongside higher maintenance.
 */
export const ZONE_LEVEL_TAX_MULTIPLIER: readonly number[] = [1.0, 1.35, 1.75];
export const ZONE_DENSITY_TAX_MULTIPLIER: Record<ZoneDensity, number> = {
  [ZoneDensity.LOW]: 1.0,
  [ZoneDensity.MEDIUM]: 1.1,
  [ZoneDensity.HIGH]: 1.25,
};

/**
 * Laffer curve / tax compliance parameters.
 * Up to TAX_LAFFER_THRESHOLD (12%), collection efficiency is 100%.
 * Above that, avoidance and capital flight reduce effective collection quadratically,
 * so punitive rates (20-25%) suffer diminishing returns.
 */
export const TAX_LAFFER_THRESHOLD = 12;
export const TAX_LAFFER_DECAY = 0.0028;
export const MIN_TAX_COMPLIANCE = 0.45;

/**
 * Tax elasticity on R/C/I zone demand:
 * - Below TAX_COMFORT_RATE (9%): tax incentive boosts positive demand (up to +0.24)
 * - Above TAX_COMFORT_RATE (9%): tax drag suppresses demand (-0.045 per point)
 */
export const TAX_DEMAND_BOOST_PER_POINT = 0.03;
export const TAX_DEMAND_DRAG_PER_POINT = 0.045;

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
 * Residential tax happiness trade-off:
 * - Below TAX_COMFORT_RATE (9%): slight happiness bonus (+0.5% per point, max +4%)
 * - Above TAX_COMFORT_RATE (9%): reduces Maslow targets by 2.8% per percentage point
 */
export const TAX_COMFORT_RATE = 9;
export const TAX_MASLOW_BONUS_PER_POINT = 0.005;
export const MAX_TAX_MASLOW_BONUS = 0.04;
export const TAX_MASLOW_PENALTY_PER_POINT = 0.028;

/**
 * City loans. Base interest rates are adjusted by the city's Credit Rating (AAA–B).
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
export const LOAN_CREDIT_REVENUE_MULT = 48;   // Extra credit = 2 game days of tax revenue
export const MAX_ACTIVE_LOANS = 3;

/** Interest rate multiplier by municipal credit rating. */
export const CREDIT_RATING_RATE_MULT: Record<CreditRating, number> = {
  AAA: 0.80,
  AA: 0.90,
  A: 1.00,
  BBB: 1.15,
  BB: 1.30,
  B: 1.50,
};

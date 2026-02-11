export const TICK_INTERVAL_MS = 2000;

export const INITIAL_RESOURCES = {
  money: 5000,
  population: 0,
  happiness: 50,
  taxRate: 10,
  demand: { residential: 0.5, commercial: 0, industrial: 0.3 },
} as const;

export const MIN_TAX_RATE = 1;
export const MAX_TAX_RATE = 25;
export const TAX_RATE_STEP = 1;

export const AUTO_SAVE_INTERVAL_MS = 30000;

// Game clock
export const GAME_MS_PER_TICK = 3_600_000; // 1 tick = 1 game hour
export const TICKS_PER_GAME_DAY = 24;
export const DAYS_PER_GAME_YEAR = 365;
export const DEFAULT_GAME_SPEED = 1;
export const MAX_GAME_SPEED = 3;

// Demand & zone growth
export const DEMAND_GROWTH_RATE = 0.05;
export const ZONE_GROWTH_CHANCE = 0.3;
export const MIN_DEMAND_TO_GROW = 0.2;

// Population lifecycle
export const BIRTH_RATE_PER_YEAR = 0.05;       // 5% of fertile (young_adult + adult) population per year
export const ELDER_MORTALITY_BASE_AGE = 60;     // Mortality starts at this age
export const ELDER_MORTALITY_RATE_PER_YEAR = 0.01; // 1% increase per year over base age
export const MAX_PERSON_AGE = 100;              // Guaranteed death at this age
export const LOW_PHYSIO_DEATH_MULTIPLIER = 3.0; // Death rate multiplier when physiological need is critically low
export const INITIAL_CITY_SEED = 10;            // People seeded from world pool when a city is claimed

// Maslow satisfaction
export const MASLOW_LERP_RATE = 0.1;           // Per-tick lerp speed toward target (0-1). 0.1 ≈ converges in ~20 ticks

// Migration
export const MIGRATION_HAPPINESS_THRESHOLD = 35; // Person considers leaving when happiness drops below this
export const MIGRATION_HAPPINESS_DELTA = 10;     // Target city must be this much better to attract migrants
export const MIGRATION_MAX_RATE = 0.05;          // Max 5% of city population can leave per game day

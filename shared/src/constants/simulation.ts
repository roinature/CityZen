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
export const DEMAND_GROWTH_RATE = 0.1;         // Per-tick lerp of each demand meter toward its target
export const ZONE_GROWTH_CHANCE = 0.3;
export const MIN_DEMAND_TO_GROW = 0.2;
/** Businesses keep opening until the city has this many jobs of each kind per resident. */
export const COMMERCIAL_JOBS_PER_RESIDENT = 0.3;
export const INDUSTRIAL_JOBS_PER_RESIDENT = 0.4;
/** Homes get built ahead of demand up to this multiple of the population, plus a few spare. */
export const HOUSING_BUFFER_RATIO = 1.25;
export const HOUSING_BUFFER_MIN = 20;
export const MIN_JOBS_WANTED = 5;              // So the first shop and factory open in a brand-new town
/** City happiness needed before a zone develops to level 1 / 2 / 3 (index = level). */
export const ZONE_LEVEL_MIN_HAPPINESS: readonly number[] = [0, 0, 40, 60];
export const DEMAND_UNHAPPY_BELOW = 35;        // Below this happiness, residential demand is dragged down

// Population lifecycle
export const BIRTH_RATE_PER_YEAR = 0.05;       // 5% of fertile (young_adult + adult) population per year
export const ELDER_MORTALITY_BASE_AGE = 60;     // Mortality starts at this age
export const ELDER_MORTALITY_RATE_PER_YEAR = 0.01; // 1% increase per year over base age
export const MAX_PERSON_AGE = 100;              // Guaranteed death at this age
export const LOW_PHYSIO_DEATH_MULTIPLIER = 3.0; // Death rate multiplier when physiological need is critically low
export const INITIAL_CITY_SEED = 10;            // People seeded from world pool when a city is claimed

// Maslow satisfaction
export const MASLOW_LERP_RATE = 0.1;           // Per-tick lerp speed toward target (0-1). 0.1 ≈ converges in ~20 ticks
/**
 * How well a fully-covered need is met: SERVICE_BASE_SATISFACTION plus
 * SERVICE_QUALITY_FACTOR per point of building quality (`value`), capped at 100.
 * A wind turbine (10) gives 70, a nuclear plant (25) gives 100.
 */
export const SERVICE_BASE_SATISFACTION = 50;
export const SERVICE_QUALITY_FACTOR = 2;
/**
 * A hamlet looks after itself: up to SMALL_TOWN_POPULATION residents every need
 * sits at SMALL_TOWN_SATISFACTION without any buildings. The free ride fades out
 * by SMALL_TOWN_FADE_POPULATION, after which only real services count.
 */
export const SMALL_TOWN_SATISFACTION = 45;
export const SMALL_TOWN_POPULATION = 60;
export const SMALL_TOWN_FADE_POPULATION = 240;

// Migration
export const MIGRATION_HAPPINESS_THRESHOLD = 35; // Person considers leaving when happiness drops below this
export const MIGRATION_HAPPINESS_DELTA = 10;     // Target city must be this much better to attract migrants
export const MIGRATION_MAX_RATE = 0.05;          // Max 5% of city population can leave per game day

// Immigration from the unassigned world pool into vacant housing
export const IMMIGRATION_RATE = 0.08;              // Share of vacant housing filled per tick (before attractiveness)
export const IMMIGRATION_MAX_PER_TICK = 10;        // Hard cap on arrivals per city per tick
export const IMMIGRATION_MIN_ATTRACTIVENESS = 0.3; // Even a miserable city fills at 30% of the normal rate

// Emigration: residents of a miserable city drift back to the countryside
export const EMIGRATION_HAPPINESS_THRESHOLD = 25; // City happiness below this drives people away
export const EMIGRATION_MAX_RATE = 0.04;          // Share of residents leaving per game day at 0 happiness

// The unclaimed countryside population grows by itself, so cities never run out of newcomers
export const WORLD_POOL_RESERVE = 200;            // The pool refills up to this many people...
export const WORLD_POOL_RESERVE_PER_CITY = 40;    // ...plus this many for each city in the world
export const WORLD_POOL_GROWTH_PER_CITY = 6;      // People added per tick for each city, while below the reserve

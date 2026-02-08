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

// Demand & zone growth
export const DEMAND_GROWTH_RATE = 0.05;
export const ZONE_GROWTH_CHANCE = 0.3;
export const MIN_DEMAND_TO_GROW = 0.2;

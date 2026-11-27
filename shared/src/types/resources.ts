import type { MaslowState } from './person.js';

export interface DemandState {
  residential: number;
  commercial: number;
  industrial: number;
}

export interface PopulationSummary {
  total: number;
  children: number;
  teens: number;
  youngAdults: number;
  adults: number;
  elders: number;
  averageHappiness: number;
  averageMaslow: MaslowState;
}

export interface ZonePopulationEntry {
  buildingId: string;
  population: number;
  capacity: number;
}

export interface Loan {
  id: string;
  /** Amount paid into the treasury when the loan was taken. */
  principal: number;
  /** Flat interest over the whole term (0.1 = 10%). */
  interestRate: number;
  termDays: number;
  /** principal + interest. */
  totalDue: number;
  /** Still owed. Falls by paymentPerTick each tick the city can pay. */
  remaining: number;
  paymentPerTick: number;
  takenAtTick: number;
}

export interface UtilitySummary {
  powerGenerationMW: number;
  powerDemandMW: number;
  powerLoadPct: number;
  poweredBuildings: number;
  unpoweredBuildings: number;
  brownoutBuildings: number;
  powerSubgrids: number;

  waterSupplyM3: number;
  waterDemandM3: number;
  waterLoadPct: number;
  wateredBuildings: number;
  unwateredBuildings: number;
  activeWaterSources: number;

  sewageCapacityM3: number;
  sewageDemandM3: number;
  sewageLoadPct: number;
  drainedBuildings: number;
  backedUpBuildings: number;
}

export interface ResourceState {
  money: number;
  population: number;
  happiness: number;
  taxRate: number;
  demand: DemandState;
  populationSummary?: PopulationSummary;
  zonePopulations?: ZonePopulationEntry[];
  loans?: Loan[];
  utilities?: UtilitySummary;
}

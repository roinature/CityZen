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

export interface ResourceState {
  money: number;
  population: number;
  happiness: number;
  taxRate: number;
  demand: DemandState;
  populationSummary?: PopulationSummary;
}

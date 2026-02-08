export interface DemandState {
  residential: number;
  commercial: number;
  industrial: number;
}

export interface ResourceState {
  money: number;
  population: number;
  happiness: number;
  taxRate: number;
  demand: DemandState;
}

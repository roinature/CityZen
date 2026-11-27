import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingType,
  ZoneDensity,
  calculateDemand,
  calculateDemandTargets,
  calculateGrowthBudget,
  createEmptyGrid,
  getZoneGrowthChance,
  processZoneGrowth,
  simulateCityTick,
  type CityState,
  type PlacedBuilding,
} from '../dist/index.js';

function makeZone(
  id: string,
  type: BuildingType,
  x: number,
  z: number,
  level = 0,
  density = ZoneDensity.MEDIUM,
): PlacedBuilding {
  return {
    id,
    type,
    position: { x, z },
    placedBy: 'tester',
    placedAt: 0,
    density,
    developmentLevel: level,
    ...(level > 0 ? { developedAt: 0 } : {}),
  };
}

function makeCity(overrides: {
  population?: number;
  happiness?: number;
  tick?: number;
  demand?: { residential: number; commercial: number; industrial: number };
  buildings?: PlacedBuilding[];
} = {}): CityState {
  const buildings = overrides.buildings ?? [];
  const grid = createEmptyGrid();
  for (const b of buildings) {
    grid[b.position.x][b.position.z].buildingId = b.id;
  }
  return {
    id: 'test-city',
    name: 'Testville',
    ownerId: 'tester',
    grid,
    buildings,
    resources: {
      money: 5000,
      population: overrides.population ?? 100,
      happiness: overrides.happiness ?? 50,
      taxRate: 10,
      demand: overrides.demand ?? { residential: 0.5, commercial: 0.5, industrial: 0.5 },
    },
    clock: { gameTimeMs: 0, speed: 1, gameDay: 1, gameYear: 1 },
    tick: overrides.tick ?? 50,
    createdAt: 1,
    updatedAt: 1,
  };
}

test('industrial and commercial demand sign matches growth budget exactly', () => {
  for (const existingIndTiles of [0, 1, 2, 4, 5, 6, 7, 10]) {
    const buildings: PlacedBuilding[] = [];
    for (let i = 0; i < existingIndTiles; i++) {
      buildings.push(makeZone(`ind-${i}`, BuildingType.ZONE_INDUSTRIAL, i, 0, 1, ZoneDensity.MEDIUM));
    }
    const state = makeCity({ population: 187, happiness: 17, buildings });
    const target = calculateDemandTargets(state);
    const budget = calculateGrowthBudget(state);
    const demand = calculateDemand(state);

    assert.equal(target.industrial > 0, budget.industrial > 0, `target/budget sign mismatch at ${existingIndTiles} tiles`);
    assert.equal(demand.industrial > 0, budget.industrial > 0, `smoothed demand/budget sign mismatch at ${existingIndTiles} tiles`);
    assert.equal(target.commercial > 0, budget.commercial > 0);
    assert.equal(demand.commercial > 0, budget.commercial > 0);
  }
});

test('residential demand never stays positive once housing budget is exhausted', () => {
  for (const pop of [20, 100, 200, 500, 1000]) {
    // Fill jobs generously so jobPull is high, and overfill housing to exhaust residential budget
    const buildings: PlacedBuilding[] = [];
    for (let i = 0; i < 40; i++) {
      buildings.push(makeZone(`ind-${i}`, BuildingType.ZONE_INDUSTRIAL, i, 0, 3, ZoneDensity.HIGH));
      buildings.push(makeZone(`com-${i}`, BuildingType.ZONE_COMMERCIAL, i, 1, 3, ZoneDensity.HIGH));
    }
    // Add enough high-density L3 residential (100 pop each) to meet/exceed pop * 1.25 + 20
    const neededHomes = Math.ceil((pop * 1.25 + 20) / 100);
    for (let i = 0; i < neededHomes; i++) {
      buildings.push(makeZone(`res-${i}`, BuildingType.ZONE_RESIDENTIAL, i, 2, 3, ZoneDensity.HIGH));
    }

    const state = makeCity({ population: pop, happiness: 80, buildings });
    const target = calculateDemandTargets(state);
    const budget = calculateGrowthBudget(state);
    const demand = calculateDemand(state);

    assert.ok(budget.residential <= 0, `expected exhausted residential budget at pop=${pop}`);
    assert.ok(target.residential <= 0, `expected non-positive residential target when budget <= 0 (got ${target.residential})`);
    assert.ok(demand.residential <= 0, `expected non-positive residential demand when budget <= 0 (got ${demand.residential})`);
  }
});

test('positive industrial demand actualizes empty industrial lots even at small demand and low happiness', () => {
  // Reproduces screenshot scenario: pop=187 (~103 workers, ~62 industrial jobs wanted),
  // 5 existing level-1 medium factories (50 jobs) → small positive demand (~0.19) + 17% happiness
  // + empty industrial lots waiting to be built.
  const buildings: PlacedBuilding[] = [];
  for (let i = 0; i < 5; i++) {
    buildings.push(makeZone(`ind-built-${i}`, BuildingType.ZONE_INDUSTRIAL, i, 0, 1, ZoneDensity.MEDIUM));
  }
  for (let i = 0; i < 12; i++) {
    buildings.push(makeZone(`ind-empty-${i}`, BuildingType.ZONE_INDUSTRIAL, i, 1, 0, ZoneDensity.MEDIUM));
  }

  let state = makeCity({
    population: 187,
    happiness: 17,
    tick: 50,
    demand: { residential: -0.3, commercial: 0.15, industrial: 0.15 },
    buildings,
  });

  // Confirm demand starts positive
  const initialTargets = calculateDemandTargets(state);
  assert.ok(initialTargets.industrial > 0 && initialTargets.industrial < 0.25);

  // Run ticks until industrial demand is met; empty lots must actually develop!
  for (let t = 0; t < 40; t++) {
    state = simulateCityTick(state);
  }

  const builtNew = state.buildings.filter(
    b => b.id.startsWith('ind-empty-') && (b.developmentLevel ?? 0) > 0,
  );
  assert.ok(builtNew.length >= 1, 'empty industrial lots should develop when industrial demand is positive');
  // Once the budget is satisfied, industrial demand must drop to <= 0 (no phantom demand)
  assert.ok(
    state.resources.demand.industrial <= 0,
    `expected industrial demand <= 0 once budget is filled, got ${state.resources.demand.industrial}`,
  );
});

test('growth chance correlates monotonically with demand', () => {
  assert.equal(getZoneGrowthChance(-0.5), 0);
  assert.equal(getZoneGrowthChance(0), 0);
  const low = getZoneGrowthChance(0.1);
  const mid = getZoneGrowthChance(0.5);
  const high = getZoneGrowthChance(1.0);
  assert.ok(low > 0, 'positive demand must have > 0 growth chance');
  assert.ok(low < mid && mid < high, 'higher demand must give strictly higher growth chance');
});

test('demand drops immediately when zone growth exhausts budget on that tick', () => {
  const buildings: PlacedBuilding[] = [
    makeZone('ind-empty-0', BuildingType.ZONE_INDUSTRIAL, 0, 0, 0, ZoneDensity.MEDIUM),
  ];
  const state = makeCity({
    population: 10, // workers ~5.5, wanted industrial = MIN_JOBS_WANTED (5), 1 medium L1 = 10 jobs
    happiness: 50,
    tick: 50,
    demand: { residential: 0.5, commercial: 0, industrial: 1.0 },
    buildings,
  });

  // Force Math.random to trigger growth on first tick
  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    const next = simulateCityTick(state);
    assert.equal(next.buildings[0].developmentLevel, 1);
    assert.ok(
      next.resources.demand.industrial <= 0,
      `expected industrial demand <= 0 immediately after factory fills need, got ${next.resources.demand.industrial}`,
    );
  } finally {
    Math.random = origRandom;
  }
});

test('processZoneGrowth does not build when demand <= 0', () => {
  const buildings: PlacedBuilding[] = [
    makeZone('ind-empty-0', BuildingType.ZONE_INDUSTRIAL, 0, 0, 0, ZoneDensity.MEDIUM),
  ];
  const state = makeCity({
    population: 100,
    happiness: 80,
    tick: 50,
    demand: { residential: 0, commercial: 0, industrial: 0 },
    buildings,
  });

  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    const res = processZoneGrowth(state);
    assert.equal(res.upgradedBuildings.length, 0);
  } finally {
    Math.random = origRandom;
  }
});

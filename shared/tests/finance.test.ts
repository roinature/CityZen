import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingType,
  ZoneDensity,
  INITIAL_RESOURCES,
  INITIAL_CITY_MONEY,
  DEFAULT_TAX_RATE,
  SMALL_TOWN_SUBSIDY_MAX,
  CITY_MILESTONES,
  calculateTaxBreakdown,
  calculateExpenseBreakdown,
  calculateMaintenance,
  calculateNetIncome,
  calculateSmallTownSubsidy,
  calculateTaxCompliance,
  calculateTaxDemandEffect,
  calculateTaxPenalty,
  calculateDemandTargets,
  calculateCreditRating,
  calculatePlannedTownMoney,
  evaluateMilestones,
  getEffectiveTaxRates,
  quoteLoan,
  createEmptyGrid,
  simulateCityTick,
  CityRoom,
  type CityState,
  type PlacedBuilding,
  type TaxRates,
} from '../dist/index.js';

function makeBuilding(
  id: string,
  type: BuildingType,
  x: number,
  z: number,
  opts: { level?: number; density?: ZoneDensity } = {},
): PlacedBuilding {
  return {
    id,
    type,
    position: { x, z },
    placedBy: 'tester',
    placedAt: 0,
    ...(opts.density ? { density: opts.density } : {}),
    ...(opts.level !== undefined ? { developmentLevel: opts.level, developedAt: 0 } : {}),
  };
}

function makeCity(overrides: {
  money?: number;
  population?: number;
  happiness?: number;
  taxRate?: number;
  taxRates?: TaxRates;
  claimedMilestones?: string[];
  buildings?: PlacedBuilding[];
} = {}): CityState {
  const buildings = overrides.buildings ?? [];
  const grid = createEmptyGrid();
  return {
    id: 'fin-test-city',
    name: 'Financeton',
    ownerId: 'tester',
    grid,
    buildings,
    resources: {
      money: overrides.money ?? INITIAL_CITY_MONEY,
      population: overrides.population ?? 50,
      happiness: overrides.happiness ?? 65,
      taxRate: overrides.taxRate ?? DEFAULT_TAX_RATE,
      ...(overrides.taxRates ? { taxRates: overrides.taxRates } : {}),
      claimedMilestones: overrides.claimedMilestones ?? [],
      demand: { residential: 0.5, commercial: 0.5, industrial: 0.5 },
    },
    clock: { gameTimeMs: 0, speed: 1, gameDay: 1, gameYear: 1 },
    tick: 10,
    createdAt: 1,
    updatedAt: 1,
  };
}

test('initial resources provide balanced $15k seed capital and 9% default sector tax rates', () => {
  assert.equal(INITIAL_RESOURCES.money, 15_000);
  assert.equal(INITIAL_RESOURCES.taxRate, 9);
  assert.deepEqual(INITIAL_RESOURCES.taxRates, {
    residential: 9,
    commercial: 9,
    industrial: 9,
  });

  const smallTownBuildings = [
    makeBuilding('w1', BuildingType.ENERGY_WIND_TURBINE, 0, 0),
    makeBuilding('wt1', BuildingType.WATER_TOWER, 2, 0),
  ];
  const bigTownBuildings = Array.from({ length: 12 }, (_, i) =>
    makeBuilding(`p-${i}`, BuildingType.POLICE_HQ, i * 3, 0),
  );
  assert.ok(calculatePlannedTownMoney(smallTownBuildings) >= 35_000);
  assert.ok(calculatePlannedTownMoney(bigTownBuildings) > calculatePlannedTownMoney(smallTownBuildings));
});

test('small-town municipal subsidy cushions early towns and tapers to $0 by 150 pop', () => {
  assert.equal(calculateSmallTownSubsidy(makeCity({ population: 0 })), 0);
  assert.equal(calculateSmallTownSubsidy(makeCity({ population: 10 })), SMALL_TOWN_SUBSIDY_MAX);
  assert.equal(calculateSmallTownSubsidy(makeCity({ population: 30 })), SMALL_TOWN_SUBSIDY_MAX);

  const mid = calculateSmallTownSubsidy(makeCity({ population: 90 }));
  assert.ok(mid > 0 && mid < SMALL_TOWN_SUBSIDY_MAX, `expected tapering subsidy at pop=90, got ${mid}`);
  assert.equal(calculateSmallTownSubsidy(makeCity({ population: 150 })), 0);
  assert.equal(calculateSmallTownSubsidy(makeCity({ population: 400 })), 0);
});

test('population milestone grants award once when thresholds are crossed', () => {
  const eval1 = evaluateMilestones(30, []);
  assert.equal(eval1.newlyClaimed.length, 1);
  assert.equal(eval1.newlyClaimed[0].id, CITY_MILESTONES[0].id);
  assert.equal(eval1.totalGrant, CITY_MILESTONES[0].grant);
  assert.equal(eval1.nextMilestone?.id, CITY_MILESTONES[1].id);

  // simulateCityTick deposits the grant and marks the milestone claimed
  const city = makeCity({ money: 10_000, population: 30, claimedMilestones: [] });
  const expectedNet = calculateNetIncome(city);
  const afterTick1 = simulateCityTick(city);
  assert.ok(afterTick1.resources.claimedMilestones?.includes('hamlet'));
  assert.ok(
    Math.abs(afterTick1.resources.money - (10_000 + expectedNet + CITY_MILESTONES[0].grant)) < 0.05,
    'milestone grant should be deposited into treasury',
  );

  // Running another tick must NOT double-award the same milestone
  const expectedNet2 = calculateNetIncome(afterTick1);
  const afterTick2 = simulateCityTick(afterTick1);
  assert.ok(
    Math.abs(afterTick2.resources.money - (afterTick1.resources.money + expectedNet2)) < 0.05,
    'milestone grant must only be awarded once',
  );
});

test('sector tax rates calculate residential, commercial, and industrial taxes independently', () => {
  const buildings = [
    makeBuilding('r1', BuildingType.ZONE_RESIDENTIAL, 0, 0, { level: 1, density: ZoneDensity.MEDIUM }),
    makeBuilding('c1', BuildingType.ZONE_COMMERCIAL, 2, 0, { level: 1, density: ZoneDensity.MEDIUM }),
    makeBuilding('i1', BuildingType.ZONE_INDUSTRIAL, 4, 0, { level: 1, density: ZoneDensity.MEDIUM }),
  ];

  const lowCom = makeCity({
    population: 200,
    buildings,
    taxRates: { residential: 9, commercial: 5, industrial: 12 },
  });
  const highCom = makeCity({
    population: 200,
    buildings,
    taxRates: { residential: 9, commercial: 12, industrial: 5 },
  });

  const b1 = calculateTaxBreakdown(lowCom);
  const b2 = calculateTaxBreakdown(highCom);

  assert.equal(b1.residents, b2.residents);
  assert.ok(b2.commercial > b1.commercial, 'higher commercial rate should raise commercial tax');
  assert.ok(b1.industrial > b2.industrial, 'higher industrial rate should raise industrial tax');

  // Legacy city without taxRates falls back to unified taxRate
  const legacy = makeCity({ taxRate: 11 });
  assert.deepEqual(getEffectiveTaxRates(legacy.resources), {
    residential: 11,
    commercial: 11,
    industrial: 11,
  });
});

test('higher development levels and densities generate more taxable value', () => {
  const lowCity = makeCity({
    population: 200,
    buildings: [
      makeBuilding('r1', BuildingType.ZONE_RESIDENTIAL, 0, 0, { level: 1, density: ZoneDensity.LOW }),
      makeBuilding('c1', BuildingType.ZONE_COMMERCIAL, 2, 0, { level: 1, density: ZoneDensity.LOW }),
      makeBuilding('i1', BuildingType.ZONE_INDUSTRIAL, 4, 0, { level: 1, density: ZoneDensity.LOW }),
    ],
  });
  const highCity = makeCity({
    population: 200,
    buildings: [
      makeBuilding('r1', BuildingType.ZONE_RESIDENTIAL, 0, 0, { level: 3, density: ZoneDensity.HIGH }),
      makeBuilding('c1', BuildingType.ZONE_COMMERCIAL, 2, 0, { level: 3, density: ZoneDensity.HIGH }),
      makeBuilding('i1', BuildingType.ZONE_INDUSTRIAL, 4, 0, { level: 3, density: ZoneDensity.HIGH }),
    ],
  });

  const lowTax = calculateTaxBreakdown(lowCity);
  const highTax = calculateTaxBreakdown(highCity);
  assert.ok(highTax.residents > lowTax.residents * 1.8, 'L3 high-density residential should generate higher tax');
  assert.ok(highTax.businesses > lowTax.businesses * 1.8, 'L3 high-density business should generate higher tax');
});

test('Laffer curve reduces compliance above 12% and creates diminishing returns at punitive rates', () => {
  assert.equal(calculateTaxCompliance(9), 1.0);
  assert.equal(calculateTaxCompliance(12), 1.0);
  assert.ok(calculateTaxCompliance(20) < 0.85);
  assert.ok(calculateTaxCompliance(25) < 0.6);

  // Effective rate (rate * compliance) peaks below 25%
  const eff18 = 18 * calculateTaxCompliance(18);
  const eff25 = 25 * calculateTaxCompliance(25);
  assert.ok(eff18 > eff25, `expected Laffer peak before 25% (eff18=${eff18.toFixed(2)}, eff25=${eff25.toFixed(2)})`);
});

test('sector tax rates affect R/C/I demand and residential happiness', () => {
  assert.ok(calculateTaxDemandEffect(5) > 0, 'low tax should give demand boost');
  assert.equal(calculateTaxDemandEffect(9), 0);
  assert.equal(calculateTaxDemandEffect(10), 0);
  assert.ok(calculateTaxDemandEffect(18) < -0.3, 'high tax should drag demand');

  assert.ok(calculateTaxPenalty(5) > 1.0, 'low residential tax gives slight happiness bonus');
  assert.equal(calculateTaxPenalty(9), 1.0);
  assert.ok(calculateTaxPenalty(20) < 0.75, 'high residential tax reduces Maslow multiplier');

  const base = makeCity({ population: 100, taxRates: { residential: 9, commercial: 9, industrial: 9 } });
  const boostedCom = makeCity({ population: 100, taxRates: { residential: 9, commercial: 4, industrial: 20 } });
  const dBase = calculateDemandTargets(base);
  const dCustom = calculateDemandTargets(boostedCom);
  assert.ok(dCustom.commercial >= dBase.commercial, 'low commercial tax should boost/preserve commercial demand');
  assert.ok(dCustom.industrial < dBase.industrial, 'high industrial tax should suppress industrial demand');
});

test('expense breakdown categorizes maintenance accurately and sums to total', () => {
  const city = makeCity({
    buildings: [
      makeBuilding('u1', BuildingType.ENERGY_WIND_TURBINE, 0, 0),
      makeBuilding('s1', BuildingType.POLICE_STATION, 2, 0),
      makeBuilding('c1', BuildingType.HEALTH_CLINIC, 5, 0),
      makeBuilding('rd1', BuildingType.ROAD_STREET, 8, 0),
      makeBuilding('z1', BuildingType.ZONE_RESIDENTIAL, 10, 0, { level: 1, density: ZoneDensity.MEDIUM }),
    ],
  });

  const exp = calculateExpenseBreakdown(city);
  assert.equal(exp.utilities, 5);
  assert.equal(exp.safety, 10);
  assert.equal(exp.civic, 8);
  assert.equal(exp.roads, 0.1);
  assert.equal(exp.zones, 2);
  assert.equal(exp.total, calculateMaintenance(city));
});

test('credit rating adjusts loan interest rates based on fiscal health', () => {
  const thriving = makeCity({ money: 40_000, population: 500 });
  const distressed = makeCity({
    money: -1500,
    population: 40,
    buildings: [
      makeBuilding('p1', BuildingType.POLICE_HQ, 0, 0),
      makeBuilding('f1', BuildingType.FIRE_HQ, 4, 0),
      makeBuilding('h1', BuildingType.HEALTH_HOSPITAL, 8, 0),
    ],
  });

  const rGood = calculateCreditRating(thriving);
  const rBad = calculateCreditRating(distressed);
  assert.ok(rGood.score > rBad.score);

  const qGood = quoteLoan(5000, 90, thriving)!;
  const qBad = quoteLoan(5000, 90, distressed)!;
  assert.ok(qGood.interestRate < qBad.interestRate, 'thriving city should get lower interest rate than distressed city');
});

test('CityRoom setTaxRates updates sector rates and keeps average taxRate synced', () => {
  const room = new CityRoom('c1', 'Test', 'u1', 'Mayor');
  assert.equal(room.state.resources.money, 15_000);
  assert.equal(room.state.resources.taxRate, 9);

  const ok = room.setTaxRates({ commercial: 6, industrial: 12 });
  assert.equal(ok.success, true);
  assert.deepEqual(room.state.resources.taxRates, { residential: 9, commercial: 6, industrial: 12 });
  assert.equal(room.state.resources.taxRate, 9);

  const bad = room.setTaxRates({ residential: 99 });
  assert.equal(bad.success, false);
});

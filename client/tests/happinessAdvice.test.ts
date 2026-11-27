import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingType, MaslowNeed, ZONE_LEVEL_MIN_HAPPINESS,
  type CityState, type GridTile,
} from '@cityzen/shared';
import {
  LOW_HAPPINESS, getBlockedZoneLevel, getHappinessAdvice, needsHappinessAdvice,
} from '../src/ui/happinessAdvice.ts';

function makeGrid(size = 8): GridTile[][] {
  return Array.from({ length: size }, (_, x) =>
    Array.from({ length: size }, (_, z) => ({ x, z, type: 'grass' })));
}

function makeCity(overrides: {
  happiness: number;
  population?: number;
  money?: number;
  taxRate?: number;
  maslow?: Record<MaslowNeed, number>;
  developmentLevel?: number;
}): CityState {
  const population = overrides.population ?? 3000;
  return {
    id: 'city-1',
    name: 'Testville',
    gridSize: 8,
    grid: makeGrid(8),
    buildings: [
      {
        id: 'zone-1',
        type: BuildingType.ZONE_RESIDENTIAL,
        density: 'medium',
        position: { x: 0, z: 0 },
        placedAt: 0,
        developmentLevel: overrides.developmentLevel ?? 2,
      },
    ],
    people: [],
    resources: {
      money: overrides.money ?? 100_000,
      population,
      happiness: overrides.happiness,
      taxRate: overrides.taxRate ?? 10,
      demand: { residential: 0.5, commercial: 0.5, industrial: 0.5 },
      populationSummary: overrides.maslow ? {
        totalPopulation: population,
        demographics: { children: 500, youngAdults: 1000, adults: 1000, elders: 500 },
        averageMaslow: overrides.maslow,
        averageHappiness: overrides.happiness,
        birthsLastTick: 0,
        deathsLastTick: 0,
      } : undefined,
    },
    tick: 100,
    lastUpdated: 0,
  };
}

test('getHappinessAdvice provides recommendations above LOW_HAPPINESS when happiness is at 42%', () => {
  const city = makeCity({ happiness: 42 });
  assert.equal(LOW_HAPPINESS, 40);
  assert.equal(needsHappinessAdvice(city), false);
  assert.equal(getBlockedZoneLevel(city), 3);

  const advice = getHappinessAdvice(city);
  assert.ok(advice.length > 0, 'Expected actionable advice at 42% happiness');
});

test('getBlockedZoneLevel detects blocked level 3 until happiness reaches 60%', () => {
  const blocked = makeCity({ happiness: 59, developmentLevel: 2 });
  assert.equal(getBlockedZoneLevel(blocked), 3);

  const unlocked = makeCity({ happiness: ZONE_LEVEL_MIN_HAPPINESS[3], developmentLevel: 2 });
  assert.equal(getBlockedZoneLevel(unlocked), undefined);
});

test('getHappinessAdvice returns empty when citizens are satisfied and no zones are blocked', () => {
  const satisfied: Record<MaslowNeed, number> = {
    [MaslowNeed.PHYSIOLOGICAL]: 90,
    [MaslowNeed.SAFETY]: 90,
    [MaslowNeed.LOVE_BELONGING]: 90,
    [MaslowNeed.ESTEEM]: 90,
    [MaslowNeed.COGNITIVE]: 90,
    [MaslowNeed.AESTHETIC]: 90,
    [MaslowNeed.SELF_ACTUALIZATION]: 90,
  };
  const city = makeCity({ happiness: 90, maslow: satisfied, developmentLevel: 3 });
  assert.deepEqual(getHappinessAdvice(city), []);
});

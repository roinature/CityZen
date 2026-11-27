import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_DEFS,
  BuildingType,
  CityRoom,
  ROAD_GRADING_COST,
  ZoneDensity,
  canPlaceBuilding,
  createEmptyGrid,
  getEffectiveSize,
  getPlacementCost,
  type Position,
} from '../dist/index.js';

test('dragging an avenue across steep slope patches builds a continuous unbroken road and levels 1-tile shoulders', () => {
  const room = new CityRoom('hill-city', 'Hilltop', 'player-1', 'Builder');
  room.state.resources.money = 5000;

  // Carve two steep-slope bands across an NS avenue path (x = 20..21, z = 10..19),
  // matching the flat -> steep -> flat -> steep -> flat scenario.
  const steepZ = new Set([12, 16, 17, 18]);
  for (let x = 18; x <= 23; x++) {
    for (let z = 10; z <= 19; z++) {
      if (steepZ.has(z)) {
        room.state.grid[x][z].terrain = 'steep';
      }
    }
  }

  // Non-road buildings are still blocked on steep cells before a road grades them
  const beforeZone = canPlaceBuilding(
    room.state.grid,
    { x: 19, z: 12 },
    BuildingType.ZONE_RESIDENTIAL,
    room.state.resources,
  );
  assert.equal(beforeZone.valid, false);
  assert.equal(beforeZone.reason, 'Slope too steep');

  const positions: Position[] = [];
  for (let z = 10; z <= 19; z++) {
    positions.push({ x: 20, z });
  }

  // Quote stroke cost using the same deduplicated logic as BuildMode.updateLineDragPreview
  const leveled = new Set<string>();
  let expectedTotalCost = 0;
  let expectedGradingCost = 0;
  for (const pos of positions) {
    const quote = getPlacementCost(room.state.grid, pos, BuildingType.ROAD_AVENUE, undefined, 'NS', leveled);
    expectedTotalCost += quote.totalCost;
    expectedGradingCost += quote.gradingCost;
    for (const c of quote.gradedCells) {
      leveled.add(`${c.x},${c.z}`);
    }
  }
  assert.ok(expectedGradingCost > 0, 'steep cells along road path should incur grading fee');
  assert.equal(
    expectedTotalCost,
    positions.length * BUILDING_DEFS[BuildingType.ROAD_AVENUE].cost + leveled.size * ROAD_GRADING_COST,
  );

  const moneyBefore = room.state.resources.money;
  const res = room.placeBuildings('player-1', {
    positions,
    type: BuildingType.ROAD_AVENUE,
    orientation: 'NS',
  });

  assert.equal(res.success, true);
  assert.equal(res.error, undefined);
  assert.equal(res.buildings.length, positions.length, 'every avenue segment must place without gaps');
  assert.equal(room.state.resources.money, moneyBefore - expectedTotalCost, 'charged amount must match preview quote');

  // Verify road footprint (x = 20, 21) and 1-tile shoulders (x = 19 and x = 22) are all leveled
  const { w } = getEffectiveSize(BuildingType.ROAD_AVENUE, 'NS');
  assert.equal(w, 2);
  for (let z = 10; z <= 19; z++) {
    assert.ok(room.state.grid[20][z].buildingId, `missing road at (20, ${z})`);
    assert.ok(room.state.grid[21][z].buildingId, `missing road at (21, ${z})`);
    for (const x of [19, 20, 21, 22]) {
      assert.equal(room.state.grid[x][z].terrain, undefined, `expected (${x}, ${z}) to be leveled`);
    }
    // Cells 2 tiles away (x = 18, x = 23) on steep bands remain steep
    if (steepZ.has(z)) {
      assert.equal(room.state.grid[18][z].terrain, 'steep');
      assert.equal(room.state.grid[23][z].terrain, 'steep');
    }
  }

  // Zones can now be placed directly alongside the leveled road on both sides
  const westLot = room.placeBuilding('player-1', { x: 19, z: 17 }, BuildingType.ZONE_RESIDENTIAL, ZoneDensity.LOW);
  const eastLot = room.placeBuilding('player-1', { x: 22, z: 17 }, BuildingType.ZONE_RESIDENTIAL, ZoneDensity.LOW);
  assert.equal(westLot.success, true);
  assert.equal(eastLot.success, true);
});

test('roads still cannot cross open water and never level adjacent water tiles', () => {
  const grid = createEmptyGrid();
  grid[10][10].terrain = 'water';
  grid[11][10].terrain = 'steep';

  const resources = {
    money: 1000,
    population: 0,
    happiness: 50,
    taxRate: 10,
    demand: { residential: 0, commercial: 0, industrial: 0 },
  };

  // Road directly on water is rejected
  const onWater = canPlaceBuilding(grid, { x: 10, z: 10 }, BuildingType.ROAD_STREET, resources);
  assert.equal(onWater.valid, false);
  assert.equal(onWater.reason, 'Open water');

  // Road next to water is allowed, levels steep cell, and leaves water untouched
  const room = new CityRoom('coast-city', 'Coast', 'player-1', 'Builder');
  room.state.grid = grid;
  room.state.resources = { ...resources };

  const res = room.placeBuilding('player-1', { x: 11, z: 10 }, BuildingType.ROAD_STREET, undefined, 'NS');
  assert.equal(res.success, true);
  assert.equal(room.state.grid[10][10].terrain, 'water', 'adjacent water must remain water');
  assert.equal(room.state.grid[11][10].terrain, undefined, 'steep footprint must be leveled');
});

test('road placement enforces base + grading cost when funds are tight', () => {
  const room = new CityRoom('budget-city', 'Budget', 'player-1', 'Builder');
  for (let x = 9; x <= 11; x++) {
    for (let z = 9; z <= 11; z++) {
      room.state.grid[x][z].terrain = 'steep';
    }
  }

  const baseCost = BUILDING_DEFS[BuildingType.ROAD_STREET].cost; // 15
  const fullCost = baseCost + 9 * ROAD_GRADING_COST; // 15 + 90 = 105

  room.state.resources.money = fullCost - 1;
  const fail = room.placeBuilding('player-1', { x: 10, z: 10 }, BuildingType.ROAD_STREET);
  assert.equal(fail.success, false);
  assert.equal(fail.error, 'Not enough money');
  assert.equal(room.state.grid[10][10].terrain, 'steep', 'failed placement must not mutate terrain');

  room.state.resources.money = fullCost;
  const ok = room.placeBuilding('player-1', { x: 10, z: 10 }, BuildingType.ROAD_STREET);
  assert.equal(ok.success, true);
  assert.equal(room.state.resources.money, 0);
  assert.equal(room.state.grid[10][10].terrain, undefined);
});

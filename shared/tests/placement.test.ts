import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_DEFS,
  BuildingType,
  CityRoom,
  INFRA_CATEGORIES,
  INFRA_WATERFRONT_TYPES,
  ZoneDensity,
  applySiteTerrain,
  calculateLaborStats,
  canPlaceBuilding,
  createEmptyGrid,
  getReplacedBuildings,
  getWaterfrontFacing,
  isWaterfront,
} from '@cityzen/shared';

test('service buildings, parks, and roundabouts can be placed on zoned areas and replace underlying zones', () => {
  const room = new CityRoom('c-test', 'Test City', 'p1', 'Mayor');
  // Clear starter layout for deterministic grid coordinates
  room.state.grid = createEmptyGrid();
  room.state.buildings = [];
  room.state.resources.money = 50_000;

  // Paint a 4x4 residential zone block at (10, 10)..(13, 13) and mark some as developed apartments
  const zonePositions = [];
  for (let x = 10; x < 14; x++) {
    for (let z = 10; z < 14; z++) {
      zonePositions.push({ x, z });
    }
  }
  const zoned = room.placeBuildings('p1', {
    positions: zonePositions,
    type: BuildingType.ZONE_RESIDENTIAL,
    density: ZoneDensity.MEDIUM,
  });
  assert.equal(zoned.success, true);
  assert.equal(room.state.buildings.length, 16);

  for (const b of room.state.buildings) {
    b.developmentLevel = 2;
  }

  // Verify canPlaceBuilding allows 3x3 Police HQ over developed zoned tiles
  const check = canPlaceBuilding(
    room.state.grid,
    { x: 10, z: 10 },
    BuildingType.POLICE_HQ,
    room.state.resources,
    false,
    room.state.buildings,
  );
  assert.equal(check.valid, true);

  const toReplace = getReplacedBuildings(
    room.state.grid,
    { x: 10, z: 10 },
    BuildingType.POLICE_HQ,
    room.state.buildings,
  );
  assert.equal(toReplace.length, 9);

  // Place the 3x3 Police HQ at (10, 10)
  const placed = room.placeBuilding('p1', { x: 10, z: 10 }, BuildingType.POLICE_HQ);
  assert.equal(placed.success, true);

  // 16 - 9 replaced zones + 1 Police HQ = 8 buildings total
  assert.equal(room.state.buildings.length, 8);
  const hq = room.state.buildings.find(b => b.type === BuildingType.POLICE_HQ);
  assert.ok(hq, 'Expected Police HQ in city buildings');

  for (let dx = 0; dx < 3; dx++) {
    for (let dz = 0; dz < 3; dz++) {
      assert.equal(room.state.grid[10 + dx][10 + dz].buildingId, hq.id);
    }
  }

  // Park can also be placed on one of the remaining zoned tiles (13, 13)
  const parkRes = room.placeBuilding('p1', { x: 13, z: 13 }, BuildingType.PARK);
  assert.equal(parkRes.success, true);
  assert.equal(room.state.buildings.filter(b => b.type === BuildingType.PARK).length, 1);

  // Another service building CANNOT overwrite the placed Police HQ or a road
  const overlapService = canPlaceBuilding(
    room.state.grid,
    { x: 11, z: 11 },
    BuildingType.POLICE_STATION,
    room.state.resources,
    false,
    room.state.buildings,
  );
  assert.equal(overlapService.valid, false);
  assert.equal(overlapService.reason, 'Cell occupied');

  room.placeBuilding('p1', { x: 20, z: 20 }, BuildingType.ROAD_STREET);
  const overlapRoad = canPlaceBuilding(
    room.state.grid,
    { x: 19, z: 19 },
    BuildingType.POLICE_STATION,
    room.state.resources,
    false,
    room.state.buildings,
  );
  assert.equal(overlapRoad.valid, false);
  assert.equal(overlapRoad.reason, 'Cell occupied');

  // Every land service category type is valid over empty + zoned tiles when funded;
  // waterfront buildings require shoreline access.
  room.state.resources.money = 1_000_000;
  for (const category of INFRA_CATEGORIES) {
    for (const type of category.types) {
      const def = BUILDING_DEFS[type];
      assert.ok(def.size.w >= 1 && def.size.d >= 1);
      const res = canPlaceBuilding(
        room.state.grid,
        { x: 30, z: 30 },
        type,
        room.state.resources,
        false,
        room.state.buildings,
      );
      if (isWaterfront(type)) {
        assert.equal(res.valid, false, `Expected ${type} to reject inland placement`);
        assert.equal(res.reason, 'Must be placed on waterfront');
      } else {
        assert.equal(res.valid, true, `Expected ${type} to be placeable`);
      }
    }
  }
});

test('waterfront buildings require shoreline, auto-orient to face open water, and add jobs', () => {
  const room = new CityRoom('c-coast', 'Harbor Bay', 'p1', 'Mayor', undefined, 'san-gregorio');
  room.state.grid = createEmptyGrid();
  room.state.buildings = [];
  room.state.resources.money = 500_000;

  // Create a North-South coastline: x < 20 is open ocean, x >= 20 is flat shore
  for (let x = 0; x < 20; x++) {
    for (let z = 0; z < 64; z++) {
      room.state.grid[x][z].terrain = 'water';
    }
  }

  // Deep ocean (disconnected from shore) is rejected
  const deepSea = canPlaceBuilding(
    room.state.grid,
    { x: 5, z: 20 },
    BuildingType.WATERFRONT_PORT,
    room.state.resources,
    false,
    room.state.buildings,
  );
  assert.equal(deepSea.valid, false);
  assert.equal(deepSea.reason, 'Must connect to shore');

  // Dry inland is rejected
  const inland = canPlaceBuilding(
    room.state.grid,
    { x: 30, z: 20 },
    BuildingType.WATERFRONT_MARINA,
    room.state.resources,
    false,
    room.state.buildings,
  );
  assert.equal(inland.valid, false);
  assert.equal(inland.reason, 'Must be placed on waterfront');

  // Placing all 4 waterfront buildings along the NS coastline auto-orients them ('NS', facing West 'W')
  let zCursor = 10;
  for (const type of INFRA_WATERFRONT_TYPES) {
    const res = room.placeBuilding('p1', { x: 19, z: zCursor }, type);
    assert.equal(res.success, true, `Expected ${type} to place on shoreline`);
    const placed = room.state.buildings[room.state.buildings.length - 1];
    const facing = getWaterfrontFacing(room.state.grid, placed.position, placed.type, placed.orientation, true);
    assert.equal(facing, 'W', `Expected ${type} to face West toward open water`);
    zCursor += 6;
  }

  // Verify waterfront buildings contribute jobs to city labor stats
  const labor = calculateLaborStats(room.state);
  assert.equal(labor.jobs, 8 + 10 + 15 + 35);

  // Also test San Gregorio real terrain shoreline placement
  const realCoast = createEmptyGrid();
  applySiteTerrain(realCoast, 'san-gregorio');
  let validSpots = 0;
  for (let x = 15; x < 26; x++) {
    for (let z = 20; z < 45; z++) {
      if (canPlaceBuilding(realCoast, { x, z }, BuildingType.WATERFRONT_PORT, room.state.resources).valid) {
        validSpots++;
      }
    }
  }
  assert.ok(validSpots > 5, `Expected multiple valid port spots on San Gregorio coast, found ${validSpots}`);
});

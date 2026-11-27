import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_DEFS,
  BuildingType,
  CityRoom,
  INFRA_CATEGORIES,
  ZoneDensity,
  canPlaceBuilding,
  createEmptyGrid,
  getReplacedBuildings,
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

  // Every service category type is valid over empty + zoned tiles when funded
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
      assert.equal(res.valid, true, `Expected ${type} to be placeable`);
    }
  }
});

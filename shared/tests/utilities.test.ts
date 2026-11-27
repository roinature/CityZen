import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingType,
  CityRoom,
  DEFAULT_TOWN,
  ZoneDensity,
  canPlaceBuilding,
  createEmptyGrid,
  evaluateCityUtilities,
  getWaterSourceInfo,
  planTown,
  processZoneGrowth,
} from '../dist/index.js';

function makeCleanRoom(): CityRoom {
  const room = new CityRoom('c-util', 'UtilVille', 'p1', 'Mayor');
  room.state.grid = createEmptyGrid();
  room.state.buildings = [];
  room.state.resources.money = 100_000;
  room.state.tick = 100;
  return room;
}

test('power grid models subgrid islands, MW load vs generation, priority dispatch, and brownouts/blackouts', () => {
  const room = makeCleanRoom();

  // Place 3 high-density L3 industrial factories at (5, 5), (6, 5), (7, 5) -> 12 MW each = 36 MW demand
  for (const x of [5, 6, 7]) {
    room.placeBuilding('p1', { x, z: 5 }, BuildingType.ZONE_INDUSTRIAL, ZoneDensity.HIGH);
    const b = room.state.buildings.find(item => item.position.x === x && item.position.z === 5)!;
    b.developmentLevel = 3;
    b.developedAt = 0;
  }

  // Place a Wind Turbine (8 MW) far away at (45, 45) — isolated island, does not reach (5, 5)
  room.placeBuilding('p1', { x: 45, z: 45 }, BuildingType.ENERGY_WIND_TURBINE);
  let report = evaluateCityUtilities(room.state);
  assert.equal(report.summary.powerGenerationMW, 8);
  assert.equal(report.summary.poweredBuildings, 0);
  assert.equal(report.summary.unpoweredBuildings, 3);

  // Place a Solar Farm (22 MW) near the factories at (3, 5) -> 22 MW < 36 MW demand!
  // Two separate subgrids now exist (22 MW + 8 MW = 30 MW total, 2 subgrids)
  room.placeBuilding('p1', { x: 3, z: 5 }, BuildingType.ENERGY_SOLAR_FARM);
  report = evaluateCityUtilities(room.state);
  assert.equal(report.summary.powerSubgrids, 2);
  assert.equal(report.summary.powerGenerationMW, 30);
  // 22 MW covers 1 factory fully (12 MW), 2nd enters brownout (24 MW <= 27.5 MW), 3rd suffers blackout (36 MW > 27.5 MW)
  assert.equal(report.summary.poweredBuildings, 2);
  assert.equal(report.summary.brownoutBuildings, 1);
  assert.equal(report.summary.unpoweredBuildings, 1);

  // Add a Coal Plant (80 MW) at (20, 5) and wire Power Lines + Substation to merge into one healthy grid
  room.placeBuilding('p1', { x: 20, z: 5 }, BuildingType.ENERGY_COAL_PLANT);
  const linePositions = [];
  for (let x = 5; x <= 20; x++) linePositions.push({ x, z: 5 });
  const wired = room.placeBuildings('p1', { positions: linePositions, type: BuildingType.UTILITY_POWER_LINE });
  assert.equal(wired.success, true);

  report = evaluateCityUtilities(room.state);
  assert.equal(report.summary.poweredBuildings, 3);
  assert.equal(report.summary.brownoutBuildings, 0);
  assert.equal(report.summary.unpoweredBuildings, 0);
});

test('water pumps require water sources, need power to pump, and pressurize connected pipes & upland towers', () => {
  const room = makeCleanRoom();

  // Find a dry upland tile (not a water source) and a rich aquifer tile
  let dryPos = { x: 2, z: 2 };
  let sourcePos = { x: 31, z: 31 };
  assert.equal(getWaterSourceInfo(room.state.grid, dryPos.x, dryPos.z).isWaterSource, false);
  assert.equal(getWaterSourceInfo(room.state.grid, sourcePos.x, sourcePos.z).isWaterSource, true);

  // Pump Station CANNOT be placed on dry upland
  const badPump = canPlaceBuilding(room.state.grid, dryPos, BuildingType.WATER_PUMP_STATION, room.state.resources);
  assert.equal(badPump.valid, false);
  assert.match(badPump.reason ?? '', /water source/i);

  // Pump Station CAN be placed on aquifer source
  assert.equal(room.placeBuilding('p1', sourcePos, BuildingType.WATER_PUMP_STATION).success, true);

  // Place a residential apartment at (10, 31) and an upland Water Tower at (12, 31) (off-source)
  room.placeBuilding('p1', { x: 10, z: 31 }, BuildingType.ZONE_RESIDENTIAL, ZoneDensity.MEDIUM);
  const home = room.state.buildings.find(b => b.type === BuildingType.ZONE_RESIDENTIAL)!;
  home.developmentLevel = 1;
  assert.equal(getWaterSourceInfo(room.state.grid, 12, 31).isWaterSource, false);
  room.placeBuilding('p1', { x: 12, z: 31 }, BuildingType.WATER_TOWER);

  // Connect home + upland tower with pipes from x=10..31, but Pump Station has NO electricity yet!
  const pipePositions = [];
  for (let x = 10; x <= 31; x++) pipePositions.push({ x, z: 31 });
  assert.equal(room.placeBuildings('p1', { positions: pipePositions, type: BuildingType.UTILITY_WATER_PIPE }).success, true);

  let report = evaluateCityUtilities(room.state);
  assert.equal(report.summary.waterSupplyM3, 0, 'Unpowered pump + dry upland tower should yield 0 water');
  assert.equal(report.summary.wateredBuildings, 0);
  assert.equal(report.summary.unwateredBuildings, 1);

  // Power the Pump Station with an adjacent Solar Farm -> pipes pressurize AND upland Water Tower activates!
  room.placeBuilding('p1', { x: 33, z: 31 }, BuildingType.ENERGY_SOLAR_FARM);
  report = evaluateCityUtilities(room.state);
  assert.ok(report.summary.waterSupplyM3 > 400, `Expected pump + reservoir supply > 400, got ${report.summary.waterSupplyM3}`);
  assert.equal(report.summary.wateredBuildings, 1);
  assert.equal(report.summary.unwateredBuildings, 0);
});

test('multi-layer conduits coexist under roads/zones and layer-specific bulldoze preserves surface buildings', () => {
  const room = makeCleanRoom();

  // Place a street at (15, 15), plus a Power Line, Water Pipe, and Sewage Pipe on the exact same cell
  assert.equal(room.placeBuilding('p1', { x: 15, z: 15 }, BuildingType.ROAD_STREET).success, true);
  assert.equal(room.placeBuilding('p1', { x: 15, z: 15 }, BuildingType.UTILITY_POWER_LINE).success, true);
  assert.equal(room.placeBuilding('p1', { x: 15, z: 15 }, BuildingType.UTILITY_WATER_PIPE).success, true);
  assert.equal(room.placeBuilding('p1', { x: 15, z: 15 }, BuildingType.UTILITY_SEWAGE_PIPE).success, true);

  const cell = room.state.grid[15][15];
  assert.ok(cell.buildingId, 'Surface road preserved');
  assert.ok(cell.powerLineId, 'Overhead power line stored in power slot');
  assert.ok(cell.waterPipeId, 'Water pipe stored in water slot');
  assert.ok(cell.sewagePipeId, 'Sewage pipe stored in sewage slot');

  // Bulldozing in 'water' layer removes ONLY the water pipe
  assert.equal(room.demolishBuilding({ x: 15, z: 15 }, 'water').success, true);
  assert.equal(cell.waterPipeId, null);
  assert.ok(cell.buildingId, 'Road untouched by water bulldoze');
  assert.ok(cell.sewagePipeId, 'Sewage pipe untouched by water bulldoze');

  // Bulldozing in 'sewage' layer removes ONLY the sewage pipe
  assert.equal(room.demolishBuilding({ x: 15, z: 15 }, 'sewage').success, true);
  assert.equal(cell.sewagePipeId, null);
  assert.ok(cell.buildingId, 'Road untouched by sewage bulldoze');
  assert.ok(cell.powerLineId, 'Power line untouched by sewage bulldoze');

  // Bulldozing in 'power' layer removes ONLY the power line
  assert.equal(room.demolishBuilding({ x: 15, z: 15 }, 'power').success, true);
  assert.equal(cell.powerLineId, null);
  assert.ok(cell.buildingId, 'Road still intact');
});

test('zone upgrades enforce Electricity + Water for Level 2 and Sewage for Level 3', () => {
  const room = makeCleanRoom();
  room.state.resources.population = 500;
  room.state.resources.happiness = 85;
  room.state.resources.demand = { residential: 1, commercial: 1, industrial: 1 };

  room.placeBuilding('p1', { x: 30, z: 30 }, BuildingType.ZONE_RESIDENTIAL, ZoneDensity.HIGH);
  const resZone = room.state.buildings[0];
  resZone.developmentLevel = 1;
  resZone.developedAt = 0;

  const origRandom = Math.random;
  Math.random = () => 0;
  try {
    // 1. Without power & water, cannot upgrade from L1 -> L2
    room.state.tick = 100;
    assert.equal(processZoneGrowth(room.state).upgradedBuildings.length, 0);
    assert.equal(resZone.developmentLevel, 1);

    // 2. Add Power + Water (on central aquifer at 31, 31) -> unlocks L2, but blocks L3 without Sewage!
    room.placeBuilding('p1', { x: 28, z: 30 }, BuildingType.ENERGY_SOLAR_FARM);
    room.placeBuilding('p1', { x: 31, z: 31 }, BuildingType.WATER_PUMP_STATION);
    room.state.tick = 200;
    assert.equal(processZoneGrowth(room.state).upgradedBuildings.length, 1);
    assert.equal(resZone.developmentLevel, 2);

    // Still no sewage -> L2 -> L3 is blocked
    room.state.tick = 300;
    assert.equal(processZoneGrowth(room.state).upgradedBuildings.length, 0);
    assert.equal(resZone.developmentLevel, 2);

    // 3. Add Sewage Station -> unlocks L3!
    room.placeBuilding('p1', { x: 28, z: 32 }, BuildingType.SEWAGE_PUMP_STATION);
    room.state.tick = 400;
    assert.equal(processZoneGrowth(room.state).upgradedBuildings.length, 1);
    assert.equal(resZone.developmentLevel, 3);
  } finally {
    Math.random = origRandom;
  }
});

test('TownPlanner with services enabled lays connected power, water, and sewage networks', () => {
  const terrain = createEmptyGrid();
  const plan = planTown(terrain, { ...DEFAULT_TOWN, services: true, built: 0.4 }, 'tp', 'p1');
  const room = makeCleanRoom();
  room.state.grid = plan.grid;
  room.state.buildings = plan.buildings;

  const report = evaluateCityUtilities(room.state);
  assert.ok(report.summary.powerGenerationMW > 0, 'Planned town should generate electricity');
  assert.ok(report.summary.waterSupplyM3 > 0, 'Planned town should have an active water source');
  assert.ok(report.summary.sewageCapacityM3 > 0, 'Planned town should have sewage treatment');
  assert.ok(report.summary.poweredBuildings > 0, 'Planned town buildings should be powered');
  assert.ok(report.summary.wateredBuildings > 0, 'Planned town buildings should receive piped water');
  assert.ok(report.summary.drainedBuildings > 0, 'Planned town buildings should drain sewage');
});

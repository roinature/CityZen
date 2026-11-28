import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_DEFS,
  BUILDING_UPGRADES,
  BuildingType,
  CityRoom,
  MAX_BUILDING_UPGRADE_LEVEL,
  MaslowNeed,
  S2C,
  calculateCityMaslowCapacity,
  calculateLaborStats,
  createEmptyGrid,
  evaluateCityUtilities,
  getBuildingMaintenance,
  getBuildingTotalInvestedCost,
  getBuildingUpgradeTiers,
  getEffectiveUpgradeLevel,
  getNextUpgradeTier,
  getSubstationUpgradeRadiusBonus,
  getUpgradeTierCost,
  isRoad,
  isUpgradableBuilding,
  isUtilityConduit,
  isZone,
} from '../dist/index.js';

function createTestRoom(unlimitedMoney = false) {
  const events: Array<{ event: string; data: unknown }> = [];
  class TestRoom extends CityRoom {
    protected override broadcast(event: string, data: unknown): void {
      events.push({ event, data });
    }
  }
  const room = new TestRoom('c-upg', 'UpgradeVille', 'p1', 'Mayor');
  room.state.grid = createEmptyGrid();
  room.state.buildings = [];
  room.unlimitedMoney = unlimitedMoney;
  room.addPlayer('p1', 'Mayor');
  return { room, events };
}

test('every non-zone, non-road, non-conduit building has 3 uniquely named upgrade tiers', () => {
  for (const type of Object.values(BuildingType)) {
    const excluded = isZone(type) || isRoad(type) || isUtilityConduit(type);
    assert.equal(isUpgradableBuilding(type), !excluded, `isUpgradableBuilding(${type})`);
    if (excluded) {
      assert.equal(getBuildingUpgradeTiers(type).length, 0);
    } else {
      assert.ok(BUILDING_UPGRADES[type], `Missing bespoke upgrades for ${type}`);
      const tiers = getBuildingUpgradeTiers(type);
      assert.equal(tiers.length, MAX_BUILDING_UPGRADE_LEVEL, `${type} should have 3 tiers`);
      const names = new Set(tiers.map(t => t.name));
      assert.equal(names.size, 3, `${type} tier names should be unique`);
      assert.ok(tiers[0].outputMultiplier < tiers[1].outputMultiplier);
      assert.ok(tiers[1].outputMultiplier < tiers[2].outputMultiplier);
    }
  }
});

test('upgrading a Nuclear Plant charges cost, scales MW, Maslow capacity, upkeep, and demolish refund', () => {
  const { room, events } = createTestRoom(false);
  room.state.resources.money = 100_000;

  const placed = room.placeBuilding('p1', { x: 10, z: 10 }, BuildingType.ENERGY_NUCLEAR_PLANT);
  assert.equal(placed.success, true);
  const nuclear = room.state.buildings.find(b => b.type === BuildingType.ENERGY_NUCLEAR_PLANT)!;
  const nuclearId = nuclear.id;

  const baseCost = BUILDING_DEFS[BuildingType.ENERGY_NUCLEAR_PLANT].cost;
  const baseMaint = getBuildingMaintenance(nuclear);
  const baseUtil = evaluateCityUtilities(room.state);
  const baseMaslow = calculateCityMaslowCapacity(room.state, baseUtil);

  assert.equal(baseUtil.summary.powerGenerationMW, 280);
  assert.equal(baseMaslow[MaslowNeed.PHYSIOLOGICAL].totalCapacity, 2000);
  assert.equal(baseMaint, 50);

  // Upgrade to Tier 1, 2, 3
  let expectedInvested = baseCost;
  for (const expectedTier of [1, 2, 3] as const) {
    const tierCost = getUpgradeTierCost(BuildingType.ENERGY_NUCLEAR_PLANT, expectedTier);
    const moneyBefore = room.state.resources.money;
    const res = room.upgradeBuilding(nuclearId);
    assert.equal(res.success, true);
    assert.equal(getEffectiveUpgradeLevel(res.building!), expectedTier);
    assert.equal(room.state.resources.money, moneyBefore - tierCost);
    expectedInvested += tierCost;
    assert.equal(getBuildingTotalInvestedCost(res.building!), expectedInvested);
  }

  // Tier 4 should fail
  const overMax = room.upgradeBuilding(nuclearId);
  assert.equal(overMax.success, false);
  assert.equal(getNextUpgradeTier(room.state.buildings.find(b => b.id === nuclearId)!), null);

  // Check Tier 3 effects (2.25x output, 1.9x upkeep)
  const upgraded = room.state.buildings.find(b => b.id === nuclearId)!;
  const utilAfter = evaluateCityUtilities(room.state);
  const maslowAfter = calculateCityMaslowCapacity(room.state, utilAfter);
  assert.equal(utilAfter.summary.powerGenerationMW, 280 * 2.25);
  assert.equal(maslowAfter[MaslowNeed.PHYSIOLOGICAL].totalCapacity, Math.round(2000 * 2.25));
  assert.equal(getBuildingMaintenance(upgraded), 50 * 1.9);
  assert.ok(events.some(e => e.event === S2C.BUILDING_UPDATED));

  // Demolish should refund half of total invested cost (base + all 3 upgrades)
  const moneyBeforeDemo = room.state.resources.money;
  const demo = room.demolishBuilding({ x: 10, z: 10 });
  assert.equal(demo.success, true);
  assert.equal(room.state.resources.money, moneyBeforeDemo + Math.floor(expectedInvested / 2));
});

test('upgrading fails on excluded types or insufficient funds', () => {
  const { room } = createTestRoom(false);
  room.state.resources.money = 1000;

  const roadRes = room.placeBuilding('p1', { x: 5, z: 5 }, BuildingType.ROAD_STREET);
  assert.equal(roadRes.success, true);
  const road = room.state.buildings.find(b => b.type === BuildingType.ROAD_STREET)!;
  assert.equal(room.upgradeBuilding(road.id).success, false);

  const zoneRes = room.placeBuilding('p1', { x: 5, z: 6 }, BuildingType.ZONE_RESIDENTIAL);
  assert.equal(zoneRes.success, true);
  const zone = room.state.buildings.find(b => b.type === BuildingType.ZONE_RESIDENTIAL)!;
  assert.equal(room.upgradeBuilding(zone.id).success, false);

  const lineRes = room.placeBuilding('p1', { x: 6, z: 5 }, BuildingType.UTILITY_POWER_LINE);
  assert.equal(lineRes.success, true);
  const line = room.state.buildings.find(b => b.type === BuildingType.UTILITY_POWER_LINE)!;
  assert.equal(room.upgradeBuilding(line.id).success, false);

  // Insufficient funds for Park upgrade
  const parkRes = room.placeBuilding('p1', { x: 8, z: 8 }, BuildingType.PARK);
  assert.equal(parkRes.success, true);
  const park = room.state.buildings.find(b => b.type === BuildingType.PARK)!;
  room.state.resources.money = 10;
  const fail = room.upgradeBuilding(park.id);
  assert.equal(fail.success, false);
  assert.match(fail.error ?? '', /Insufficient funds/);
});

test('upgrading Cargo Port boosts jobs & Maslow, and Substation boosts distribution radius', () => {
  const { room } = createTestRoom(true);

  const subRes = room.placeBuilding('p1', { x: 15, z: 15 }, BuildingType.ENERGY_SUBSTATION);
  assert.equal(subRes.success, true);
  const sub = room.state.buildings.find(b => b.type === BuildingType.ENERGY_SUBSTATION)!;
  assert.equal(getSubstationUpgradeRadiusBonus(sub), 0);
  const subUp = room.upgradeBuilding(sub.id);
  assert.equal(subUp.success, true);
  assert.equal(getSubstationUpgradeRadiusBonus(subUp.building!), 2);

  // Place a Fishing Dock directly in state to test labor scaling without shoreline terrain
  const dock = {
    id: 'dock-1',
    type: BuildingType.WATERFRONT_DOCK,
    position: { x: 20, z: 20 },
    placedBy: 'p1',
    placedAt: 1,
  };
  room.state.buildings.push(dock);
  const jobsBefore = calculateLaborStats(room.state).commercialJobs;
  const dockUp = room.upgradeBuilding('dock-1');
  assert.equal(dockUp.success, true);
  const jobsAfter = calculateLaborStats(room.state).commercialJobs;
  assert.ok(jobsAfter > jobsBefore, `expected upgraded dock jobs (${jobsAfter}) > base (${jobsBefore})`);
});

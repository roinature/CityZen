import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BuildingType,
  CityRoom,
  PopulationManager,
  S2C,
  SERVICE_BUILDING_FLEETS,
  createEmptyGrid,
  type CityEmergencyOutcome,
  type PlacedBuilding,
} from '@cityzen/shared';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/client/src/')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

// Contact shadows draw onto a canvas; a stub is enough off-screen.
(globalThis as { document?: unknown }).document ??= {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillRect: () => {},
      fillStyle: '',
    }),
  }),
};

const { CarManager } = await import('../src/world/CarManager.ts');
const { EmergencyEffects } = await import('../src/world/EmergencyEffects.ts');
const { BuildingFactory } = await import('../src/world/BuildingFactory.ts');
const { CITY_STYLES } = await import('../src/world/CityStyle.ts');
const { indexRoads } = await import('../src/world/RoadSurface.ts');
const { findDepotDriveway } = await import('../src/world/DepotDriveway.ts');

let nextId = 1;
const place = (type: BuildingType, x: number, z: number): PlacedBuilding => ({
  id: `b${nextId++}`, type, position: { x, z }, placedBy: 'p1', placedAt: 0,
});

function buildTown(service: BuildingType) {
  const buildings: PlacedBuilding[] = [];
  // An east-west street with a north-south street crossing it.
  for (let x = 2; x <= 40; x++) buildings.push(place(BuildingType.ROAD_STREET, x, 10));
  for (let z = 2; z <= 30; z++) if (z !== 10) buildings.push(place(BuildingType.ROAD_STREET, 21, z));
  const depot = place(service, 5, 11);
  buildings.push(depot);
  for (let x = 25; x <= 38; x += 3) buildings.push(place(BuildingType.ZONE_RESIDENTIAL, x, 9));
  for (let z = 15; z <= 28; z += 3) buildings.push(place(BuildingType.ZONE_RESIDENTIAL, 22, z));
  const state = { buildings, grid: new Array(64).fill(null).map(() => []) };
  return { state, depot };
}

for (const [service, kind] of [
  [BuildingType.FIRE_STATION, 'fire'],
  [BuildingType.POLICE_STATION, 'police'],
  [BuildingType.HEALTH_CLINIC, 'ambulance'],
  [BuildingType.WATER_SEWAGE_PLANT, 'garbage'],
  [BuildingType.TRANS_BUS_DEPOT, 'bus'],
] as const) {
  test(`${kind} vehicles leave their depot, drive out and come back`, () => {
    const scene = new THREE.Scene();
    const cars = new CarManager(scene);
    cars.setMaxCars(0); // service vehicles only
    const { state, depot } = buildTown(service);
    const home = { x: depot.position.x + 1, z: depot.position.z + 1 };

    let farthest = 0;
    let dwelled = false;
    let returned = false;
    let seen = false;
    let tracked: { id: number } | null = null;
    for (let frame = 0; frame < 60 * 240 && !returned; frame++) {
      cars.update(1 / 60, state as never);
      const list = (cars as unknown as { cars: { id: number; x: number; z: number; leaving: number; service?: { kind: string; home: string; returning: boolean; dwell: number } }[] }).cars;
      const v = tracked ? list.find(c => c.id === tracked!.id) : list.find(c => c.service);
      if (!v) {
        if (tracked) assert.fail('vehicle vanished before returning');
        continue;
      }
      tracked = v;
      seen = true;
      assert.equal(v.service!.kind, kind);
      assert.equal(v.service!.home, depot.id);
      farthest = Math.max(farthest, Math.abs(v.x - home.x) + Math.abs(v.z - home.z));
      if (v.service!.dwell > 0) dwelled = true;
      if (v.leaving >= 0) {
        assert.ok(v.service!.returning, 'only leaves once back at base');
        // Pulls into the depot's enclosed garage bay without shrinking away.
        assert.equal((v as unknown as { mesh: THREE.Group }).mesh.scale.x, 1, 'vehicle must not shrink when entering driveway bay');
        assert.equal((v as unknown as { mesh: THREE.Group }).mesh.visible, false, 'vehicle hides once inside the enclosed garage bay');
        assert.ok(Math.abs(v.x - home.x) < 1.6 && Math.abs(v.z - home.z) < 1.6, `back near depot (${v.x}, ${v.z})`);
        returned = true;
      }
    }
    assert.ok(seen, 'a vehicle was dispatched');
    assert.ok(dwelled, 'it stopped somewhere in town');
    assert.ok(farthest >= 6, `it drove into town (${farthest.toFixed(1)} cells)`);
    assert.ok(returned, 'it came back');
  });
}

function createEmergencyTestRoom() {
  const events: Array<{ event: string; data: unknown }> = [];
  class TestRoom extends CityRoom {
    protected override broadcast(event: string, data: unknown): void {
      events.push({ event, data });
    }
  }
  const room = new TestRoom('c-em', 'Metro', 'p1', 'Mayor');
  room.state.grid = createEmptyGrid();
  room.state.buildings = [];
  room.unlimitedMoney = true;
  room.addPlayer('p1', 'Mayor');

  // Straight east-west street
  for (let x = 4; x <= 30; x++) {
    room.placeBuilding('p1', { x, z: 12 }, BuildingType.ROAD_STREET);
  }

  // Developed zones along the street
  for (let i = 0; i < 4; i++) {
    const x = 18 + i * 3;
    room.placeBuilding('p1', { x, z: 11 }, i % 2 === 0 ? BuildingType.ZONE_RESIDENTIAL : BuildingType.ZONE_COMMERCIAL);
    const b = room.state.buildings.find(item => item.position.x === x && item.position.z === 11)!;
    b.developmentLevel = 2;
    b.developedAt = 1;
  }

  const pop = new PopulationManager();
  pop.initWorldPopulation(30, 0);
  pop.seedCity(room.id, 20);
  pop.assignPeopleToZones(room.id, room.state.buildings);

  return { room, pop, events };
}

for (const [emergencyKind, serviceBuilding, expectedVehicle] of [
  ['fire', BuildingType.FIRE_STATION, 'fire'],
  ['robbery', BuildingType.POLICE_STATION, 'police'],
  ['medical', BuildingType.HEALTH_CLINIC, 'ambulance'],
  ['sewage_overflow', BuildingType.WATER_SEWAGE_PLANT, 'garbage'],
] as const) {
  test(`${emergencyKind} dispatches a ${expectedVehicle} vehicle to the incident, resolves it, and returns to depot`, () => {
    const { room, events } = createEmergencyTestRoom();
    room.placeBuilding('p1', { x: 6, z: 13 }, serviceBuilding);

    const target = room.state.buildings.find(b => b.position.x === 24 && b.position.z === 11)!;
    const em = room.spawnEmergency(emergencyKind, target.id)!;
    assert.ok(em, 'emergency spawned');

    const scene = new THREE.Scene();
    const cars = new CarManager(scene);
    const effects = new EmergencyEffects();
    scene.add(effects.group);
    cars.setMaxCars(0);

    let arrivedCount = 0;
    let resolvedCount = 0;
    cars.onEmergencyArrived = (id) => {
      assert.equal(id, em.id);
      arrivedCount++;
      room.markEmergencyResponding(id);
    };
    cars.onEmergencyResolved = (id) => {
      assert.equal(id, em.id);
      resolvedCount++;
      room.resolveEmergency(id);
    };

    effects.update(1 / 60, room.state);
    assert.equal(effects.group.children.length, 1, '3D visual effect added while emergency active');

    let returnedHome = false;
    for (let frame = 0; frame < 60 * 90 && !returnedHome; frame++) {
      cars.update(1 / 60, room.state);
      effects.update(1 / 60, room.state);
      const list = (cars as unknown as { cars: { leaving: number; service?: { kind: string; returning: boolean } }[] }).cars;
      if (resolvedCount > 0 && list.some(c => c.service?.kind === expectedVehicle && c.service.returning && c.leaving >= 0)) {
        returnedHome = true;
      }
    }

    assert.equal(arrivedCount, 1, 'responder arrived on scene');
    assert.equal(resolvedCount, 1, 'responder resolved the emergency');
    assert.equal(room.state.emergencies?.length ?? 0, 0, 'emergency cleared from city state');
    assert.equal(effects.group.children.length, 0, '3D visual effect cleaned up after resolution');
    assert.ok(returnedHome, 'responder drove back to its depot afterwards');

    const outcomeEvt = events.find(e => e.event === S2C.EMERGENCY_OUTCOME) as { data: { outcome: CityEmergencyOutcome } } | undefined;
    assert.equal(outcomeEvt?.data.outcome.resolution, 'resolved');
    assert.equal(outcomeEvt?.data.outcome.deaths, 0);
  });
}

test('unanswered emergencies expire with building destruction and citizen deaths', () => {
  // 1. Fire without Fire Station -> razes zone to level 0 & kills citizens
  {
    const { room, pop } = createEmergencyTestRoom();
    const target = room.state.buildings.find(b => b.position.x === 18 && b.position.z === 11)!;
    const popBefore = pop.getCityPopulationCount(room.id);
    const em = room.spawnEmergency('fire', target.id)!;

    const clock = { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 };
    while ((room.state.emergencies ?? []).some(e => e.id === em.id)) {
      clock.gameTimeMs += 3_600_000;
      room.worldTick(clock, pop.getCityPopulationSummary(room.id), undefined, pop);
    }

    const updatedTarget = room.state.buildings.find(b => b.id === target.id)!;
    assert.equal(updatedTarget.developmentLevel, 0, 'unanswered fire burned zone down to level 0');
    assert.ok(pop.getCityPopulationCount(room.id) < popBefore, 'unanswered fire caused citizen deaths');
  }

  // 2. Fire on non-zone civic building -> completely demolishes building
  {
    const { room, pop } = createEmergencyTestRoom();
    room.placeBuilding('p1', { x: 10, z: 13 }, BuildingType.EDU_LIBRARY);
    const library = room.state.buildings.find(b => b.type === BuildingType.EDU_LIBRARY)!;
    const em = room.spawnEmergency('fire', library.id)!;

    const clock = { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 };
    while ((room.state.emergencies ?? []).some(e => e.id === em.id)) {
      clock.gameTimeMs += 3_600_000;
      room.worldTick(clock, pop.getCityPopulationSummary(room.id), undefined, pop);
    }
    assert.equal(room.state.buildings.find(b => b.id === library.id), undefined, 'civic building destroyed by fire');
  }

  // 3. Medical emergency without Clinic/Hospital -> citizen deaths
  {
    const { room, pop } = createEmergencyTestRoom();
    const target = room.state.buildings.find(b => b.position.x === 18 && b.position.z === 11)!;
    const popBefore = pop.getCityPopulationCount(room.id);
    const em = room.spawnEmergency('medical', target.id)!;

    const clock = { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 };
    while ((room.state.emergencies ?? []).some(e => e.id === em.id)) {
      clock.gameTimeMs += 3_600_000;
      room.worldTick(clock, pop.getCityPopulationSummary(room.id), undefined, pop);
    }
    assert.ok(pop.getCityPopulationCount(room.id) < popBefore, 'unanswered medical emergency caused deaths');
  }

  // 4. Robbery & Sewage overflow without police/sewage -> money loss, property damage, casualties
  for (const kind of ['robbery', 'sewage_overflow'] as const) {
    const { room, pop, events } = createEmergencyTestRoom();
    room.unlimitedMoney = false;
    room.state.resources.money = 5000;
    const target = room.state.buildings.find(b => b.position.x === 21 && b.position.z === 11)!;
    const levelBefore = target.developmentLevel!;
    const em = room.spawnEmergency(kind, target.id)!;

    const clock = { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 };
    while ((room.state.emergencies ?? []).some(e => e.id === em.id)) {
      clock.gameTimeMs += 3_600_000;
      room.worldTick(clock, pop.getCityPopulationSummary(room.id), undefined, pop);
    }

    const outcomeEvt = events.filter(e => e.event === S2C.EMERGENCY_OUTCOME).pop() as { data: { outcome: CityEmergencyOutcome } };
    assert.equal(outcomeEvt.data.outcome.resolution, 'failed');
    assert.ok(outcomeEvt.data.outcome.moneyLost > 0, `${kind} caused treasury loss`);
    const updatedTarget = room.state.buildings.find(b => b.id === target.id)!;
    assert.ok((updatedTarget.developmentLevel ?? 0) < levelBefore, `${kind} damaged building development level`);
  }
});

test('all fleet-producing buildings include driveways and align to adjacent roads on every side', () => {
  const factory = new BuildingFactory();
  const fleetTypes = Object.keys(SERVICE_BUILDING_FLEETS) as BuildingType[];
  assert.ok(fleetTypes.length >= 10, 'expected all fleet buildings');

  for (const type of fleetTypes) {
    const preview = factory.createPreview(type, true, CITY_STYLES.classic);
    let meshCount = 0;
    preview.traverse((c) => { if (c instanceof THREE.Mesh) meshCount++; });
    assert.ok(meshCount >= 12, `expected ${type} preview to include driveway & garage bay meshes, got ${meshCount}`);
  }

  // Verify road-side detection aligns the driveway to N, S, E, and W streets
  const cases: Array<{ road: [number, number][]; expectedFacing: 'N' | 'S' | 'E' | 'W' }> = [
    { road: [[10, 9], [11, 9]], expectedFacing: 'N' },
    { road: [[10, 12], [11, 12]], expectedFacing: 'S' },
    { road: [[9, 10], [9, 11]], expectedFacing: 'W' },
    { road: [[12, 10], [12, 11]], expectedFacing: 'E' },
  ];
  for (const { road, expectedFacing } of cases) {
    const depot = place(BuildingType.FIRE_STATION, 10, 10);
    const buildings = [depot, ...road.map(([x, z]) => place(BuildingType.ROAD_STREET, x, z))];
    const dw = findDepotDriveway(depot, indexRoads(buildings));
    assert.equal(dw.hasRoad, true);
    assert.equal(dw.facing, expectedFacing, `expected driveway to face ${expectedFacing}`);
    // Bay interior must lie strictly inside the 2x2 building footprint [10..12, 10..12]
    assert.ok(dw.bayX > 10.2 && dw.bayX < 11.8, `bayX ${dw.bayX} inside depot`);
    assert.ok(dw.bayZ > 10.2 && dw.bayZ < 11.8, `bayZ ${dw.bayZ} inside depot`);
  }
});

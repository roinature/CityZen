import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BuildingType,
  CELL_SIZE,
  CityRoom,
  MaslowNeed,
  S2C,
  ZoneDensity,
  createEmptyGrid,
  evaluateCityUtilities,
  getBuildingMaintenance,
  getEffectiveFleetSize,
  hasOperationalResponder,
} from '@cityzen/shared';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/client/src/')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

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
const { BoatManager } = await import('../src/world/BoatManager.ts');
const { GridRaycaster } = await import('../src/input/Raycaster.ts');
const { computeBuildingServiceReach } = await import('../src/ui/BuildingCard.ts');

function createTestRoom() {
  const events: Array<{ event: string; data: unknown }> = [];
  class TestRoom extends CityRoom {
    protected override broadcast(event: string, data: unknown): void {
      events.push({ event, data });
    }
  }
  const room = new TestRoom('c-card', 'CardTown', 'p1', 'Mayor');
  room.state.grid = createEmptyGrid();
  room.state.buildings = [];
  room.unlimitedMoney = true;
  room.addPlayer('p1', 'Mayor');
  return { room, events };
}

test('fleet size customization updates upkeep, broadcasts BUILDING_UPDATED, and suspends responder at 0', () => {
  const { room, events } = createTestRoom();
  for (let x = 4; x <= 25; x++) {
    room.placeBuilding('p1', { x, z: 10 }, BuildingType.ROAD_STREET);
  }
  room.placeBuilding('p1', { x: 6, z: 11 }, BuildingType.POLICE_STATION);
  const police = room.state.buildings.find(b => b.type === BuildingType.POLICE_STATION)!;

  assert.equal(getEffectiveFleetSize(police), 1);
  assert.equal(getBuildingMaintenance(police), 10);
  assert.equal(hasOperationalResponder(room.state, 'robbery'), true);

  // Scale up fleet to max (4 cruisers)
  const up = room.setBuildingFleetSize(police.id, 99);
  assert.equal(up.success, true);
  assert.equal(getEffectiveFleetSize(police), 4, 'clamped to maxFleet');
  assert.equal(getBuildingMaintenance(police), 10 + 3 * 3, 'adds $3/tick per extra cruiser');
  assert.ok(events.some(e => e.event === S2C.BUILDING_UPDATED), 'broadcasts BUILDING_UPDATED');

  // Ground fleet to 0
  const zero = room.setBuildingFleetSize(police.id, 0);
  assert.equal(zero.success, true);
  assert.equal(getEffectiveFleetSize(police), 0);
  assert.equal(hasOperationalResponder(room.state, 'robbery'), false, '0-vehicle station cannot respond');
  assert.ok(getBuildingMaintenance(police) < 10, 'grounded fleet reduces upkeep');
});

test('CarManager reports depot status, manually dispatches, and recalls patrol units', () => {
  const { room } = createTestRoom();
  for (let x = 4; x <= 34; x++) {
    room.placeBuilding('p1', { x, z: 12 }, BuildingType.ROAD_STREET);
  }
  room.placeBuilding('p1', { x: 6, z: 13 }, BuildingType.FIRE_HQ);
  room.placeBuilding('p1', { x: 28, z: 11 }, BuildingType.ZONE_RESIDENTIAL);
  const fireHq = room.state.buildings.find(b => b.type === BuildingType.FIRE_HQ)!;

  const scene = new THREE.Scene();
  const cars = new CarManager(scene);
  cars.setMaxCars(0);

  // Works even before any update tick when state is passed (paused city support)
  const initial = cars.getDepotFleetStatus(fireHq.id, room.state);
  assert.equal(initial.hasRoadAccess, true);
  assert.equal(initial.configuredFleet, 2);
  assert.equal(initial.standbyCount, 2);
  assert.equal(initial.vehicles.length, 0);

  // Manual dispatch from the card
  const dispatched = cars.dispatchDepotVehicle(fireHq.id, room.state);
  assert.equal(dispatched, true);

  const afterDispatch = cars.getDepotFleetStatus(fireHq.id);
  assert.equal(afterDispatch.vehicles.length, 1);
  assert.equal(afterDispatch.standbyCount, 1);
  assert.equal(afterDispatch.vehicles[0].state, 'patrolling');

  // Advance a bit so it pulls onto the street, then recall
  for (let i = 0; i < 90; i++) cars.update(1 / 60, room.state);
  const recalled = cars.recallDepotVehicles(fireHq.id);
  assert.equal(recalled, 1);
  const afterRecall = cars.getDepotFleetStatus(fireHq.id);
  assert.equal(afterRecall.vehicles[0].state, 'returning');
});

test('BoatManager reports waterfront berth status and dispatches inbound vessels', () => {
  const { room } = createTestRoom();
  // Create open coastal water along z >= 20
  for (let x = 0; x < 64; x++) {
    for (let z = 20; z < 64; z++) {
      room.state.grid[x][z].terrain = 'water';
    }
  }
  room.placeBuilding('p1', { x: 20, z: 19 }, BuildingType.WATERFRONT_MARINA, undefined, 'EW');
  const marina = room.state.buildings.find(b => b.type === BuildingType.WATERFRONT_MARINA)!;
  assert.ok(marina, 'marina placed on shoreline');

  const scene = new THREE.Scene();
  const boats = new BoatManager(scene);

  const status0 = boats.getBuildingMaritimeStatus(marina.id, room.state);
  assert.ok(status0.totalBerths >= 1, 'marina exposes navigable berths');
  assert.equal(status0.occupiedBerths, 0);

  const called = boats.dispatchVesselToBuilding(marina.id, room.state);
  assert.equal(called, true, 'inbound vessel dispatched to marina');

  const status1 = boats.getBuildingMaritimeStatus(marina.id, room.state);
  assert.equal(status1.occupiedBerths, 1);
  assert.equal(status1.vessels.length, 1);
  assert.equal(status1.vessels[0].phase, 'cruising');
});

test('GridRaycaster.pickBuilding selects 3D buildings and ignores roads', () => {
  const { room } = createTestRoom();
  room.placeBuilding('p1', { x: 10, z: 10 }, BuildingType.ROAD_STREET);
  room.placeBuilding('p1', { x: 12, z: 10 }, BuildingType.HEALTH_HOSPITAL);
  room.placeBuilding('p1', { x: 18, z: 10 }, BuildingType.ZONE_COMMERCIAL, ZoneDensity.HIGH);
  const zone = room.state.buildings.find(b => b.type === BuildingType.ZONE_COMMERCIAL)!;
  zone.developmentLevel = 3;

  const fakeCanvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  } as unknown as HTMLCanvasElement;
  const raycaster = new GridRaycaster(fakeCanvas);

  // Top-down orthographic camera centered over (13.5, 11.5) in cells
  const cx = 13.5 * CELL_SIZE;
  const cz = 11.5 * CELL_SIZE;
  const cam = new THREE.OrthographicCamera(-20 * CELL_SIZE, 20 * CELL_SIZE, 15 * CELL_SIZE, -15 * CELL_SIZE, 0.1, 500);
  cam.position.set(cx, 100, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();

  // Screen center -> (13.5, 11.5) -> inside 3x3 Hospital at (12..15, 10..13)
  const hitHospital = raycaster.pickBuilding(400, 300, cam, room.state);
  assert.equal(hitHospital?.type, BuildingType.HEALTH_HOSPITAL);

  // Project road center (10.5, 10.5) to screen -> should NOT select road
  const roadVec = new THREE.Vector3(10.5 * CELL_SIZE, 0, 10.5 * CELL_SIZE).project(cam);
  const roadSx = ((roadVec.x + 1) / 2) * 800;
  const roadSy = ((-roadVec.y + 1) / 2) * 600;
  assert.equal(raycaster.pickBuilding(roadSx, roadSy, cam, room.state), null);

  // Project commercial tower (18.5, 10.5) to screen -> selects zone
  const zoneVec = new THREE.Vector3(18.5 * CELL_SIZE, 0, 10.5 * CELL_SIZE).project(cam);
  const zoneSx = ((zoneVec.x + 1) / 2) * 800;
  const zoneSy = ((-zoneVec.y + 1) / 2) * 600;
  assert.equal(raycaster.pickBuilding(zoneSx, zoneSy, cam, room.state)?.id, zone.id);
});

test('computeBuildingServiceReach allocates citizens by quality and utility efficiency', () => {
  const { room } = createTestRoom();
  room.state.resources.population = 250;

  // Power & water setup so High School & Elementary School are fully supplied
  room.placeBuilding('p1', { x: 5, z: 5 }, BuildingType.ENERGY_SOLAR_FARM);
  room.placeBuilding('p1', { x: 8, z: 5 }, BuildingType.EDU_HIGH_SCHOOL);   // value 18, cap 300
  room.placeBuilding('p1', { x: 8, z: 8 }, BuildingType.EDU_ELEMENTARY);    // value 15, cap 150
  // Add water tower on aquifer center (31, 31) and pipe? Or check efficiency scaling directly!
  const highSchool = room.state.buildings.find(b => b.type === BuildingType.EDU_HIGH_SCHOOL)!;
  const elementary = room.state.buildings.find(b => b.type === BuildingType.EDU_ELEMENTARY)!;

  const utilities = evaluateCityUtilities(room.state);
  const hsReach = computeBuildingServiceReach(room.state, highSchool, utilities);
  const elReach = computeBuildingServiceReach(room.state, elementary, utilities);

  assert.equal(hsReach[0].need, MaslowNeed.COGNITIVE);
  assert.ok(hsReach[0].effectiveCapacity > 0);
  // High school has higher quality (18 > 15), so it serves citizens first up to its effective capacity
  const expectedHsServed = Math.min(250, hsReach[0].effectiveCapacity);
  assert.equal(hsReach[0].served, expectedHsServed);
  assert.equal(elReach[0].served, Math.min(elReach[0].effectiveCapacity, Math.max(0, 250 - expectedHsServed)));
});

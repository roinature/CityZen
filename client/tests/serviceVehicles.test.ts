import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BuildingType, type PlacedBuilding } from '@cityzen/shared';

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
        // Pulls into the depot lot, not somewhere out on the road.
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

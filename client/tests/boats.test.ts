import { registerHooks } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BuildingType,
  CityRoom,
  createEmptyGrid,
} from '@cityzen/shared';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/client/src/')) {
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
    return nextResolve(specifier, context);
  },
});

const { BoatManager, WaterNetwork } = await import('../src/world/BoatManager.ts');
const { createServiceModel } = await import('../src/world/ServiceModels.ts');
const { CITY_STYLES } = await import('../src/world/CityStyle.ts');

function buildCoastalCity() {
  const room = new CityRoom('c-boats', 'Port Zen', 'p1', 'Mayor');
  room.state.grid = createEmptyGrid();
  room.state.buildings = [];
  room.state.resources.money = 500_000;

  // West ocean: x = 0..21 is water, x = 22..63 is buildable shore
  for (let x = 0; x < 22; x++) {
    for (let z = 0; z < 64; z++) {
      room.state.grid[x][z].terrain = 'water';
    }
  }
  return room;
}

test('WaterNetwork discovers berths and BoatManager navigates boats to dock at ports and marinas', () => {
  const room = buildCoastalCity();

  // Place a Cargo Port, Ferry Terminal, Marina, and Fishing Dock along the coast
  assert.equal(room.placeBuilding('p1', { x: 20, z: 14 }, BuildingType.WATERFRONT_PORT).success, true);
  assert.equal(room.placeBuilding('p1', { x: 21, z: 24 }, BuildingType.WATERFRONT_FERRY).success, true);
  assert.equal(room.placeBuilding('p1', { x: 21, z: 32 }, BuildingType.WATERFRONT_MARINA).success, true);
  assert.equal(room.placeBuilding('p1', { x: 21, z: 40 }, BuildingType.WATERFRONT_DOCK).success, true);

  const net = new WaterNetwork(room.state.grid, room.state.buildings);
  // Port(1) + Ferry(1) + Marina(2) + Dock(1) = 5 berths
  assert.equal(net.berths.length, 5);
  assert.ok(net.edgeGates.length >= 6);

  const scene = new THREE.Scene();
  const manager = new BoatManager(scene);
  manager.setMaxBoats(12);

  let sawDocking = false;
  let sawDocked = false;
  let sawDeparting = false;

  // Advance simulation ~45 seconds in 50ms steps
  for (let step = 0; step < 900; step++) {
    manager.update(0.05, room.state);
    for (const boat of manager.getBoats()) {
      if (boat.phase === 'docking') sawDocking = true;
      if (boat.phase === 'docked') sawDocked = true;
      if (boat.phase === 'undocking' || boat.phase === 'departing') sawDeparting = true;
    }
  }

  assert.ok(manager.getBoats().length > 0, 'Expected active boats on coastal map');
  assert.equal(sawDocking, true, 'Expected boats to approach and dock at waterfront berths');
  assert.equal(sawDocked, true, 'Expected boats to moor at berths');
  assert.equal(sawDeparting, true, 'Expected moored boats to undock and depart after their stay');

  // Demolishing a port cleanly releases its berth and lets docked boats depart
  room.demolishBuilding({ x: 20, z: 14 });
  manager.update(0.05, room.state);
  assert.equal(manager.getBerths().length, 4);

  manager.clear();
  assert.equal(manager.getBoats().length, 0);
});

test('createServiceModel rotates waterfront buildings to face open water', () => {
  const room = buildCoastalCity();
  room.placeBuilding('p1', { x: 20, z: 20 }, BuildingType.WATERFRONT_PORT);
  const port = room.state.buildings[0];
  const model = createServiceModel(port, CITY_STYLES.classic, room.state.grid);
  const inner = model.children[0] ?? model;
  // Facing West ('W') rotates by +PI/2
  assert.ok(Math.abs(model.rotation.y - Math.PI / 2) < 1e-6 || Math.abs(inner.rotation.y - Math.PI / 2) < 1e-6);
});

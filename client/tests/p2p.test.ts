import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CityRoom,
  GAME_MS_PER_TICK,
  MaslowNeed,
  PopulationManager,
  TICKS_PER_GAME_DAY,
  WorldTickEngine,
  type WorldCityEntry,
  type WorldState,
} from '@cityzen/shared';
import { resolveSiteConflicts } from '../src/network/p2p/siteConflict.ts';
import { LocalStore, parseBackupJson } from '../src/network/p2p/LocalStore.ts';
import { buildIceConfig } from '../src/network/p2p/rtcConfig.ts';

test('PopulationManager extractCityPersons and admitPersons round-trip cleanly', () => {
  const source = new PopulationManager();
  source.initWorldPopulation(20, 0);
  const seeded = source.seedCity('city-a', 5);
  assert.equal(source.getCityPopulationCount('city-a'), 5);

  const movingIds = seeded.slice(0, 3).map(p => p.id);
  const extracted = source.extractCityPersons('city-a', movingIds);

  assert.equal(extracted.length, 3);
  assert.equal(source.getCityPopulationCount('city-a'), 2);
  // Every extracted tuple clears residenceZoneId (index 11)
  for (const tuple of extracted) {
    assert.equal(tuple[11], null);
  }

  const dest = new PopulationManager();
  const admitted = dest.admitPersons('city-b', extracted);
  assert.equal(admitted, 3);
  assert.equal(dest.getCityPopulationCount('city-b'), 3);

  // Duplicate admission is idempotent
  const duplicateAdmitted = dest.admitPersons('city-b', extracted);
  assert.equal(duplicateAdmitted, 0);
  assert.equal(dest.getCityPopulationCount('city-b'), 3);
});

test('WorldTickEngine delegates cross-city migration to remote peer cities and sums totalPopulation', () => {
  const pm = new PopulationManager();
  pm.initWorldPopulation(40, 0);
  const residents = pm.seedCity('local-city', 10);
  // Make local residents very unhappy so migration evaluates them as candidates
  for (const person of residents) {
    for (const need of Object.values(MaslowNeed)) {
      person.maslow[need] = 10;
    }
  }

  const localRoom = new CityRoom('local-city', 'Local', 'owner-1', 'Alice', undefined, 'san-gregorio');

  const world: WorldState = {
    id: 'w1',
    name: 'Earth',
    gridSize: 8,
    maxCities: 3,
    // Position clock one tick before a day boundary so step() immediately triggers daily migration
    clock: { gameTimeMs: (TICKS_PER_GAME_DAY - 1) * GAME_MS_PER_TICK, speed: 1, gameDay: 0, gameYear: 1 },
    totalPopulation: 0,
    initialPopulation: 40,
    createdAt: 1,
    updatedAt: 1,
    cities: [
      {
        cityId: 'local-city',
        ownerId: 'owner-1',
        ownerName: 'Alice',
        name: 'Local',
        position: { wx: 0, wz: 0 },
        population: 10,
        happiness: 10,
        edgeConnections: [{ direction: 'east', positions: [5] }],
      },
      {
        cityId: 'remote-city',
        ownerId: 'owner-2',
        ownerName: 'Bob',
        name: 'Remote Utopia',
        position: { wx: 1, wz: 0 },
        population: 25,
        happiness: 95,
        edgeConnections: [{ direction: 'west', positions: [5] }],
      },
    ],
  };

  const remoteMigrations: Array<{ from: string; to: string; ids: string[] }> = [];
  const engine = new WorldTickEngine(
    world,
    () => [localRoom],
    pm,
    { toAll: () => {}, toCity: () => {} },
    {
      onRemoteMigration: (from, to, ids) => {
        remoteMigrations.push({ from, to, ids });
      },
    },
  );

  engine.step();

  assert.ok(remoteMigrations.length >= 1, 'Expected at least one remote migration offer');
  assert.equal(remoteMigrations[0].from, 'local-city');
  assert.equal(remoteMigrations[0].to, 'remote-city');
  assert.ok(remoteMigrations[0].ids.length >= 1);

  // World totalPopulation should include both local PopulationManager + remote city population (25)
  assert.equal(world.totalPopulation, pm.getTotalPopulation() + 25);
});

test('resolveSiteConflicts deterministically picks earliest createdAt then cityId and preserves losers', () => {
  const makeEntry = (cityId: string, siteId: string | undefined, createdAt?: number): WorldCityEntry => ({
    cityId,
    siteId,
    ownerId: `owner-${cityId}`,
    ownerName: cityId,
    name: `City ${cityId}`,
    position: { wx: 100, wz: 100 },
    population: 10,
    happiness: 50,
    createdAt,
  });

  const { winners, losers } = resolveSiteConflicts([
    makeEntry('city-b', 'san-gregorio', 2000),
    makeEntry('city-a', 'san-gregorio', 1000),
    makeEntry('city-d', 'san-joaquin', 5000),
    makeEntry('city-c', 'san-joaquin', 5000), // same timestamp: 'city-c' < 'city-d'
    makeEntry('legacy-1', undefined, 9999),
  ]);

  const winnerIds = new Set(winners.map(w => w.cityId));
  const loserIds = new Set(losers.map(l => l.cityId));

  assert.deepEqual(winnerIds, new Set(['city-a', 'city-c', 'legacy-1']));
  assert.deepEqual(loserIds, new Set(['city-b', 'city-d']));
});

test('LocalStore exports and imports v2 backups cleanly with validation', async () => {
  const store = new LocalStore();
  const room = new CityRoom('c1', 'My Town', 'p1', 'Alice', undefined, 'san-gregorio');
  const pm = new PopulationManager();
  pm.initWorldPopulation(10, 0);
  pm.seedCity('c1', 5);

  await store.saveOwnedWorld({
    version: 2,
    worldId: 'world-a',
    clock: { gameTimeMs: 1200, speed: 1, gameDay: 2, gameYear: 1 },
    population: pm.serialize(),
    cities: [{ city: room.state, createdAt: 100, savedAt: 200 }],
    savedAt: 200,
  });

  await store.savePeerCity(
    'world-a',
    {
      cityId: 'c2',
      siteId: 'san-joaquin',
      ownerId: 'p2',
      ownerName: 'Bob',
      name: 'Bobville',
      position: { wx: 200, wz: 100 },
      population: 15,
      happiness: 75,
    },
    new CityRoom('c2', 'Bobville', 'p2', 'Bob', undefined, 'san-joaquin').state,
  );

  const rawBackup = await store.exportBackup('world-a');
  const parsed = parseBackupJson(rawBackup);
  assert.ok(parsed);
  assert.equal(parsed.owned?.cities.length, 1);
  assert.equal(parsed.peerCities.length, 1);

  // Import into a different worldId and verify both owned and cached peer city restore
  const restored = await store.importBackup(rawBackup, 'world-b');
  assert.ok(restored);
  const ownedB = await store.loadOwnedWorld('world-b');
  const peersB = await store.loadPeerCities('world-b');
  assert.equal(ownedB?.cities[0].city.name, 'My Town');
  assert.equal(peersB.length, 1);
  assert.equal(peersB[0].snapshot?.name, 'Bobville');

  // Malformed backup rejected
  assert.equal(parseBackupJson('{"format":"wrong"}'), null);
  assert.equal(parseBackupJson('not json'), null);
});

test('buildIceConfig defaults to STUN and parses optional TURN env vars', () => {
  const defaultCfg = buildIceConfig({});
  assert.equal(defaultCfg.hasTurn, false);
  assert.equal(defaultCfg.turnConfig.length, 0);
  assert.ok((defaultCfg.rtcConfig.iceServers?.length ?? 0) >= 2);

  const singleTurn = buildIceConfig({
    VITE_TURN_URL: 'turn:turn.example.com:3478, turns:turn.example.com:5349',
    VITE_TURN_USERNAME: 'alice',
    VITE_TURN_CREDENTIAL: 'secret',
  });
  assert.equal(singleTurn.hasTurn, true);
  assert.equal(singleTurn.turnConfig.length, 1);
  assert.deepEqual(singleTurn.turnConfig[0].urls, [
    'turn:turn.example.com:3478',
    'turns:turn.example.com:5349',
  ]);
  assert.equal(singleTurn.turnConfig[0].username, 'alice');

  const jsonTurn = buildIceConfig({
    VITE_ICE_SERVERS: JSON.stringify([
      { urls: 'turns:cf.example.com:443', username: 'u', credential: 'p' },
    ]),
  });
  assert.equal(jsonTurn.hasTurn, true);
  assert.equal(jsonTurn.turnConfig.length, 1);
});

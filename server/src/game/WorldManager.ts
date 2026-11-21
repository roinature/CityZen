import { v4 as uuid } from 'uuid';
import {
  type WorldState,
  type WorldCityEntry,
  type EdgeConnection,
  S2C,
  getSite,
  INITIAL_CITY_SEED,
  AUTO_SAVE_INTERVAL_MS,
  calculateEdgeConnections,
} from '@cityzen/shared';
import { IS_SERVERLESS } from '../config.js';
import { RoomManager } from './RoomManager.js';
import { WorldTickEngine } from './WorldTickEngine.js';
import { PopulationManager } from './PopulationManager.js';
import { GameRoom } from './GameRoom.js';
import {
  saveWorldState,
  loadWorldState,
  loadOrCreateDefaultWorld,
  loadPopulationData,
} from '../persistence/worldStore.js';
import { foundEarthCity } from '../persistence/jsonStore.js';
import { broadcastToAll } from '../realtime/supabaseBroadcast.js';

interface WorldInstance {
  state: WorldState;
  tickEngine: WorldTickEngine;
  populationManager: PopulationManager;
  saveInterval?: ReturnType<typeof setInterval>;
  saving?: boolean;
  /** False while the residents are still loading from the database. */
  populationLoaded: boolean;
  stopped?: boolean;
}

export class WorldManager {
  private worlds = new Map<string, WorldInstance>();
  private roomManager: RoomManager;

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
  }

  async init(): Promise<void> {
    // Load the default world on startup
    const { state, isNew } = await loadOrCreateDefaultWorld();
    await this.startWorldInstance(state, isNew);
  }

  private async startWorldInstance(state: WorldState, isNew: boolean): Promise<WorldInstance> {
    const populationManager = new PopulationManager();
    const tickEngine = new WorldTickEngine(
      state,
      () => this.roomManager.getActiveRooms().filter(r => {
        // Only return rooms belonging to this world
        return state.cities.some(c => c.cityId === r.id);
      }),
      populationManager,
    );
    const instance: WorldInstance = { state, tickEngine, populationManager, populationLoaded: false };
    this.worlds.set(state.id, instance);

    if (isNew) {
      populationManager.initWorldPopulation(state.initialPopulation, state.clock.gameTimeMs);
      state.totalPopulation = populationManager.getTotalPopulation();
      this.finishPopulationLoad(instance);
    } else {
      // Load the cities in the background. Waiting for all of them here made
      // start-up take about a minute on a remote database, and every request
      // hung until it finished. A city someone joins before its turn is loaded
      // on demand (getOrLoadRoom de-duplicates), and the tick engine simply
      // picks rooms up as they arrive.
      void this.preloadRooms(state);
      // The residents are one large JSON value that can take minutes to arrive
      // over a slow link, so they load in the background too. Until then the
      // world (cities, clock, total population) is served from the world row,
      // the tick engine stays paused, and saves leave the stored people alone.
      void this.loadPopulationInBackground(instance);
    }

    // Persist the people and the world clock while someone is playing. Cities
    // auto-save themselves, but the residents live in the world record: without
    // this, everyone who moved in since the last plot claim was lost on restart
    // and cities fell back to their founding population.
    instance.saveInterval = setInterval(() => {
      const hasPlayers = this.roomManager.getActiveRooms().some(
        r => r.players.size > 0 && state.cities.some(c => c.cityId === r.id),
      );
      if (hasPlayers && !instance.saving) void this.save(state.id, IS_SERVERLESS);
    }, AUTO_SAVE_INTERVAL_MS);

    console.log(`World loaded: "${state.name}" (${state.id}) with ${state.cities.length} cities`);
    return instance;
  }

  private async loadPopulationInBackground(instance: WorldInstance): Promise<void> {
    const { state, populationManager } = instance;
    const started = Date.now();
    for (let attempt = 1; !instance.stopped; attempt++) {
      try {
        const popData = await loadPopulationData(state.id);
        if (instance.stopped) return;
        if (popData && popData.length > 0) {
          // Copy restored data into the instance the tick engine already holds
          Object.assign(populationManager, PopulationManager.deserialize(popData));
          console.log(
            `Restored ${populationManager.getTotalPopulation()} persons for world "${state.name}" ` +
            `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
          );
        } else {
          populationManager.initWorldPopulation(state.initialPopulation, state.clock.gameTimeMs);
        }
        this.finishPopulationLoad(instance);
        return;
      } catch (err) {
        const delayMs = Math.min(60_000, 5_000 * attempt);
        console.error(`Failed to load population for world "${state.name}" (retrying in ${delayMs / 1000}s):`, err);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  private finishPopulationLoad(instance: WorldInstance): void {
    const { state, populationManager } = instance;
    // Re-seed cities that have no residents: ones founded while the people
    // were still loading, or ones that lost their population assignments
    // (e.g. populationData column was added after cities were created).
    for (const city of state.cities) {
      if (populationManager.getCityPopulationCount(city.cityId) === 0 && populationManager.getUnassignedCount() > 0) {
        const seeded = populationManager.seedCity(city.cityId, INITIAL_CITY_SEED);
        city.population = seeded.length;
        if (seeded.length > 0) {
          console.log(`Re-seeded city "${city.name}" with ${seeded.length} people`);
        }
      }
    }
    state.totalPopulation = populationManager.getTotalPopulation();
    instance.populationLoaded = true;
    if (!instance.stopped) instance.tickEngine.start();
    console.log(
      `Population ready for world "${state.name}": ${populationManager.getTotalPopulation()} people ` +
      `(${populationManager.getUnassignedCount()} unassigned)`,
    );
  }

  private async preloadRooms(state: WorldState): Promise<void> {
    const LOAD_BATCH = 4;
    const cityIds = state.cities.map(c => c.cityId);
    const started = Date.now();
    for (let i = 0; i < cityIds.length; i += LOAD_BATCH) {
      await Promise.all(
        cityIds.slice(i, i + LOAD_BATCH).map(id =>
          this.roomManager.getOrLoadRoom(id).catch((err) => {
            console.error(`Failed to preload city ${id} (will load when someone joins):`, err);
            return null;
          }),
        ),
      );
    }
    console.log(`Preloaded ${cityIds.length} cities for world "${state.name}" in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  // ── World CRUD ──────────────────────────────────────────────

  async loadWorld(worldId: string): Promise<WorldState | null> {
    if (worldId !== 'default') return null;
    // Already loaded?
    const existing = this.worlds.get(worldId);
    if (existing && !IS_SERVERLESS) return existing.state;

    const state = await loadWorldState(worldId);
    if (!state) return null;
    if (existing) {
      // Another worker may have claimed a plot or edited a city's edge roads.
      const cachedCities = new Map(existing.state.cities.map(city => [city.cityId, city]));
      existing.state.cities = state.cities.map(city => {
        const cached = cachedCities.get(city.cityId);
        return cached ? { ...city, population: cached.population, happiness: cached.happiness } : city;
      });
      return existing.state;
    }

    const instance = await this.startWorldInstance(state, false);
    return instance.state;
  }

  // ── Accessors (default to 'default' world for backwards compat) ──

  getWorldState(worldId = 'default'): WorldState {
    return this.worlds.get(worldId)!.state;
  }

  getPopulationManager(worldId = 'default'): PopulationManager {
    return this.worlds.get(worldId)!.populationManager;
  }

  /** Get city IDs belonging to a world */
  getCityIdsForWorld(worldId: string): string[] {
    const instance = this.worlds.get(worldId);
    if (!instance) return [];
    return instance.state.cities.map(c => c.cityId);
  }

  /** Find which world a city belongs to */
  findWorldForCity(cityId: string): WorldInstance | undefined {
    for (const instance of this.worlds.values()) {
      if (instance.state.cities.some(c => c.cityId === cityId)) {
        return instance;
      }
    }
    return undefined;
  }

  setGameSpeed(speed: number, worldId = 'default'): { success: boolean; error?: string } {
    const instance = this.worlds.get(worldId);
    if (!instance) return { success: false, error: 'World not found' };
    return instance.tickEngine.setGameSpeed(speed);
  }

  getGameSpeed(worldId = 'default'): number {
    return this.worlds.get(worldId)?.tickEngine.getGameSpeed() ?? 1;
  }

  async claimSite(siteId: string, cityName: string, ownerId: string, ownerName: string) {
    const site = getSite(siteId);
    if (!site) return { success: false, error: 'Choose an Earth site' };
    const instance = this.worlds.get('default')!;
    const room = new GameRoom(uuid(), cityName, ownerId, ownerName, undefined, undefined, site.id);
    const entry: WorldCityEntry = {
      cityId: room.id, ownerId, ownerName, name: cityName, position: site.position, siteId: site.id,
      population: 0, happiness: 50, edgeConnections: calculateEdgeConnections(room.state.buildings),
    };
    const revision = await foundEarthCity(room.state, entry);
    if (revision === null) return { success: false, error: 'Another city already occupies this site' };
    room.syncPersistedState({ ...room.state, updatedAt: revision });
    this.roomManager.activate(room);
    // While the people are still loading the city starts empty; it is seeded
    // as soon as they arrive (see finishPopulationLoad).
    entry.population = instance.populationLoaded
      ? instance.populationManager.seedCity(room.id, INITIAL_CITY_SEED).length
      : 0;
    instance.state.cities = [...instance.state.cities.filter(city => city.cityId !== entry.cityId), entry];
    instance.state.updatedAt = Date.now();
    await this.save('default', IS_SERVERLESS);
    broadcastToAll(S2C.WORLD_STATE, { world: instance.state });
    return { success: true, cityId: room.id };
  }

  updateCityPopulation(cityId: string, population: number): void {
    const instance = this.findWorldForCity(cityId);
    if (!instance) return;
    const entry = instance.state.cities.find((c: WorldCityEntry) => c.cityId === cityId);
    if (entry) {
      entry.population = population;
    }
  }

  updateCityEdgeConnections(cityId: string, connections: EdgeConnection[]): void {
    const instance = this.findWorldForCity(cityId);
    if (!instance) return;
    const entry = instance.state.cities.find((c: WorldCityEntry) => c.cityId === cityId);
    if (entry) {
      entry.edgeConnections = connections;
      instance.state.updatedAt = Date.now();

      broadcastToAll(S2C.WORLD_STATE, { world: instance.state });
      this.save(instance.state.id);
    }
  }

  getCityEntry(cityId: string): WorldCityEntry | undefined {
    const instance = this.findWorldForCity(cityId);
    if (!instance) return undefined;
    return instance.state.cities.find((c: WorldCityEntry) => c.cityId === cityId);
  }

  async publishCityEdges(worldId: string, cityId: string): Promise<void> {
    const world = await loadWorldState(worldId);
    if (!world) return;
    const edges = world.cities.find(city => city.cityId === cityId)?.edgeConnections;
    const cached = this.getCityEntry(cityId);
    if (cached && edges) cached.edgeConnections = edges;
    await broadcastToAll(S2C.WORLD_STATE, { world });
  }

  async save(worldId = 'default', preserveCities = false): Promise<void> {
    const instance = this.worlds.get(worldId);
    if (!instance) return;
    // Explicit saves (plot claims etc.) always go through; overlapping ones just queue in the DB.
    instance.saving = true;
    try {
      // Never overwrite the stored people with the empty placeholder that
      // exists while they are still loading.
      const populationData = instance.populationLoaded ? instance.populationManager.serialize() : undefined;
      await saveWorldState(instance.state, populationData, preserveCities);
    } catch (err) {
      console.error(`Failed to save world state (${worldId}):`, err);
    } finally {
      instance.saving = false;
    }
  }

  shutdown(): void {
    for (const instance of this.worlds.values()) {
      instance.stopped = true;
      instance.tickEngine.stop();
      if (instance.saveInterval) clearInterval(instance.saveInterval);
    }
  }
}

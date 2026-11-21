import { v4 as uuid } from 'uuid';
import {
  type WorldState,
  type WorldPosition,
  type WorldCityEntry,
  type EdgeConnection,
  S2C,
  WORLD_MAP_SIZE,
  INITIAL_CITY_SEED,
  DEFAULT_GRID_SIZE,
  INITIAL_RESOURCES,
  AUTO_SAVE_INTERVAL_MS,
  calculateEdgeConnections,
} from '@cityzen/shared';
import { RoomManager } from './RoomManager.js';
import { WorldTickEngine } from './WorldTickEngine.js';
import { PopulationManager } from './PopulationManager.js';
import { CityGenerator, type CitySize } from './CityGenerator.js';
import {
  saveWorldState,
  loadWorldState,
  loadOrCreateDefaultWorld,
  loadPopulationData,
  listWorlds as listWorldsFromDb,
} from '../persistence/worldStore.js';
import { deleteCityState } from '../persistence/jsonStore.js';
import { broadcastToAll } from '../realtime/supabaseBroadcast.js';

interface WorldInstance {
  state: WorldState;
  tickEngine: WorldTickEngine;
  populationManager: PopulationManager;
  saveInterval?: ReturnType<typeof setInterval>;
  saving?: boolean;
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

    if (isNew) {
      populationManager.initWorldPopulation(
        state.initialPopulation,
        state.clock.gameTimeMs,
      );
      state.totalPopulation = populationManager.getTotalPopulation();
    } else {
      const popData = await loadPopulationData(state.id);
      if (popData && popData.length > 0) {
        const restored = PopulationManager.deserialize(popData);
        // Copy restored data into our instance
        Object.assign(populationManager, restored);
        state.totalPopulation = populationManager.getTotalPopulation();
        console.log(`Restored ${populationManager.getTotalPopulation()} persons for world "${state.name}"`);
      } else {
        populationManager.initWorldPopulation(
          state.initialPopulation,
          state.clock.gameTimeMs,
        );
        state.totalPopulation = populationManager.getTotalPopulation();
      }
    }

    // Pre-load rooms for existing cities so the tick engine can update them.
    // Also re-seed any cities that lost their population assignments
    // (e.g. populationData column was added after cities were created).
    if (!isNew) {
      // Load the cities in the background. Waiting for all of them here made
      // start-up take about a minute on a remote database, and every request
      // hung until it finished. A city someone joins before its turn is loaded
      // on demand (getOrLoadRoom de-duplicates), and the tick engine simply
      // picks rooms up as they arrive.
      void this.preloadRooms(state);
      for (const city of state.cities) {
        if (populationManager.getCityPopulationCount(city.cityId) === 0 && populationManager.getUnassignedCount() > 0) {
          const seeded = populationManager.seedCity(city.cityId, INITIAL_CITY_SEED);
          city.population = seeded.length;
          if (seeded.length > 0) {
            console.log(`Re-seeded city "${city.name}" with ${seeded.length} people`);
          }
        }
      }
    }

    const tickEngine = new WorldTickEngine(
      state,
      () => this.roomManager.getActiveRooms().filter(r => {
        // Only return rooms belonging to this world
        return state.cities.some(c => c.cityId === r.id);
      }),
      populationManager,
    );
    tickEngine.start();

    const instance: WorldInstance = { state, tickEngine, populationManager };
    this.worlds.set(state.id, instance);

    // Persist the people and the world clock while someone is playing. Cities
    // auto-save themselves, but the residents live in the world record: without
    // this, everyone who moved in since the last plot claim was lost on restart
    // and cities fell back to their founding population.
    instance.saveInterval = setInterval(() => {
      const hasPlayers = this.roomManager.getActiveRooms().some(
        r => r.players.size > 0 && state.cities.some(c => c.cityId === r.id),
      );
      if (hasPlayers && !instance.saving) void this.save(state.id);
    }, AUTO_SAVE_INTERVAL_MS);

    console.log(
      `World loaded: "${state.name}" (${state.id}) with ${state.cities.length} cities, ` +
      `${populationManager.getTotalPopulation()} people (${populationManager.getUnassignedCount()} unassigned)`,
    );

    return instance;
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

  async createWorld(
    name: string,
    config?: { gridSize?: number; maxCities?: number; initialPopulation?: number },
  ): Promise<WorldState> {
    const state: WorldState = {
      id: uuid(),
      name,
      gridSize: config?.gridSize ?? 8,
      maxCities: config?.maxCities ?? 64,
      cities: [],
      clock: { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 },
      totalPopulation: config?.initialPopulation ?? 100,
      initialPopulation: config?.initialPopulation ?? 100,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveWorldState(state);
    await this.startWorldInstance(state, true);
    return state;
  }

  async loadWorld(worldId: string): Promise<WorldState | null> {
    // Already loaded?
    const existing = this.worlds.get(worldId);
    if (existing) return existing.state;

    const state = await loadWorldState(worldId);
    if (!state) return null;

    const instance = await this.startWorldInstance(state, false);
    return instance.state;
  }

  async listWorlds(): Promise<Array<{ id: string; name: string; totalPopulation: number; cityCount: number }>> {
    return listWorldsFromDb();
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

  isPlotAvailable(position: WorldPosition, worldId = 'default'): boolean {
    const instance = this.worlds.get(worldId);
    if (!instance) return false;
    if (position.wx < 0 || position.wx >= WORLD_MAP_SIZE ||
      position.wz < 0 || position.wz >= WORLD_MAP_SIZE) {
      return false;
    }
    return !instance.state.cities.some(
      (c: WorldCityEntry) => c.position.wx === position.wx && c.position.wz === position.wz
    );
  }

  async claimPlot(
    position: WorldPosition,
    cityName: string,
    ownerId: string,
    ownerName: string,
    worldId = 'default',
  ): Promise<{ success: boolean; cityId?: string; error?: string }> {
    const instance = this.worlds.get(worldId);
    if (!instance) return { success: false, error: 'World not found' };

    if (!this.isPlotAvailable(position, worldId)) {
      return { success: false, error: 'Plot is not available' };
    }

    const room = await this.roomManager.createRoom(cityName, ownerId, ownerName);

    const seeded = instance.populationManager.seedCity(room.id, INITIAL_CITY_SEED);

    const entry: WorldCityEntry = {
      cityId: room.id,
      ownerId,
      ownerName,
      name: cityName,
      position,
      population: seeded.length,
      happiness: 50,
      edgeConnections: calculateEdgeConnections(room.state.buildings),
    };
    instance.state.cities.push(entry);
    instance.state.updatedAt = Date.now();

    await this.save(worldId);

    broadcastToAll(S2C.WORLD_STATE, { world: instance.state });

    console.log(`City "${cityName}" seeded with ${seeded.length} people in world "${instance.state.name}" (${instance.populationManager.getUnassignedCount()} remain in pool)`);

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

  async save(worldId = 'default'): Promise<void> {
    const instance = this.worlds.get(worldId);
    if (!instance) return;
    // Explicit saves (plot claims etc.) always go through; overlapping ones just queue in the DB.
    instance.saving = true;
    try {
      const populationData = instance.populationManager.serialize();
      await saveWorldState(instance.state, populationData);
    } catch (err) {
      console.error(`Failed to save world state (${worldId}):`, err);
    } finally {
      instance.saving = false;
    }
  }

  // ── World Generation ─────────────────────────────────────

  async generateWorld(
    worldId: string,
    cityConfigs: Array<{ position: WorldPosition; name: string; citySize?: CitySize }>,
    onProgress?: (completed: number, total: number, cityName: string) => void,
  ): Promise<{ success: boolean; citiesGenerated: number; error?: string }> {
    const instance = this.worlds.get(worldId);
    if (!instance) return { success: false, citiesGenerated: 0, error: 'World not found' };

    const generator = new CityGenerator();
    let generated = 0;

    for (const cityConfig of cityConfigs) {
      if (!this.isPlotAvailable(cityConfig.position, worldId)) {
        continue;
      }

      // Get neighbor cities for edge matching
      const neighborCities = this.getAdjacentCities(cityConfig.position, worldId);

      // Generate city layout with size parameters
      const result = generator.generateCityLayout({
        gridSize: DEFAULT_GRID_SIZE,
        neighborCities,
        worldPosition: cityConfig.position,
        citySize: cityConfig.citySize,
      });

      // Create room and apply generated layout
      const systemOwnerId = 'system';
      const systemOwnerName = 'CityZen AI';
      const room = await this.roomManager.createRoom(
        cityConfig.name, systemOwnerId, systemOwnerName,
      );

      room.state.grid = result.grid;
      room.state.buildings = result.buildings;
      room.state.resources = {
        ...INITIAL_RESOURCES,
        money: result.startingMoney,
      };

      // Seed population based on city size
      const seeded = instance.populationManager.seedCity(room.id, result.populationSeed);

      // Add world city entry with edge connections
      const entry: WorldCityEntry = {
        cityId: room.id,
        ownerId: systemOwnerId,
        ownerName: systemOwnerName,
        name: cityConfig.name,
        position: cityConfig.position,
        population: seeded.length,
        happiness: 50,
        edgeConnections: result.edgeConnections,
      };
      instance.state.cities.push(entry);

      // Persist
      await room.forceSave();

      generated++;
      onProgress?.(generated, cityConfigs.length, cityConfig.name);

      console.log(
        `Generated ${cityConfig.citySize ?? 'medium'} city "${cityConfig.name}" at (${cityConfig.position.wx},${cityConfig.position.wz}) ` +
        `with ${result.buildings.length} buildings, ${seeded.length} people, $${result.startingMoney}`,
      );
    }

    instance.state.updatedAt = Date.now();
    await this.save(worldId);

    broadcastToAll(S2C.WORLD_STATE, { world: instance.state });

    return { success: true, citiesGenerated: generated };
  }

  async clearWorldCities(worldId = 'default'): Promise<{ success: boolean; removed: number; error?: string }> {
    const instance = this.worlds.get(worldId);
    if (!instance) return { success: false, removed: 0, error: 'World not found' };

    const cityIds = instance.state.cities.map(c => c.cityId);
    let removed = 0;

    for (const cityId of cityIds) {
      this.roomManager.removeRoom(cityId);
      await deleteCityState(cityId);
      removed++;
    }

    instance.state.cities = [];
    instance.state.updatedAt = Date.now();
    await this.save(worldId);

    broadcastToAll(S2C.WORLD_STATE, { world: instance.state });

    console.log(`Cleared ${removed} cities from world "${instance.state.name}"`);
    return { success: true, removed };
  }

  private getAdjacentCities(position: WorldPosition, worldId: string): WorldCityEntry[] {
    const instance = this.worlds.get(worldId);
    if (!instance) return [];

    const deltas = [
      { dx: -1, dz: 0 }, { dx: 1, dz: 0 },
      { dx: 0, dz: -1 }, { dx: 0, dz: 1 },
    ];

    return deltas
      .map(d => instance.state.cities.find(
        c => c.position.wx === position.wx + d.dx && c.position.wz === position.wz + d.dz,
      ))
      .filter((c): c is WorldCityEntry => c !== undefined);
  }

  shutdown(): void {
    for (const instance of this.worlds.values()) {
      instance.tickEngine.stop();
      if (instance.saveInterval) clearInterval(instance.saveInterval);
    }
  }
}

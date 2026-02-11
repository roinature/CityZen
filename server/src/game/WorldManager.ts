import { v4 as uuid } from 'uuid';
import {
  type WorldState,
  type WorldPosition,
  type WorldCityEntry,
  type EdgeConnection,
  S2C,
  WORLD_MAP_SIZE,
  INITIAL_CITY_SEED,
} from '@cityzen/shared';
import { RoomManager } from './RoomManager.js';
import { WorldTickEngine } from './WorldTickEngine.js';
import { PopulationManager } from './PopulationManager.js';
import {
  saveWorldState,
  loadWorldState,
  loadOrCreateDefaultWorld,
  loadPopulationData,
  listWorlds as listWorldsFromDb,
} from '../persistence/worldStore.js';
import { broadcastToAll } from '../realtime/supabaseBroadcast.js';

interface WorldInstance {
  state: WorldState;
  tickEngine: WorldTickEngine;
  populationManager: PopulationManager;
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

    console.log(
      `World loaded: "${state.name}" (${state.id}) with ${state.cities.length} cities, ` +
      `${populationManager.getTotalPopulation()} people (${populationManager.getUnassignedCount()} unassigned)`,
    );

    return instance;
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
    try {
      const populationData = instance.populationManager.serialize();
      await saveWorldState(instance.state, populationData);
    } catch (err) {
      console.error(`Failed to save world state (${worldId}):`, err);
    }
  }

  shutdown(): void {
    for (const instance of this.worlds.values()) {
      instance.tickEngine.stop();
    }
  }
}

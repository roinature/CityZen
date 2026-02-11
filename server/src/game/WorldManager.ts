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
import { saveWorldState, loadOrCreateDefaultWorld } from '../persistence/worldStore.js';
import { broadcastToAll } from '../realtime/supabaseBroadcast.js';

export class WorldManager {
  private world!: WorldState;
  private roomManager: RoomManager;
  private tickEngine!: WorldTickEngine;
  private populationManager!: PopulationManager;

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
  }

  async init(): Promise<void> {
    const { state, isNew } = await loadOrCreateDefaultWorld();
    this.world = state;

    // Initialize population manager
    // TODO (Phase 7): deserialize from persisted populationData if available
    this.populationManager = new PopulationManager();
    if (isNew) {
      this.populationManager.initWorldPopulation(
        this.world.initialPopulation,
        this.world.clock.gameTimeMs,
      );
      this.world.totalPopulation = this.populationManager.getTotalPopulation();
    }

    // Create and start the world-level tick engine
    this.tickEngine = new WorldTickEngine(
      this.world,
      () => this.roomManager.getActiveRooms(),
      this.populationManager,
    );
    this.tickEngine.start();

    console.log(
      `World loaded: "${this.world.name}" with ${this.world.cities.length} cities, ` +
      `${this.populationManager.getTotalPopulation()} people (${this.populationManager.getUnassignedCount()} unassigned)`,
    );
  }

  getWorldState(): WorldState {
    return this.world;
  }

  getPopulationManager(): PopulationManager {
    return this.populationManager;
  }

  setGameSpeed(speed: number): { success: boolean; error?: string } {
    return this.tickEngine.setGameSpeed(speed);
  }

  getGameSpeed(): number {
    return this.tickEngine.getGameSpeed();
  }

  isPlotAvailable(position: WorldPosition): boolean {
    if (position.wx < 0 || position.wx >= WORLD_MAP_SIZE ||
      position.wz < 0 || position.wz >= WORLD_MAP_SIZE) {
      return false;
    }
    return !this.world.cities.some(
      (c: WorldCityEntry) => c.position.wx === position.wx && c.position.wz === position.wz
    );
  }

  async claimPlot(
    position: WorldPosition,
    cityName: string,
    ownerId: string,
    ownerName: string
  ): Promise<{ success: boolean; cityId?: string; error?: string }> {
    if (!this.isPlotAvailable(position)) {
      return { success: false, error: 'Plot is not available' };
    }

    // Create the city room
    const room = await this.roomManager.createRoom(cityName, ownerId, ownerName);

    // Seed city with people from the world pool
    const seeded = this.populationManager.seedCity(room.id, INITIAL_CITY_SEED);

    // Add to world state
    const entry: WorldCityEntry = {
      cityId: room.id,
      ownerId,
      ownerName,
      name: cityName,
      position,
      population: seeded.length,
      happiness: 50,
    };
    this.world.cities.push(entry);
    this.world.updatedAt = Date.now();

    await this.save();

    // Broadcast updated world state to everyone
    broadcastToAll(S2C.WORLD_STATE, { world: this.world });

    console.log(`City "${cityName}" seeded with ${seeded.length} people (${this.populationManager.getUnassignedCount()} remain in world pool)`);

    return { success: true, cityId: room.id };
  }

  updateCityPopulation(cityId: string, population: number): void {
    const entry = this.world.cities.find((c: WorldCityEntry) => c.cityId === cityId);
    if (entry) {
      entry.population = population;
    }
  }

  updateCityEdgeConnections(cityId: string, connections: EdgeConnection[]): void {
    const entry = this.world.cities.find((c: WorldCityEntry) => c.cityId === cityId);
    if (entry) {
      entry.edgeConnections = connections;
      this.world.updatedAt = Date.now();

      // Broadcast updated world state so all clients see the new connections
      broadcastToAll(S2C.WORLD_STATE, { world: this.world });

      // Persist to disk
      this.save();
    }
  }

  getCityEntry(cityId: string): WorldCityEntry | undefined {
    return this.world.cities.find((c: WorldCityEntry) => c.cityId === cityId);
  }

  async save(): Promise<void> {
    try {
      await saveWorldState(this.world);
    } catch (err) {
      console.error('Failed to save world state:', err);
    }
  }

  shutdown(): void {
    this.tickEngine.stop();
  }
}

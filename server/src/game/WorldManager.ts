import {
  type WorldState,
  type WorldPosition,
  type WorldCityEntry,
  type EdgeConnection,
  S2C,
  WORLD_MAP_SIZE,
} from '@cityzen/shared';
import { RoomManager } from './RoomManager.js';
import { saveWorldState, loadOrCreateDefaultWorld } from '../persistence/worldStore.js';
import { broadcastToAll } from '../realtime/supabaseBroadcast.js';

export class WorldManager {
  private world!: WorldState;
  private roomManager: RoomManager;

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
  }

  async init(): Promise<void> {
    const { state } = await loadOrCreateDefaultWorld();
    this.world = state;
    console.log(`World loaded: "${this.world.name}" with ${this.world.cities.length} cities`);
  }

  getWorldState(): WorldState {
    return this.world;
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

    // Add to world state
    const entry: WorldCityEntry = {
      cityId: room.id,
      ownerId,
      ownerName,
      name: cityName,
      position,
      population: 0,
    };
    this.world.cities.push(entry);
    this.world.updatedAt = Date.now();

    await this.save();

    // Broadcast updated world state to everyone
    broadcastToAll(S2C.WORLD_STATE, { world: this.world });

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
}

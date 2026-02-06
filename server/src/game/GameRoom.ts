import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuid } from 'uuid';
import {
  type CityState,
  type Player,
  type PlacedBuilding,
  type Position,
  BuildingType,
  S2C,
  TICK_INTERVAL_MS,
  AUTO_SAVE_INTERVAL_MS,
  INITIAL_RESOURCES,
  BUILDING_DEFS,
  createEmptyGrid,
  canPlaceBuilding,
  simulateTick,
} from '@cityzen/shared';
import { saveCityState } from '../persistence/jsonStore.js';

export class GameRoom {
  id: string;
  state: CityState;
  players: Map<string, { player: Player; socket: Socket }> = new Map();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private saveInterval: ReturnType<typeof setInterval> | null = null;
  private io: SocketIOServer;
  private debouncedSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(io: SocketIOServer, id: string, name: string, existingState?: CityState) {
    this.io = io;
    this.id = id;
    this.state = existingState ?? {
      id,
      name,
      grid: createEmptyGrid(),
      buildings: [],
      resources: { ...INITIAL_RESOURCES },
      tick: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  start(): void {
    this.tickInterval = setInterval(() => {
      this.state = simulateTick(this.state);
      this.broadcast(S2C.RESOURCES_UPDATE, { resources: this.state.resources, tick: this.state.tick });
    }, TICK_INTERVAL_MS);

    this.saveInterval = setInterval(() => {
      if (this.players.size > 0) {
        this.save();
      }
    }, AUTO_SAVE_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.saveInterval) clearInterval(this.saveInterval);
    this.save();
  }

  addPlayer(socket: Socket, playerName: string): Player {
    const player: Player = {
      id: socket.id,
      name: playerName,
      joinedAt: Date.now(),
    };
    this.players.set(socket.id, { player, socket });
    socket.join(this.id);

    // Send full state to the new player
    socket.emit(S2C.CITY_STATE, {
      city: this.state,
      players: this.getPlayerList(),
    });

    // Notify others
    socket.to(this.id).emit(S2C.PLAYER_JOINED, { player });

    return player;
  }

  removePlayer(socketId: string): void {
    const entry = this.players.get(socketId);
    if (!entry) return;
    this.players.delete(socketId);
    this.broadcast(S2C.PLAYER_LEFT, { playerId: socketId });
  }

  placeBuilding(playerId: string, position: Position, type: BuildingType): { success: boolean; error?: string } {
    const result = canPlaceBuilding(this.state.grid, position, type, this.state.resources);
    if (!result.valid) {
      return { success: false, error: result.reason };
    }

    const def = BUILDING_DEFS[type];
    const building: PlacedBuilding = {
      id: uuid(),
      type,
      position,
      placedBy: playerId,
      placedAt: Date.now(),
    };

    // Update grid
    for (let dx = 0; dx < def.size.w; dx++) {
      for (let dz = 0; dz < def.size.d; dz++) {
        this.state.grid[position.x + dx][position.z + dz].buildingId = building.id;
      }
    }

    // Update state
    this.state.buildings.push(building);
    this.state.resources.money -= def.cost;
    this.state.updatedAt = Date.now();

    // Broadcast to all players in room
    this.broadcast(S2C.BUILDING_PLACED, {
      building,
      resources: this.state.resources,
    });

    this.saveAfterMutation();
    return { success: true };
  }

  demolishBuilding(position: Position): { success: boolean; error?: string } {
    const cell = this.state.grid[position.x]?.[position.z];
    if (!cell || !cell.buildingId) {
      return { success: false, error: 'No building here' };
    }

    const buildingId = cell.buildingId;
    const building = this.state.buildings.find(b => b.id === buildingId);
    if (!building) {
      return { success: false, error: 'Building not found' };
    }

    const def = BUILDING_DEFS[building.type];

    // Clear grid cells
    for (let dx = 0; dx < def.size.w; dx++) {
      for (let dz = 0; dz < def.size.d; dz++) {
        this.state.grid[building.position.x + dx][building.position.z + dz].buildingId = null;
      }
    }

    // Remove building, refund half cost
    this.state.buildings = this.state.buildings.filter(b => b.id !== buildingId);
    this.state.resources.money += Math.floor(def.cost / 2);
    this.state.updatedAt = Date.now();

    this.broadcast(S2C.BUILDING_DEMOLISHED, {
      position,
      buildingId,
      resources: this.state.resources,
    });

    this.saveAfterMutation();
    return { success: true };
  }

  restart(): void {
    this.state = {
      ...this.state,
      grid: createEmptyGrid(),
      buildings: [],
      resources: { ...INITIAL_RESOURCES },
      tick: 0,
      updatedAt: Date.now(),
    };

    // Send fresh state to all players
    for (const { socket } of this.players.values()) {
      socket.emit(S2C.CITY_STATE, {
        city: this.state,
        players: this.getPlayerList(),
      });
    }

    this.saveAfterMutation();
  }

  async forceSave(): Promise<void> {
    await this.save();
  }

  getPlayerList(): Player[] {
    return Array.from(this.players.values()).map(e => e.player);
  }

  private broadcast(event: string, data: unknown): void {
    this.io.to(this.id).emit(event, data);
  }

  private saveAfterMutation(): void {
    if (this.debouncedSaveTimer) clearTimeout(this.debouncedSaveTimer);
    this.debouncedSaveTimer = setTimeout(() => this.save(), 1000);
  }

  private async save(): Promise<void> {
    try {
      await saveCityState(this.id, this.state);
    } catch (err) {
      console.error(`Failed to save city ${this.id}:`, err);
    }
  }
}

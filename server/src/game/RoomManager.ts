import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuid } from 'uuid';
import type { CityListItem } from '@cityzen/shared';
import { GameRoom } from './GameRoom.js';
import { loadCityState, listSavedCities } from '../persistence/jsonStore.js';

export class RoomManager {
  private rooms: Map<string, GameRoom> = new Map();
  private io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
  }

  async createRoom(cityName: string): Promise<GameRoom> {
    const id = uuid();
    const room = new GameRoom(this.io, id, cityName);
    room.start();
    this.rooms.set(id, room);
    return room;
  }

  getRoom(cityId: string): GameRoom | undefined {
    return this.rooms.get(cityId);
  }

  async getOrLoadRoom(cityId: string): Promise<GameRoom | null> {
    const existing = this.rooms.get(cityId);
    if (existing) return existing;

    const state = await loadCityState(cityId);
    if (!state) return null;

    const room = new GameRoom(this.io, cityId, state.name, state);
    room.start();
    this.rooms.set(cityId, room);
    return room;
  }

  removeRoom(cityId: string): void {
    const room = this.rooms.get(cityId);
    if (room) {
      room.stop();
      this.rooms.delete(cityId);
    }
  }

  listRooms(): CityListItem[] {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      name: room.state.name,
      playerCount: room.players.size,
      buildingCount: room.state.buildings.length,
    }));
  }

  async listAllCities(): Promise<CityListItem[]> {
    const activeRooms = this.listRooms();
    const activeIds = new Set(activeRooms.map(r => r.id));

    const savedIds = await listSavedCities();
    const savedCities: CityListItem[] = [];

    for (const id of savedIds) {
      if (!activeIds.has(id)) {
        const state = await loadCityState(id);
        if (state) {
          savedCities.push({
            id: state.id,
            name: state.name,
            playerCount: 0,
            buildingCount: state.buildings.length,
          });
        }
      }
    }

    return [...activeRooms, ...savedCities];
  }
}

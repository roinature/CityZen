import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuid } from 'uuid';
import {
  C2S,
  S2C,
  type CreateCityPayload,
  type JoinCityPayload,
  type PlaceBuildingPayload,
  type DemolishPayload,
  type SetTaxRatePayload,
  type SetUnlimitedMoneyPayload,
  type SetGameSpeedPayload,
} from '@cityzen/shared';
import { RoomManager } from '../game/RoomManager.js';
import { savePlayerProfile, loadPlayerProfile } from '../persistence/playerStore.js';

export function setupSocketHandlers(io: SocketIOServer, roomManager: RoomManager): void {
  io.on('connection', (socket: Socket) => {
    console.log(`Player connected: ${socket.id}`);

    let currentRoomId: string | null = null;

    socket.on(C2S.CREATE_CITY, async (payload: CreateCityPayload) => {
      try {
        // Leave current room if any
        if (currentRoomId) {
          leaveCurrentRoom(socket, roomManager, currentRoomId);
        }

        // Resolve or create persistent player ID
        const playerId = payload.playerId || uuid();
        const profile = await loadPlayerProfile(playerId);
        if (!profile) {
          await savePlayerProfile({
            id: playerId,
            name: payload.playerName,
            ownedCityId: null,
            createdAt: Date.now(),
          });
        }

        const room = await roomManager.createRoom(payload.cityName, playerId, payload.playerName);
        currentRoomId = room.id;

        // Update player profile with owned city
        await savePlayerProfile({
          id: playerId,
          name: payload.playerName,
          ownedCityId: room.id,
          createdAt: profile?.createdAt ?? Date.now(),
        });

        room.addPlayer(socket, payload.playerName);

        console.log(`City created: "${payload.cityName}" (${room.id}) by ${payload.playerName}`);
      } catch (err) {
        socket.emit(S2C.ERROR, { message: 'Failed to create city', code: 'CREATE_FAILED' });
      }
    });

    socket.on(C2S.JOIN_CITY, async (payload: JoinCityPayload) => {
      try {
        if (currentRoomId) {
          leaveCurrentRoom(socket, roomManager, currentRoomId);
        }

        // Ensure player profile exists
        if (payload.playerId) {
          const profile = await loadPlayerProfile(payload.playerId);
          if (!profile) {
            await savePlayerProfile({
              id: payload.playerId,
              name: payload.playerName,
              ownedCityId: null,
              createdAt: Date.now(),
            });
          }
        }

        const room = await roomManager.getOrLoadRoom(payload.cityId);
        if (!room) {
          socket.emit(S2C.ERROR, { message: 'City not found', code: 'NOT_FOUND' });
          return;
        }

        currentRoomId = room.id;
        room.addPlayer(socket, payload.playerName);

        console.log(`${payload.playerName} joined city ${room.state.name}`);
      } catch (err) {
        socket.emit(S2C.ERROR, { message: 'Failed to join city', code: 'JOIN_FAILED' });
      }
    });

    socket.on(C2S.PLACE_BUILDING, (payload: PlaceBuildingPayload) => {
      if (!currentRoomId) {
        socket.emit(S2C.ERROR, { message: 'Not in a city', code: 'NO_ROOM' });
        return;
      }

      const room = roomManager.getRoom(currentRoomId);
      if (!room) return;

      const result = room.placeBuilding(socket.id, payload.position, payload.type);
      if (!result.success) {
        socket.emit(S2C.ERROR, { message: result.error!, code: 'PLACEMENT_FAILED' });
      }
    });

    socket.on(C2S.DEMOLISH, (payload: DemolishPayload) => {
      if (!currentRoomId) {
        socket.emit(S2C.ERROR, { message: 'Not in a city', code: 'NO_ROOM' });
        return;
      }

      const room = roomManager.getRoom(currentRoomId);
      if (!room) return;

      const result = room.demolishBuilding(payload.position);
      if (!result.success) {
        socket.emit(S2C.ERROR, { message: result.error!, code: 'DEMOLISH_FAILED' });
      }
    });

    socket.on(C2S.SET_TAX_RATE, (payload: SetTaxRatePayload) => {
      if (!currentRoomId) {
        socket.emit(S2C.ERROR, { message: 'Not in a city', code: 'NO_ROOM' });
        return;
      }

      const room = roomManager.getRoom(currentRoomId);
      if (!room) return;

      const result = room.setTaxRate(payload.taxRate);
      if (!result.success) {
        socket.emit(S2C.ERROR, { message: result.error!, code: 'TAX_RATE_FAILED' });
      }
    });

    socket.on(C2S.SET_UNLIMITED_MONEY, (payload: SetUnlimitedMoneyPayload) => {
      if (!currentRoomId) return;
      const room = roomManager.getRoom(currentRoomId);
      if (!room) return;
      room.setUnlimitedMoney(payload.enabled);
    });

    socket.on(C2S.SET_GAME_SPEED, (payload: SetGameSpeedPayload) => {
      if (!currentRoomId) return;
      const room = roomManager.getRoom(currentRoomId);
      if (!room) return;
      const result = room.setGameSpeed(payload.speed);
      if (!result.success) {
        socket.emit(S2C.ERROR, { message: result.error!, code: 'SPEED_FAILED' });
      }
    });

    socket.on(C2S.SAVE, async () => {
      if (!currentRoomId) return;
      const room = roomManager.getRoom(currentRoomId);
      if (!room) return;
      await room.forceSave();
      socket.emit(S2C.SAVE_OK, { timestamp: Date.now() });
    });

    socket.on(C2S.RESTART, () => {
      if (!currentRoomId) return;
      const room = roomManager.getRoom(currentRoomId);
      if (!room) return;
      room.restart();
    });

    socket.on(C2S.LEAVE, () => {
      if (currentRoomId) {
        leaveCurrentRoom(socket, roomManager, currentRoomId);
        currentRoomId = null;
      }
    });

    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.id}`);
      if (currentRoomId) {
        leaveCurrentRoom(socket, roomManager, currentRoomId);
        currentRoomId = null;
      }
    });
  });
}

function leaveCurrentRoom(socket: Socket, roomManager: RoomManager, roomId: string): void {
  const room = roomManager.getRoom(roomId);
  if (room) {
    room.removePlayer(socket.id);
    socket.leave(roomId);

    // Clean up empty rooms after a delay
    if (room.players.size === 0) {
      setTimeout(() => {
        if (room.players.size === 0) {
          roomManager.removeRoom(roomId);
          console.log(`Room ${roomId} removed (empty)`);
        }
      }, 60000);
    }
  }
}

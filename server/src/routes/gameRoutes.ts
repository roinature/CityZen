import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import {
  S2C,
  isRoad,
  calculateEdgeConnections,
  type ClaimPlotPayload,
  type CreateCityPayload,
  type JoinCityPayload,
  type PlaceBuildingPayload,
  type DemolishPayload,
  type SetTaxRatePayload,
  type SetUnlimitedMoneyPayload,
  type SetGameSpeedPayload,
  type PlacedBuilding,
} from '@cityzen/shared';
import { RoomManager } from '../game/RoomManager.js';
import { WorldManager } from '../game/WorldManager.js';
import { savePlayerProfile, loadPlayerProfile } from '../persistence/playerStore.js';
import { broadcastToAll } from '../realtime/supabaseBroadcast.js';

// Server-side session tracking: playerId -> roomId
const playerSessions = new Map<string, string>();

export function createGameRoutes(roomManager: RoomManager, worldManager: WorldManager): Router {
  const router = Router();

  // Helper to get current room for a player
  function getPlayerRoom(playerId: string) {
    const roomId = playerSessions.get(playerId);
    if (!roomId) return null;
    return roomManager.getRoom(roomId) ?? null;
  }

  function leaveCurrentRoom(playerId: string): void {
    const roomId = playerSessions.get(playerId);
    if (!roomId) return;

    const room = roomManager.getRoom(roomId);
    if (room) {
      room.removePlayer(playerId);

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
    playerSessions.delete(playerId);
  }

  // GET /api/world/state — get current world state (replaces the on-connect emit)
  router.get('/world/state', (_req: Request, res: Response) => {
    res.json({ world: worldManager.getWorldState() });
  });

  // POST /api/world/claim
  router.post('/world/claim', async (req: Request, res: Response) => {
    try {
      const payload = req.body as ClaimPlotPayload;
      const playerId = payload.playerId || uuid();

      // Leave current room if any
      leaveCurrentRoom(playerId);

      const profile = await loadPlayerProfile(playerId);
      if (!profile) {
        await savePlayerProfile({
          id: playerId,
          name: payload.playerName,
          ownedCityId: null,
          createdAt: Date.now(),
        });
      }

      const result = await worldManager.claimPlot(
        payload.position,
        payload.cityName,
        playerId,
        payload.playerName
      );

      if (!result.success) {
        res.json({ success: false, error: result.error });
        return;
      }

      // Update player profile with owned city
      await savePlayerProfile({
        id: playerId,
        name: payload.playerName,
        ownedCityId: result.cityId!,
        createdAt: profile?.createdAt ?? Date.now(),
      });

      // Auto-join the newly created city
      const room = roomManager.getRoom(result.cityId!);
      if (room) {
        playerSessions.set(playerId, room.id);
        room.addPlayer(playerId, payload.playerName);
        console.log(`Plot claimed at (${payload.position.wx}, ${payload.position.wz}) - City "${payload.cityName}" by ${payload.playerName}`);
      }

      res.json({ success: true, cityId: result.cityId });
    } catch (err) {
      res.json({ success: false, error: 'Failed to claim plot' });
    }
  });

  // POST /api/city/create
  router.post('/city/create', async (req: Request, res: Response) => {
    try {
      const payload = req.body as CreateCityPayload;
      const playerId = payload.playerId || uuid();

      // Leave current room if any
      leaveCurrentRoom(playerId);

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
      playerSessions.set(playerId, room.id);

      // Update player profile with owned city
      await savePlayerProfile({
        id: playerId,
        name: payload.playerName,
        ownedCityId: room.id,
        createdAt: profile?.createdAt ?? Date.now(),
      });

      room.addPlayer(playerId, payload.playerName);

      console.log(`City created: "${payload.cityName}" (${room.id}) by ${payload.playerName}`);
      res.json({ success: true, cityId: room.id });
    } catch (err) {
      res.json({ success: false, error: 'Failed to create city' });
    }
  });

  // POST /api/city/join
  router.post('/city/join', async (req: Request, res: Response) => {
    try {
      const payload = req.body as JoinCityPayload;
      const playerId = payload.playerId || uuid();

      // Leave current room if any
      leaveCurrentRoom(playerId);

      // Ensure player profile exists
      if (playerId) {
        const profile = await loadPlayerProfile(playerId);
        if (!profile) {
          await savePlayerProfile({
            id: playerId,
            name: payload.playerName,
            ownedCityId: null,
            createdAt: Date.now(),
          });
        }
      }

      const room = await roomManager.getOrLoadRoom(payload.cityId);
      if (!room) {
        res.json({ success: false, error: 'City not found', code: 'NOT_FOUND' });
        return;
      }

      playerSessions.set(playerId, room.id);
      room.addPlayer(playerId, payload.playerName);

      console.log(`${payload.playerName} joined city ${room.state.name}`);
      res.json({ success: true, cityId: room.id });
    } catch (err) {
      res.json({ success: false, error: 'Failed to join city' });
    }
  });

  // POST /api/building/place
  router.post('/building/place', (req: Request, res: Response) => {
    const { playerId, position, type } = req.body as PlaceBuildingPayload & { playerId: string };
    if (!playerId) {
      res.json({ success: false, error: 'Missing playerId' });
      return;
    }

    const room = getPlayerRoom(playerId);
    if (!room) {
      res.json({ success: false, error: 'Not in a city', code: 'NO_ROOM' });
      return;
    }

    const result = room.placeBuilding(playerId, position, type);
    if (!result.success) {
      res.json({ success: false, error: result.error, code: 'PLACEMENT_FAILED' });
    } else {
      if (isRoad(type)) {
        const roomId = playerSessions.get(playerId)!;
        const connections = calculateEdgeConnections(room.state.buildings);
        worldManager.updateCityEdgeConnections(roomId, connections);
      }
      res.json({ success: true });
    }
  });

  // POST /api/building/demolish
  router.post('/building/demolish', (req: Request, res: Response) => {
    const { playerId, position } = req.body as DemolishPayload & { playerId: string };
    if (!playerId) {
      res.json({ success: false, error: 'Missing playerId' });
      return;
    }

    const room = getPlayerRoom(playerId);
    if (!room) {
      res.json({ success: false, error: 'Not in a city', code: 'NO_ROOM' });
      return;
    }

    // Check if we're demolishing a road before actually demolishing
    const cell = room.state.grid[position.x]?.[position.z];
    const building = cell?.buildingId ? room.state.buildings.find((b: PlacedBuilding) => b.id === cell.buildingId) : null;
    const wasRoad = building && isRoad(building.type);

    const result = room.demolishBuilding(position);
    if (!result.success) {
      res.json({ success: false, error: result.error, code: 'DEMOLISH_FAILED' });
    } else {
      if (wasRoad) {
        const roomId = playerSessions.get(playerId)!;
        const connections = calculateEdgeConnections(room.state.buildings);
        worldManager.updateCityEdgeConnections(roomId, connections);
      }
      res.json({ success: true });
    }
  });

  // POST /api/city/tax-rate
  router.post('/city/tax-rate', (req: Request, res: Response) => {
    const { playerId, taxRate } = req.body as SetTaxRatePayload & { playerId: string };
    const room = getPlayerRoom(playerId);
    if (!room) {
      res.json({ success: false, error: 'Not in a city', code: 'NO_ROOM' });
      return;
    }

    const result = room.setTaxRate(taxRate);
    res.json(result.success ? { success: true } : { success: false, error: result.error });
  });

  // POST /api/city/unlimited-money
  router.post('/city/unlimited-money', (req: Request, res: Response) => {
    const { playerId, enabled } = req.body as SetUnlimitedMoneyPayload & { playerId: string };
    const room = getPlayerRoom(playerId);
    if (!room) {
      res.json({ success: false, error: 'Not in a city' });
      return;
    }
    room.setUnlimitedMoney(enabled);
    res.json({ success: true });
  });

  // POST /api/city/game-speed
  router.post('/city/game-speed', (req: Request, res: Response) => {
    const { playerId, speed } = req.body as SetGameSpeedPayload & { playerId: string };
    const room = getPlayerRoom(playerId);
    if (!room) {
      res.json({ success: false, error: 'Not in a city' });
      return;
    }
    const result = room.setGameSpeed(speed);
    res.json(result.success ? { success: true } : { success: false, error: result.error });
  });

  // POST /api/city/save
  router.post('/city/save', async (req: Request, res: Response) => {
    const { playerId } = req.body as { playerId: string };
    const room = getPlayerRoom(playerId);
    if (!room) {
      res.json({ success: false, error: 'Not in a city' });
      return;
    }
    await room.forceSave();
    res.json({ success: true });
  });

  // POST /api/city/restart
  router.post('/city/restart', (req: Request, res: Response) => {
    const { playerId } = req.body as { playerId: string };
    const room = getPlayerRoom(playerId);
    if (!room) {
      res.json({ success: false, error: 'Not in a city' });
      return;
    }
    room.restart();
    res.json({ success: true });
  });

  // POST /api/city/leave
  router.post('/city/leave', (req: Request, res: Response) => {
    const { playerId } = req.body as { playerId: string };
    if (playerId) {
      leaveCurrentRoom(playerId);
    }
    res.json({ success: true });
  });

  return router;
}

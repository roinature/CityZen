import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import {
  S2C,
  DEFAULT_GRID_SIZE,
  ZoneDensity,
  isRoad,
  isZone,
  calculateEdgeConnections,
  type ClaimPlotPayload,
  type CreateCityPayload,
  type JoinCityPayload,
  type PlaceBuildingPayload,
  type PlaceBuildingsPayload,
  type BuildingsPlacedPayload,
  type DemolishPayload,
  type SetTaxRatePayload,
  type SetUnlimitedMoneyPayload,
  type SetGameSpeedPayload,
  type PlacedBuilding,
  type CityState,
} from '@cityzen/shared';
import { IS_SERVERLESS } from '../config.js';
import { GameRoom } from '../game/GameRoom.js';
import { clearCitySession, readCitySession, writeCitySession } from '../game/citySession.js';
import { loadCityState, mutateCityState } from '../persistence/jsonStore.js';
import { RoomManager } from '../game/RoomManager.js';
import { WorldManager } from '../game/WorldManager.js';
import { savePlayerProfile, loadPlayerProfile } from '../persistence/playerStore.js';
import { broadcastToChannel } from '../realtime/supabaseBroadcast.js';

interface CityActionResult {
  success: boolean;
  error?: string;
  code?: string;
  roadsChanged?: boolean;
  placement?: BuildingsPlacedPayload;
}

export function createGameRoutes(roomManager: RoomManager, worldManager: WorldManager): Router {
  const router = Router();

  // Local presence is separate from the signed city session used across workers.
  const playerSessions = new Map<string, string>();

  function joinRoom(res: Response, room: GameRoom, playerId: string, playerName: string): void {
    playerSessions.set(playerId, room.id);
    room.addPlayer(playerId, playerName);
    writeCitySession(res, { playerId, cityId: room.id });
  }

  function cityAction(
    action: (room: GameRoom, body: Request['body']) => CityActionResult,
  ): (req: Request, res: Response) => Promise<void> {
    return async (req, res) => {
      try {
        const playerId = req.body?.playerId;
        if (typeof playerId !== 'string' || !playerId) {
          res.json({ success: false, error: 'Missing playerId' });
          return;
        }
        const session = IS_SERVERLESS ? readCitySession(req, playerId) : null;
        const cityId = IS_SERVERLESS ? session?.cityId : playerSessions.get(playerId);
        let state: CityState | undefined;
        let result: CityActionResult | undefined;
        if (cityId && IS_SERVERLESS) {
          const events: Array<{ event: string; data: unknown }> = [];
          const mutation = await mutateCityState(cityId, (city) => {
            const room = new GameRoom(city.id, city.name, city.ownerId, '', city,
              (event, data) => events.push({ event, data }),
            );
            room.unlimitedMoney = session?.unlimitedMoney === true;
            const result = action(room, req.body);
            return { result, state: room.state };
          });
          if (mutation) {
            ({ result, state } = mutation);
            if (result.success) {
              roomManager.getRoom(cityId)?.syncPersistedState(state);
              const broadcasts = events.map(({ event, data }) => broadcastToChannel(`city:${cityId}`, event, data));
              for (const worldId of mutation.updatedWorldIds) {
                broadcasts.push(worldManager.publishCityEdges(worldId, cityId).catch(err => {
                  console.error('Could not publish world road connections:', err);
                }));
              }
              await Promise.all(broadcasts);
            }
          }
        } else if (cityId) {
          const room = roomManager.getRoom(cityId);
          if (room) {
            result = action(room, req.body);
            state = room.state;
          }
        }

        if (!result || !state) {
          res.json({ success: false, error: 'Not in a city', code: 'NO_ROOM' });
          return;
        }
        if (!IS_SERVERLESS && result.success && result.roadsChanged) {
          worldManager.updateCityEdgeConnections(state.id, calculateEdgeConnections(state.buildings));
        }
        const { roadsChanged, ...response } = result;
        res.json(response);
      } catch (err) {
        console.error('City action failed:', err);
        res.status(500).json({ success: false, error: 'Could not save city changes' });
      }
    };
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
  router.get('/world/state', async (req: Request, res: Response) => {
    const worldId = (req.query.worldId as string) || 'default';
    try {
      // Worlds other than the default are loaded on first use
      const world = await worldManager.loadWorld(worldId);
      if (!world) {
        res.status(404).json({ error: 'World not found' });
        return;
      }
      res.json({ world });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load world' });
    }
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

      const worldId = payload.worldId || 'default';
      if (!(await worldManager.loadWorld(worldId))) {
        res.json({ success: false, error: 'World not found' });
        return;
      }

      const result = await worldManager.claimPlot(
        payload.position,
        payload.cityName,
        playerId,
        payload.playerName,
        worldId,
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
        joinRoom(res, room, playerId, payload.playerName);
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

      // Update player profile with owned city
      await savePlayerProfile({
        id: playerId,
        name: payload.playerName,
        ownedCityId: room.id,
        createdAt: profile?.createdAt ?? Date.now(),
      });

      joinRoom(res, room, playerId, payload.playerName);

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

      const cachedRoom = IS_SERVERLESS ? roomManager.getRoom(payload.cityId) : undefined;
      const room = cachedRoom ?? await roomManager.getOrLoadRoom(payload.cityId);
      const savedCity = cachedRoom ? await loadCityState(payload.cityId) : null;
      if (!room || (cachedRoom && !savedCity)) {
        res.json({ success: false, error: 'City not found', code: 'NOT_FOUND' });
        return;
      }

      if (savedCity) room.syncPersistedState(savedCity);
      joinRoom(res, room, playerId, payload.playerName);

      console.log(`${payload.playerName} joined city ${room.state.name}`);
      res.json({ success: true, cityId: room.id, city: room.state, players: room.getPlayerList() });
    } catch (err) {
      res.json({ success: false, error: 'Failed to join city' });
    }
  });

  router.post('/building/place', cityAction((room, body: PlaceBuildingPayload & { playerId: string }) => {
    const { playerId, position, type, density, orientation } = body;
    const result = room.placeBuilding(playerId, position, type, density, orientation);
    return result.success ? { success: true, roadsChanged: isRoad(type) } :
      { ...result, code: 'PLACEMENT_FAILED' };
  }));

  router.post('/building/place-batch', cityAction((room, body: PlaceBuildingsPayload & { playerId: string }) => {
    const { positions, type, density, orientation, playerId } = body;
    if (
      (!isRoad(type) && !isZone(type)) ||
      (density !== undefined && !Object.values(ZoneDensity).includes(density)) ||
      (orientation !== undefined && orientation !== 'NS' && orientation !== 'EW') ||
      !Array.isArray(positions) || positions.length === 0 || positions.length > DEFAULT_GRID_SIZE ** 2 ||
      positions.some(pos => !Number.isInteger(pos?.x) || !Number.isInteger(pos?.z) ||
        pos.x < 0 || pos.z < 0 || pos.x >= DEFAULT_GRID_SIZE || pos.z >= DEFAULT_GRID_SIZE)
    ) {
      return { success: false, error: 'Invalid build stroke', code: 'PLACEMENT_FAILED' };
    }

    const { success, buildings, error } = room.placeBuildings(playerId, body);
    return {
      success, error,
      roadsChanged: success && isRoad(type),
      placement: success ? { buildings, resources: room.state.resources } : undefined,
    };
  }));

  router.post('/building/demolish', cityAction((room, body: DemolishPayload) => {
    const { position } = body;
    const cell = room.state.grid[position.x]?.[position.z];
    const building = cell?.buildingId ? room.state.buildings.find((b: PlacedBuilding) => b.id === cell.buildingId) : null;
    const result = room.demolishBuilding(position);
    return result.success ? { success: true, roadsChanged: !!building && isRoad(building.type) } :
      { ...result, code: 'DEMOLISH_FAILED' };
  }));

  router.post('/city/tax-rate', cityAction((room, body: SetTaxRatePayload) => room.setTaxRate(body.taxRate)));

  router.post('/city/loan/take', cityAction((room, body: { amount: number; termDays: number }) =>
    room.takeLoan(Number(body.amount), Number(body.termDays)),
  ));

  router.post('/city/loan/repay', cityAction((room, body: { loanId: string }) => room.repayLoan(body.loanId)));

  router.post('/city/unlimited-money', (req: Request, res: Response) => {
    const { playerId, enabled } = req.body as SetUnlimitedMoneyPayload & { playerId: string };
    const session = readCitySession(req, playerId);
    const cityId = playerSessions.get(playerId);
    const room = cityId ? roomManager.getRoom(cityId) : undefined;
    if (IS_SERVERLESS ? !session : !room) {
      res.json({ success: false, error: 'Not in a city', code: 'NO_ROOM' });
      return;
    }
    if (IS_SERVERLESS && session) writeCitySession(res, { ...session, unlimitedMoney: enabled === true });
    room?.setUnlimitedMoney(enabled === true);
    res.json({ success: true });
  });

  // POST /api/city/game-speed — game speed is now world-level
  router.post('/city/game-speed', (req: Request, res: Response) => {
    const { speed } = req.body as SetGameSpeedPayload;
    const result = worldManager.setGameSpeed(speed);
    res.json(result.success ? { success: true } : { success: false, error: result.error });
  });

  router.post('/city/save', async (req: Request, res: Response) => {
    const { playerId } = req.body as { playerId: string };
    const cityId = IS_SERVERLESS ? readCitySession(req, playerId)?.cityId : playerSessions.get(playerId);
    try {
      const room = cityId ? roomManager.getRoom(cityId) : undefined;
      if (room) {
        await room.forceSave();
      } else if (!IS_SERVERLESS || !cityId || !await loadCityState(cityId)) {
        res.json({ success: false, error: 'Not in a city', code: 'NO_ROOM' });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      console.error('City save failed:', err);
      res.status(500).json({ success: false, error: 'Could not save city changes' });
    }
  });

  router.post('/city/restart', cityAction((room) => {
    room.restart();
    return { success: true, roadsChanged: true };
  }));

  // POST /api/city/leave
  router.post('/city/leave', (req: Request, res: Response) => {
    const { playerId } = req.body as { playerId: string };
    if (playerId) {
      leaveCurrentRoom(playerId);
    }
    clearCitySession(res);
    res.json({ success: true });
  });

  return router;
}

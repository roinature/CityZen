import { Router, type Request, type Response } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { ADMIN_PASSWORD } from '../config.js';
import type { RoomManager } from '../game/RoomManager.js';
import type { WorldManager } from '../game/WorldManager.js';
import type { PrismaClient } from '../generated/prisma/index.js';

function paramId(req: Request): string {
  return req.params.id as string;
}

function queryStr(req: Request, key: string, fallback = ''): string {
  const v = req.query[key];
  return typeof v === 'string' ? v : fallback;
}

function queryInt(req: Request, key: string, fallback: number): number {
  return parseInt(queryStr(req, key, '')) || fallback;
}

export function createAdminRoutes(
  roomManager: RoomManager,
  worldManager: WorldManager,
  prisma: PrismaClient
): Router {
  const router = Router();

  // ── Auth (unprotected) ──────────────────────────────────

  router.post('/login', (req: Request, res: Response) => {
    const { password } = req.body;
    if (!ADMIN_PASSWORD) {
      res.status(500).json({ error: 'ADMIN_PASSWORD not configured' });
      return;
    }
    if (password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
    (req.session as any).isAdmin = true;
    res.json({ success: true });
  });

  router.post('/logout', (req: Request, res: Response) => {
    (req.session as any).isAdmin = false;
    res.json({ success: true });
  });

  router.get('/session', (req: Request, res: Response) => {
    if ((req.session as any).isAdmin === true) {
      res.json({ authenticated: true });
    } else {
      res.status(401).json({ authenticated: false });
    }
  });

  // ── All routes below require admin auth ─────────────────
  router.use(adminAuth);

  // ── Dashboard stats ─────────────────────────────────────

  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const [playerCount, cityCount, worldCount, messageCount, buildingCount] = await Promise.all([
        prisma.player.count(),
        prisma.city.count(),
        prisma.world.count(),
        prisma.gameMessage.count(),
        prisma.building.count(),
      ]);

      const activeRooms = roomManager.getActiveRooms();

      res.json({
        players: playerCount,
        cities: cityCount,
        worlds: worldCount,
        messages: messageCount,
        buildings: buildingCount,
        activeRooms: activeRooms.length,
        activePlayers: activeRooms.reduce((sum, room) => sum + room.players.size, 0),
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // ── Players ─────────────────────────────────────────────

  router.get('/players', async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, queryInt(req, 'page', 1));
      const limit = Math.min(100, Math.max(1, queryInt(req, 'limit', 20)));
      const search = queryStr(req, 'search');

      const where = search ? { name: { contains: search, mode: 'insensitive' as const } } : {};
      const [players, total] = await Promise.all([
        prisma.player.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.player.count({ where }),
      ]);

      res.json({ players, total, page, limit });
    } catch {
      res.status(500).json({ error: 'Failed to fetch players' });
    }
  });

  router.get('/players/:id', async (req: Request, res: Response) => {
    try {
      const player = await prisma.player.findUnique({ where: { id: paramId(req) } });
      if (!player) { res.status(404).json({ error: 'Player not found' }); return; }
      res.json(player);
    } catch {
      res.status(500).json({ error: 'Failed to fetch player' });
    }
  });

  router.patch('/players/:id', async (req: Request, res: Response) => {
    try {
      const data: Record<string, any> = {};
      if (req.body.name !== undefined) data.name = String(req.body.name);

      const player = await prisma.player.update({ where: { id: paramId(req) }, data });
      res.json({ success: true, player });
    } catch {
      res.status(500).json({ error: 'Failed to update player' });
    }
  });

  router.delete('/players/:id', async (req: Request, res: Response) => {
    try {
      await prisma.player.delete({ where: { id: paramId(req) } });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete player' });
    }
  });

  // ── Cities ──────────────────────────────────────────────

  router.get('/cities', async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, queryInt(req, 'page', 1));
      const limit = Math.min(100, Math.max(1, queryInt(req, 'limit', 20)));

      const [cities, total] = await Promise.all([
        prisma.city.findMany({
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: { _count: { select: { buildings: true } } },
        }),
        prisma.city.count(),
      ]);

      // Enrich with active room info
      const enriched = cities.map((city) => {
        const room = roomManager.getRoom(city.id);
        return {
          ...city,
          buildingCount: city._count.buildings,
          activePlayers: room ? room.players.size : 0,
          isActive: !!room,
        };
      });

      res.json({ cities: enriched, total, page, limit });
    } catch {
      res.status(500).json({ error: 'Failed to fetch cities' });
    }
  });

  router.get('/cities/:id', async (req: Request, res: Response) => {
    try {
      const city = await prisma.city.findUnique({
        where: { id: paramId(req) },
        include: { _count: { select: { buildings: true } } },
      });
      if (!city) { res.status(404).json({ error: 'City not found' }); return; }

      const room = roomManager.getRoom(city.id);
      res.json({
        ...city,
        buildingCount: city._count.buildings,
        activePlayers: room ? room.players.size : 0,
        isActive: !!room,
        liveMoney: room?.state.resources.money,
        livePopulation: room?.state.resources.population,
        liveHappiness: room?.state.resources.happiness,
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch city' });
    }
  });

  router.patch('/cities/:id', async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const updates = req.body;
      const data: Record<string, any> = {};
      if (updates.money !== undefined) data.money = Number(updates.money);
      if (updates.population !== undefined) data.population = Number(updates.population);
      if (updates.happiness !== undefined) data.happiness = Number(updates.happiness);
      if (updates.taxRate !== undefined) data.taxRate = Number(updates.taxRate);
      if (updates.name !== undefined) data.name = String(updates.name);

      const city = await prisma.city.update({ where: { id }, data });

      // Sync active GameRoom in-memory state
      const room = roomManager.getRoom(id);
      if (room) {
        if (data.money !== undefined) room.state.resources.money = data.money;
        if (data.population !== undefined) room.state.resources.population = data.population;
        if (data.happiness !== undefined) room.state.resources.happiness = data.happiness;
        if (data.taxRate !== undefined) room.state.resources.taxRate = data.taxRate;
        if (data.name !== undefined) room.state.name = data.name;
      }

      res.json({ success: true, city });
    } catch {
      res.status(500).json({ error: 'Failed to update city' });
    }
  });

  router.post('/cities/:id/restart', async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const room = roomManager.getRoom(id);
      if (room) {
        room.restart();
        res.json({ success: true, method: 'room' });
      } else {
        await prisma.city.update({
          where: { id },
          data: {
            money: 5000, population: 0, happiness: 50, taxRate: 10,
            demandResidential: 0.5, demandCommercial: 0, demandIndustrial: 0.3,
            clockGameTimeMs: 0, clockSpeed: 1, clockGameDay: 0, clockGameYear: 1,
            tick: 0,
          },
        });
        await prisma.building.deleteMany({ where: { cityId: id } });
        res.json({ success: true, method: 'db' });
      }
    } catch {
      res.status(500).json({ error: 'Failed to restart city' });
    }
  });

  router.delete('/cities/:id', async (req: Request, res: Response) => {
    try {
      const cityId = paramId(req);

      // Stop active room first
      roomManager.removeRoom(cityId);

      // Remove from world state
      const worldInstance = worldManager.findWorldForCity(cityId);
      if (worldInstance) {
        worldInstance.state.cities = worldInstance.state.cities.filter(
          (c) => c.cityId !== cityId
        );
        worldInstance.state.updatedAt = Date.now();
        await worldManager.save(worldInstance.state.id);
      }

      // Delete from DB (buildings cascade)
      await prisma.city.delete({ where: { id: cityId } });

      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete city' });
    }
  });

  // ── Worlds ──────────────────────────────────────────────

  router.get('/worlds', async (_req: Request, res: Response) => {
    try {
      const worlds = await prisma.world.findMany({ orderBy: { createdAt: 'desc' } });
      res.json({ worlds });
    } catch {
      res.status(500).json({ error: 'Failed to fetch worlds' });
    }
  });

  router.patch('/worlds/:id', async (req: Request, res: Response) => {
    try {
      const data: Record<string, any> = {};
      if (req.body.name !== undefined) data.name = String(req.body.name);
      if (req.body.gridSize !== undefined) data.gridSize = Number(req.body.gridSize);
      if (req.body.maxCities !== undefined) data.maxCities = Number(req.body.maxCities);

      const world = await prisma.world.update({ where: { id: paramId(req) }, data });
      res.json({ success: true, world });
    } catch {
      res.status(500).json({ error: 'Failed to update world' });
    }
  });

  // ── Messages ────────────────────────────────────────────

  router.get('/messages', async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, queryInt(req, 'page', 1));
      const limit = Math.min(100, Math.max(1, queryInt(req, 'limit', 20)));
      const cityId = queryStr(req, 'cityId') || undefined;
      const type = queryStr(req, 'type') || undefined;

      const where: Record<string, any> = {};
      if (cityId) where.cityId = cityId;
      if (type) where.type = type;

      const [messages, total] = await Promise.all([
        prisma.gameMessage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.gameMessage.count({ where }),
      ]);

      res.json({ messages, total, page, limit });
    } catch {
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  router.delete('/messages/:id', async (req: Request, res: Response) => {
    try {
      await prisma.gameMessage.delete({ where: { id: paramId(req) } });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Failed to delete message' });
    }
  });

  router.post('/messages/cleanup', async (_req: Request, res: Response) => {
    try {
      const result = await prisma.gameMessage.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      res.json({ success: true, deleted: result.count });
    } catch {
      res.status(500).json({ error: 'Failed to cleanup messages' });
    }
  });

  return router;
}

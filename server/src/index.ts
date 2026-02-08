import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PORT, CLIENT_ORIGIN } from './config.js';
import { RoomManager } from './game/RoomManager.js';
import { WorldManager } from './game/WorldManager.js';
import { setupSocketHandlers } from './socket/handlers.js';

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

const roomManager = new RoomManager(io);
const worldManager = new WorldManager(io, roomManager);

// REST endpoints
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/cities', async (_req, res) => {
  const cities = await roomManager.listAllCities();
  res.json(cities);
});

app.get('/api/world', (_req, res) => {
  res.json(worldManager.getWorldState());
});

// Setup socket handlers
setupSocketHandlers(io, roomManager, worldManager);

// Initialize world then start server
worldManager.init().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`CityZen server running on http://localhost:${PORT}`);
  });
});

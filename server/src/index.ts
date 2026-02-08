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

// Session Middleware
import session from 'express-session';
import { SESSION_SECRET, TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, TWITTER_CALLBACK_URL } from './config.js';
import { XService } from './services/XService.js';

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS
}));

const xService = new XService({
  clientId: TWITTER_CLIENT_ID,
  clientSecret: TWITTER_CLIENT_SECRET,
  callbackUrl: TWITTER_CALLBACK_URL
});

// X Auth Routes
app.get('/api/auth/twitter', (req, res) => {
  const { url, codeVerifier, state } = xService.generateAuthLink();

  // Store verifier and state in session
  (req.session as any).codeVerifier = codeVerifier;
  (req.session as any).state = state;

  res.redirect(url);
});

app.get('/api/auth/twitter/callback', async (req, res) => {
  const { state, code } = req.query;
  const sessionState = (req.session as any).state;
  const codeVerifier = (req.session as any).codeVerifier;

  if (!state || !sessionState || state !== sessionState) {
    res.status(400).send('Invalid state!');
    return;
  }

  if (!code || !codeVerifier) {
    res.status(400).send('Missing code or verifier!');
    return;
  }

  try {
    const { accessToken, user } = await xService.login(code as string, codeVerifier);

    // Store access token in session
    (req.session as any).xAccessToken = accessToken;
    (req.session as any).xUser = user;

    res.redirect(`${CLIENT_ORIGIN}?x_auth=success&username=${user.username}`);
  } catch (err) {
    console.error(err);
    res.status(403).send('Authentication failed!');
  }
});

// Endpoint to post updates
app.post('/api/x/post', express.json(), async (req, res) => {
  const accessToken = (req.session as any).xAccessToken;
  if (!accessToken) {
    res.status(401).json({ error: 'Not authenticated with X' });
    return;
  }

  const { text } = req.body;
  if (!text) {
    res.status(400).json({ error: 'Text is required' });
    return;
  }

  try {
    const tweet = await xService.postTweet(accessToken, text);
    res.json({ success: true, tweet });
  } catch (err) {
    res.status(500).json({ error: 'Failed to post tweet' });
  }
});

// Initialize world then start server
worldManager.init().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`CityZen server running on http://localhost:${PORT}`);
  });
});

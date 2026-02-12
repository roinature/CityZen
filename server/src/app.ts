import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { CLIENT_ORIGIN, SESSION_SECRET, TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, TWITTER_CALLBACK_URL, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { RoomManager } from './game/RoomManager.js';
import { WorldManager } from './game/WorldManager.js';
import { createGameRoutes } from './routes/gameRoutes.js';
import { initBroadcast } from './realtime/supabaseBroadcast.js';
import { XService } from './services/XService.js';
import { GoogleService } from './services/GoogleService.js';
import { prisma } from './persistence/prismaClient.js';

const app = express();

// Middleware
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// Initialize Supabase broadcast
initBroadcast();

const roomManager = new RoomManager(prisma);
export const worldManager = new WorldManager(roomManager);

// Lazy initialization for serverless (runs once on cold start)
let initPromise: Promise<void> | null = null;
function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = worldManager.init();
  }
  return initPromise;
}

app.use(async (_req, _res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (err) {
    next(err);
  }
});

// REST endpoints
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/cities', async (_req, res) => {
  const cities = await roomManager.listAllCities();
  res.json(cities);
});

app.get('/api/world', (req, res) => {
  const worldId = (req.query.worldId as string) || 'default';
  res.json(worldManager.getWorldState(worldId));
});

app.get('/api/worlds', async (_req, res) => {
  const worlds = await worldManager.listWorlds();
  res.json(worlds);
});

app.post('/api/worlds/create', async (req, res) => {
  try {
    const { name, gridSize, maxCities, initialPopulation } = req.body;
    if (!name) {
      res.json({ success: false, error: 'Name is required' });
      return;
    }
    const state = await worldManager.createWorld(name, { gridSize, maxCities, initialPopulation });
    res.json({ success: true, worldId: state.id, world: state });
  } catch (err) {
    res.json({ success: false, error: 'Failed to create world' });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY });
});

// Game routes
app.use('/api', createGameRoutes(roomManager, worldManager));

// Session Middleware
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

const xService = new XService({
  clientId: TWITTER_CLIENT_ID,
  clientSecret: TWITTER_CLIENT_SECRET,
  callbackUrl: TWITTER_CALLBACK_URL
});

const googleService = new GoogleService();

// X Auth Routes
app.get('/api/auth/twitter', (req, res) => {
  const { url, codeVerifier, state } = xService.generateAuthLink();
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
    (req.session as any).xAccessToken = accessToken;
    (req.session as any).xUser = user;
    res.redirect(`${CLIENT_ORIGIN}?x_auth=success&username=${user.username}`);
  } catch (err) {
    console.error(err);
    res.status(403).send('Authentication failed!');
  }
});

// Google Auth Routes
app.get('/api/auth/google', async (req, res) => {
  try {
    const authUrl = await googleService.generateAuthUrl();
    res.redirect(authUrl);
  } catch (err) {
    console.error('Google Auth Error:', err);
    res.status(500).send('Failed to generate Google auth URL');
  }
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    res.status(400).send('Missing authorization code');
    return;
  }

  try {
    const { user, sessionToken } = await googleService.exchangeCodeForSession(code as string);
    (req.session as any).googleAccessToken = sessionToken;
    (req.session as any).googleUser = user;
    res.redirect(`${CLIENT_ORIGIN}?google_auth=success&username=${encodeURIComponent(user.name)}&email=${encodeURIComponent(user.email)}`);
  } catch (err) {
    console.error('Google Auth Callback Error:', err);
    res.status(403).send('Google authentication failed!');
  }
});

app.post('/api/x/post', async (req, res) => {
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

// Google User Info Endpoint
app.get('/api/auth/google/user', async (req, res) => {
  const accessToken = (req.session as any).googleAccessToken;
  if (!accessToken) {
    res.status(401).json({ error: 'Not authenticated with Google' });
    return;
  }

  try {
    const user = await googleService.verifyUser(accessToken);
    if (!user) {
      res.status(401).json({ error: 'Invalid or expired Google session' });
      return;
    }
    res.json({ user });
  } catch (err) {
    console.error('Google User Verification Error:', err);
    res.status(500).json({ error: 'Failed to verify Google user' });
  }
});

export default app;

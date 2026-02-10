import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { CLIENT_ORIGIN, SESSION_SECRET, TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, TWITTER_CALLBACK_URL, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { RoomManager } from './game/RoomManager.js';
import { WorldManager } from './game/WorldManager.js';
import { createGameRoutes } from './routes/gameRoutes.js';
import { initBroadcast } from './realtime/supabaseBroadcast.js';
import { XService } from './services/XService.js';

const app = express();

// Middleware
app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

// Initialize Supabase broadcast
initBroadcast();

const roomManager = new RoomManager();
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

app.get('/api/world', (_req, res) => {
  res.json(worldManager.getWorldState());
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

export default app;

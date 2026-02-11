import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3030;
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

// X (Twitter) Configuration
export const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
export const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
export const TWITTER_CALLBACK_URL = process.env.TWITTER_CALLBACK_URL || `http://localhost:${PORT}/api/auth/twitter/callback`;
export const SESSION_SECRET = process.env.SESSION_SECRET || 'secret-key-change-me'; // Should be in .env

// Supabase Configuration
export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';


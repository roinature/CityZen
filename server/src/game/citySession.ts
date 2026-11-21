import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { IS_SERVERLESS, SESSION_SECRET, SUPABASE_SERVICE_ROLE_KEY } from '../config.js';

const COOKIE_NAME = 'cityzen_city';
const secret = process.env.SESSION_SECRET || SUPABASE_SERVICE_ROLE_KEY || SESSION_SECRET;
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: IS_SERVERLESS };

export interface CitySession {
  playerId: string;
  cityId: string;
  unlimitedMoney?: boolean;
}

function signature(payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export function writeCitySession(res: Response, session: CitySession): void {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  res.cookie(COOKIE_NAME, `${payload}.${signature(payload).toString('base64url')}`, cookieOptions);
}

export function clearCitySession(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

export function readCitySession(req: Request, playerId: string): CitySession | null {
  if (!playerId) return null;
  const token = req.headers.cookie?.split(/;\s*/).find(cookie => cookie.startsWith(`${COOKIE_NAME}=`));
  const match = token?.match(/^cityzen_city=([\w-]+)\.([\w-]+)$/);
  if (!match) return null;
  const provided = Buffer.from(match[2], 'base64url');
  const expected = signature(match[1]);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(match[1], 'base64url').toString()) as CitySession | null;
    return session?.playerId === playerId && typeof session.cityId === 'string' ? session : null;
  } catch {
    return null;
  }
}

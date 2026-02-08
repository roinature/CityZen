import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PlayerProfile } from '@cityzen/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAYERS_DIR = path.join(__dirname, '../../data/players');

export async function savePlayerProfile(profile: PlayerProfile): Promise<void> {
  await fs.mkdir(PLAYERS_DIR, { recursive: true });
  const filePath = path.join(PLAYERS_DIR, `${profile.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(profile, null, 2));
}

export async function loadPlayerProfile(playerId: string): Promise<PlayerProfile | null> {
  const filePath = path.join(PLAYERS_DIR, `${playerId}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as PlayerProfile;
  } catch {
    return null;
  }
}

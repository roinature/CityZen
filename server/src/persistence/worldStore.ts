import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { WorldState } from '@cityzen/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');

export async function saveWorldState(state: WorldState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, `world_${state.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

export async function loadWorldState(worldId: string): Promise<WorldState | null> {
  const filePath = path.join(DATA_DIR, `world_${worldId}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as WorldState;
  } catch {
    return null;
  }
}

export async function loadOrCreateDefaultWorld(): Promise<{ state: WorldState; isNew: boolean }> {
  const existing = await loadWorldState('default');
  if (existing) return { state: existing, isNew: false };

  const state: WorldState = {
    id: 'default',
    name: 'World',
    gridSize: 8,
    cities: [],
    clock: { gameTimeMs: 0, speed: 1, gameDay: 0, gameYear: 1 },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveWorldState(state);
  return { state, isNew: true };
}

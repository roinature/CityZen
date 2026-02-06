import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CityState } from '@cityzen/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');

export async function saveCityState(cityId: string, state: CityState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const filePath = path.join(DATA_DIR, `${cityId}.json`);
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
}

export async function loadCityState(cityId: string): Promise<CityState | null> {
  const filePath = path.join(DATA_DIR, `${cityId}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as CityState;
  } catch {
    return null;
  }
}

export async function listSavedCities(): Promise<string[]> {
  try {
    const files = await fs.readdir(DATA_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}

export async function deleteCityState(cityId: string): Promise<void> {
  const filePath = path.join(DATA_DIR, `${cityId}.json`);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist
  }
}

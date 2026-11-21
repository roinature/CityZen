import { elevations } from './elevations.js';
import type { Grid } from '../types/grid.js';

export type SiteId = keyof typeof elevations;
export const CELL_METRES = 50;
// Compatibility coordinates keep distant sites separate in the road-neighbor simulation.
const californiaSites = [
  { id: 'san-gregorio', name: 'San Gregorio Coast', latitude: 37.326, longitude: -122.397, position: { wx: 100, wz: 100 } },
  { id: 'san-joaquin', name: 'San Joaquin Valley', latitude: 36.730, longitude: -120.160, position: { wx: 200, wz: 100 } },
  { id: 'sierra-foothills', name: 'Sierra Foothills', latitude: 38.934, longitude: -121.082, position: { wx: 300, wz: 100 } },
] as const;

export const EARTH_SITES = californiaSites.map(site => ({ ...site, continent: 'North America', country: 'United States' }));

export function getSite(id?: string | null) {
  return EARTH_SITES.find(site => site.id === id);
}

export function terrainCell(id: SiteId, x: number, z: number) {
  const rows = elevations[id];
  const height = (x: number, z: number) => Math.max(0, rows[Math.max(0, Math.min(rows.length - 1, z))][Math.max(0, Math.min(rows[0].length - 1, x))]);
  const elevation = height(x, z);
  const east = (height(x + 1, z) - height(x - 1, z)) / (2 * CELL_METRES);
  const south = (height(x, z + 1) - height(x, z - 1)) / (2 * CELL_METRES);
  const water = id === 'san-gregorio' && elevation === 0;
  const steep = Math.hypot(east, south) > 0.40;
  return { elevation, east, south, water, steep };
}

export function applySiteTerrain(grid: Grid, siteId?: string | null): void {
  const site = getSite(siteId);
  if (!site) return;
  grid.forEach((column, x) => column.forEach((cell, z) => {
    const { water, steep } = terrainCell(site.id, x, z);
    if (water) cell.terrain = 'water';
    else if (steep) cell.terrain = 'steep';
  }));
}

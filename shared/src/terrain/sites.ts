import { elevations } from './elevations.js';
import type { Grid } from '../types/grid.js';

export const CELL_METRES = 50;
const SITE_SIZE = 64;

// scripts/sample-earth-sites.py reads this list to refresh elevations.ts. Keep one site per line.
// `coast: true` marks sites where ground at or below 0 m is open sea; elsewhere it is dry land.
const SITE_LIST = [
  // North America
  { id: 'san-gregorio', name: 'San Gregorio Coast', continent: 'North America', country: 'United States', latitude: 37.326, longitude: -122.397, coast: true },
  { id: 'san-joaquin', name: 'San Joaquin Valley', continent: 'North America', country: 'United States', latitude: 36.730, longitude: -120.160 },
  { id: 'sierra-foothills', name: 'Sierra Foothills', continent: 'North America', country: 'United States', latitude: 38.934, longitude: -121.082 },
  { id: 'hudson-valley', name: 'Hudson Valley', continent: 'North America', country: 'United States', latitude: 41.750, longitude: -73.930 },
  { id: 'texas-hill-country', name: 'Texas Hill Country', continent: 'North America', country: 'United States', latitude: 30.270, longitude: -98.870 },
  { id: 'sarasota-coast', name: 'Sarasota Gulf Coast', continent: 'North America', country: 'United States', latitude: 27.330, longitude: -82.545, coast: true },
  { id: 'grand-river', name: 'Grand River Farmland', continent: 'North America', country: 'Canada', latitude: 43.450, longitude: -80.490 },
  { id: 'halifax-harbour', name: 'Halifax Harbour', continent: 'North America', country: 'Canada', latitude: 44.660, longitude: -63.585, coast: true },
  { id: 'oaxaca-valley', name: 'Oaxaca Valley', continent: 'North America', country: 'Mexico', latitude: 17.060, longitude: -96.720 },
  { id: 'la-paz-bay', name: 'La Paz Bay', continent: 'North America', country: 'Mexico', latitude: 24.170, longitude: -110.330, coast: true },
  // South America
  { id: 'curitiba-plateau', name: 'Curitiba Plateau', continent: 'South America', country: 'Brazil', latitude: -25.430, longitude: -49.270 },
  { id: 'serra-gaucha', name: 'Serra Gaúcha', continent: 'South America', country: 'Brazil', latitude: -29.170, longitude: -51.520 },
  { id: 'mendoza-vineyards', name: 'Mendoza Vineyards', continent: 'South America', country: 'Argentina', latitude: -33.000, longitude: -68.850 },
  { id: 'pampas', name: 'The Pampas', continent: 'South America', country: 'Argentina', latitude: -34.900, longitude: -60.000 },
  { id: 'valparaiso-coast', name: 'Valparaíso Coast', continent: 'South America', country: 'Chile', latitude: -33.040, longitude: -71.600, coast: true },
  { id: 'sacred-valley', name: 'Sacred Valley', continent: 'South America', country: 'Peru', latitude: -13.330, longitude: -72.080 },
  { id: 'coffee-axis', name: 'Coffee Axis', continent: 'South America', country: 'Colombia', latitude: 4.810, longitude: -75.690 },
  // Europe
  { id: 'cotswolds', name: 'Cotswolds', continent: 'Europe', country: 'United Kingdom', latitude: 51.830, longitude: -1.830 },
  { id: 'falmouth-coast', name: 'Falmouth Coast', continent: 'Europe', country: 'United Kingdom', latitude: 50.150, longitude: -5.070, coast: true },
  { id: 'loire-valley', name: 'Loire Valley', continent: 'Europe', country: 'France', latitude: 47.400, longitude: 0.980 },
  { id: 'antibes-coast', name: 'Antibes Coast', continent: 'Europe', country: 'France', latitude: 43.580, longitude: 7.120, coast: true },
  { id: 'guadalquivir', name: 'Guadalquivir Plain', continent: 'Europe', country: 'Spain', latitude: 37.390, longitude: -5.980 },
  { id: 'costa-brava', name: 'Costa Brava', continent: 'Europe', country: 'Spain', latitude: 41.870, longitude: 3.170, coast: true },
  { id: 'tuscan-hills', name: 'Tuscan Hills', continent: 'Europe', country: 'Italy', latitude: 43.470, longitude: 11.250 },
  { id: 'bari-coast', name: 'Bari Coast', continent: 'Europe', country: 'Italy', latitude: 41.120, longitude: 16.870, coast: true },
  { id: 'rhine-valley', name: 'Rhine Valley', continent: 'Europe', country: 'Germany', latitude: 49.990, longitude: 7.900 },
  { id: 'polder', name: 'Holland Polder', continent: 'Europe', country: 'Netherlands', latitude: 52.600, longitude: 4.900 },
  { id: 'oslofjord', name: 'Oslofjord', continent: 'Europe', country: 'Norway', latitude: 59.900, longitude: 10.750, coast: true },
  { id: 'heraklion-coast', name: 'Heraklion Coast', continent: 'Europe', country: 'Greece', latitude: 35.330, longitude: 25.130, coast: true },
  // Asia
  { id: 'jezreel-valley', name: 'Jezreel Valley', continent: 'Asia', country: 'Israel', latitude: 32.630, longitude: 35.300 },
  { id: 'tel-aviv-coast', name: 'Tel Aviv Coast', continent: 'Asia', country: 'Israel', latitude: 32.100, longitude: 34.780, coast: true },
  { id: 'negev', name: 'Negev Plateau', continent: 'Asia', country: 'Israel', latitude: 31.250, longitude: 34.800 },
  { id: 'judean-hills', name: 'Judean Hills', continent: 'Asia', country: 'Israel', latitude: 31.770, longitude: 35.150 },
  { id: 'kyoto-basin', name: 'Kyoto Basin', continent: 'Asia', country: 'Japan', latitude: 35.000, longitude: 135.750 },
  { id: 'shonan-coast', name: 'Shonan Coast', continent: 'Asia', country: 'Japan', latitude: 35.310, longitude: 139.480, coast: true },
  { id: 'yangtze-delta', name: 'Yangtze Delta', continent: 'Asia', country: 'China', latitude: 31.100, longitude: 121.000 },
  { id: 'deccan-plateau', name: 'Deccan Plateau', continent: 'Asia', country: 'India', latitude: 18.500, longitude: 73.850 },
  { id: 'kochi-coast', name: 'Kochi Coast', continent: 'Asia', country: 'India', latitude: 9.950, longitude: 76.250, coast: true },
  { id: 'mekong-delta', name: 'Mekong Delta', continent: 'Asia', country: 'Vietnam', latitude: 10.050, longitude: 105.750 },
  { id: 'cappadocia', name: 'Cappadocia', continent: 'Asia', country: 'Turkey', latitude: 38.650, longitude: 34.850 },
  { id: 'dubai-coast', name: 'Dubai Coast', continent: 'Asia', country: 'United Arab Emirates', latitude: 25.070, longitude: 55.160, coast: true },
  // Africa
  { id: 'cape-winelands', name: 'Cape Winelands', continent: 'Africa', country: 'South Africa', latitude: -33.930, longitude: 18.860 },
  { id: 'rift-valley', name: 'Great Rift Valley', continent: 'Africa', country: 'Kenya', latitude: -0.280, longitude: 36.070 },
  { id: 'kilimanjaro-foothills', name: 'Kilimanjaro Foothills', continent: 'Africa', country: 'Tanzania', latitude: -3.350, longitude: 37.350 },
  { id: 'marrakesh-plain', name: 'Marrakesh Plain', continent: 'Africa', country: 'Morocco', latitude: 31.600, longitude: -8.000 },
  { id: 'nile-valley', name: 'Nile Valley', continent: 'Africa', country: 'Egypt', latitude: 25.700, longitude: 32.640 },
  { id: 'ethiopian-highlands', name: 'Ethiopian Highlands', continent: 'Africa', country: 'Ethiopia', latitude: 9.000, longitude: 38.750 },
  { id: 'dakar-coast', name: 'Dakar Coast', continent: 'Africa', country: 'Senegal', latitude: 14.738, longitude: -17.515, coast: true },
  // Oceania
  { id: 'barossa-valley', name: 'Barossa Valley', continent: 'Oceania', country: 'Australia', latitude: -34.530, longitude: 138.950 },
  { id: 'northern-beaches', name: 'Northern Beaches', continent: 'Oceania', country: 'Australia', latitude: -33.720, longitude: 151.300, coast: true },
  { id: 'canterbury-plains', name: 'Canterbury Plains', continent: 'Oceania', country: 'New Zealand', latitude: -43.550, longitude: 172.400 },
  { id: 'bay-of-plenty', name: 'Bay of Plenty', continent: 'Oceania', country: 'New Zealand', latitude: -37.680, longitude: 176.170, coast: true },
] as const;

export type SiteId = (typeof SITE_LIST)[number]['id'];

export interface EarthSite {
  id: SiteId;
  name: string;
  continent: string;
  country: string;
  latitude: number;
  longitude: number;
  coast: boolean;
  /** Compatibility coordinates keep distant sites separate in the road-neighbor simulation. */
  position: { wx: number; wz: number };
}

export const EARTH_SITES: readonly EarthSite[] = SITE_LIST.map((site, index) => ({
  ...site,
  coast: 'coast' in site && site.coast,
  position: { wx: 100 * (index + 1), wz: 100 },
}));

export function getSite(id?: string | null) {
  return EARTH_SITES.find(site => site.id === id);
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const decoded = new Map<string, Int16Array>();

/** Elevations are stored as base64 zig-zag varint deltas, row-major, north to south. */
function siteElevations(id: SiteId): Int16Array {
  let grid = decoded.get(id);
  if (grid) return grid;
  const bytes = Uint8Array.from(atob(elevations[id]), char => char.charCodeAt(0));
  grid = new Int16Array(SITE_SIZE * SITE_SIZE);
  let previous = 0;
  for (let i = 0, offset = 0; i < grid.length; i++) {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = bytes[offset++];
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    previous += (value >>> 1) ^ -(value & 1);
    grid[i] = previous;
  }
  decoded.set(id, grid);
  return grid;
}

export function terrainCell(id: SiteId, x: number, z: number) {
  const site = getSite(id);
  const rows = siteElevations(id);
  const clamp = (v: number) => Math.max(0, Math.min(SITE_SIZE - 1, v));
  const raw = (x: number, z: number) => rows[clamp(z) * SITE_SIZE + clamp(x)];
  const height = site?.coast ? (x: number, z: number) => Math.max(0, raw(x, z)) : raw;
  const elevation = height(x, z);
  const east = (height(x + 1, z) - height(x - 1, z)) / (2 * CELL_METRES);
  const south = (height(x, z + 1) - height(x, z - 1)) / (2 * CELL_METRES);
  const water = !!site?.coast && raw(x, z) <= 0;
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

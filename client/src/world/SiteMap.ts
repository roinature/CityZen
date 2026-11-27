import { DEFAULT_GRID_SIZE, terrainCell, type Grid, type SiteId } from '@cityzen/shared';

export function drawSiteMap(siteId: SiteId, grid?: Grid) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = DEFAULT_GRID_SIZE;
  const ctx = canvas.getContext('2d')!;
  let max = 0;
  let min = Infinity;
  let buildable = 0;
  for (let z = 0; z < canvas.height; z++) {
    for (let x = 0; x < canvas.width; x++) {
      const { elevation, east, south, water, steep } = terrainCell(siteId, x, z);
      const cellTerrain = grid ? grid[x]?.[z]?.terrain : (water ? 'water' : steep ? 'steep' : undefined);
      const isWater = cellTerrain === 'water';
      const isSteep = cellTerrain === 'steep';
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
      if (!isWater && !isSteep) buildable++;
      const light = Math.max(24, Math.min(73, 51 + (east + south) * 36 + (elevation % 20) / 8));
      ctx.fillStyle = isWater ? '#447f99' : `hsl(${isSteep ? 37 : 91} 27% ${light}%)`;
      ctx.fillRect(x, z, 1, 1);
    }
  }
  return { canvas, min, max, buildable: Math.round(100 * buildable / DEFAULT_GRID_SIZE ** 2) };
}

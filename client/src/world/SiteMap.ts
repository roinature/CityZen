import { DEFAULT_GRID_SIZE, terrainCell, type SiteId } from '@cityzen/shared';

export function drawSiteMap(siteId: SiteId) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = DEFAULT_GRID_SIZE;
  const ctx = canvas.getContext('2d')!;
  let max = 0;
  let min = Infinity;
  let buildable = 0;
  for (let z = 0; z < canvas.height; z++) {
    for (let x = 0; x < canvas.width; x++) {
      const { elevation, east, south, water, steep } = terrainCell(siteId, x, z);
      min = Math.min(min, elevation);
      max = Math.max(max, elevation);
      if (!water && !steep) buildable++;
      const light = Math.max(24, Math.min(73, 51 + (east + south) * 36 + (elevation % 20) / 8));
      ctx.fillStyle = water ? '#447f99' : `hsl(${steep ? 37 : 91} 27% ${light}%)`;
      ctx.fillRect(x, z, 1, 1);
    }
  }
  return { canvas, min, max, buildable: Math.round(100 * buildable / DEFAULT_GRID_SIZE ** 2) };
}

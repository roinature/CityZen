/**
 * Generates facade + roof textures for energy buildings using pure Node.js (no native deps).
 * Outputs 512x512 PNGs using raw RGBA pixels + zlib deflate.
 */
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

const SIZE = 512;
const OUT = 'client/public/textures/buildings';

// --- Minimal PNG encoder (RGBA) ---
function encodePNG(width, height, pixels) {
  // pixels: Uint8Array of length width * height * 4 (RGBA)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeB = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeB, data]);
    const crc = crc32(body);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, body, crcB]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT: filter byte 0 (None) per row
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(Buffer.from([0])); // filter none
    rawRows.push(Buffer.from(pixels.buffer, y * width * 4, width * 4));
  }
  const raw = Buffer.concat(rawRows);
  const compressed = deflateSync(raw, { level: 6 });

  // IEND
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', iend),
  ]);
}

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// --- Drawing helpers ---
function createPixels() { return new Uint8Array(SIZE * SIZE * 4); }

function setPixel(px, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = a;
}

function fillRect(px, x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++)
      setPixel(px, x, y, r, g, b, a);
}

function fillCircle(px, cx, cy, radius, r, g, b, a = 255) {
  for (let y = cy - radius; y <= cy + radius; y++)
    for (let x = cx - radius; x <= cx + radius; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2)
        setPixel(px, x, y, r, g, b, a);
}

function fillAll(px, r, g, b) {
  for (let i = 0; i < px.length; i += 4) { px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = 255; }
}

function addNoise(px, amount) {
  for (let i = 0; i < px.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    px[i] = Math.max(0, Math.min(255, px[i] + n));
    px[i+1] = Math.max(0, Math.min(255, px[i+1] + n));
    px[i+2] = Math.max(0, Math.min(255, px[i+2] + n));
  }
}

// --- WIND TURBINE facade: tall white tower with structural panels ---
function generateWindTurbineFacade() {
  const px = createPixels();
  // Light gray base
  fillAll(px, 210, 210, 215);

  // Vertical panel lines (tower structure)
  for (let stripe = 0; stripe < 8; stripe++) {
    const sx = stripe * 64;
    // Alternating slightly different grays for panel effect
    const shade = stripe % 2 === 0 ? 195 : 220;
    fillRect(px, sx, 0, 62, SIZE, shade, shade, shade + 5);
    // Thin dark joint line
    fillRect(px, sx + 62, 0, 2, SIZE, 150, 150, 155);
  }

  // Horizontal rivet lines every ~85px
  for (let row = 0; row < 6; row++) {
    const ry = row * 85 + 40;
    fillRect(px, 0, ry, SIZE, 3, 160, 162, 168);
    // Bolts/rivets
    for (let bx = 30; bx < SIZE; bx += 64) {
      fillCircle(px, bx, ry + 1, 4, 140, 142, 148);
      fillCircle(px, bx, ry + 1, 2, 175, 178, 182);
    }
  }

  // Red aviation warning stripe near top
  fillRect(px, 0, 20, SIZE, 30, 220, 50, 40);
  fillRect(px, 0, 50, SIZE, 2, 180, 30, 25);

  addNoise(px, 8);
  return px;
}

// --- WIND TURBINE roof: top of turbine hub, circular metal ---
function generateWindTurbineRoof() {
  const px = createPixels();
  fillAll(px, 190, 195, 200);

  // Hub circle
  const cx = SIZE / 2, cy = SIZE / 2;
  fillCircle(px, cx, cy, 180, 210, 215, 220);
  fillCircle(px, cx, cy, 160, 200, 205, 210);
  // Blade attachment points (3 arms)
  for (let a = 0; a < 3; a++) {
    const angle = (a * 2 * Math.PI) / 3 - Math.PI / 2;
    for (let r = 0; r < 200; r++) {
      const bx = Math.round(cx + Math.cos(angle) * r);
      const by = Math.round(cy + Math.sin(angle) * r);
      fillRect(px, bx - 6, by - 6, 12, 12, 180, 185, 190);
    }
  }
  // Center hub bolt
  fillCircle(px, cx, cy, 35, 160, 165, 170);
  fillCircle(px, cx, cy, 20, 140, 145, 150);
  fillCircle(px, cx, cy, 8, 120, 125, 130);

  addNoise(px, 10);
  return px;
}

// --- SOLAR FARM facade: rows of solar panels ---
function generateSolarFarmFacade() {
  const px = createPixels();
  // Dark frame background
  fillAll(px, 45, 50, 60);

  const panelRows = 4;
  const panelCols = 4;
  const padX = 12, padY = 12;
  const pw = (SIZE - padX * (panelCols + 1)) / panelCols;
  const ph = (SIZE - padY * (panelRows + 1)) / panelRows;

  for (let row = 0; row < panelRows; row++) {
    for (let col = 0; col < panelCols; col++) {
      const px0 = padX + col * (pw + padX);
      const py0 = padY + row * (ph + padY);

      // Panel frame (silver)
      fillRect(px, px0, py0, pw, ph, 160, 165, 175);
      // Panel glass (dark blue)
      fillRect(px, px0 + 4, py0 + 4, pw - 8, ph - 8, 20, 50, 140);

      // Cell grid lines
      const cellW = (pw - 8) / 6;
      const cellH = (ph - 8) / 4;
      for (let cx = 1; cx < 6; cx++) {
        const lx = Math.round(px0 + 4 + cx * cellW);
        fillRect(px, lx, py0 + 4, 1, ph - 8, 30, 60, 155);
      }
      for (let cy = 1; cy < 4; cy++) {
        const ly = Math.round(py0 + 4 + cy * cellH);
        fillRect(px, px0 + 4, ly, pw - 8, 1, 30, 60, 155);
      }

      // Specular highlight (top-left corner shine)
      fillRect(px, px0 + 6, py0 + 6, 20, 8, 60, 100, 190);
      fillRect(px, px0 + 6, py0 + 14, 10, 6, 45, 80, 170);
    }
  }

  addNoise(px, 6);
  return px;
}

// --- SOLAR FARM roof: aerial view of solar panel array ---
function generateSolarFarmRoof() {
  const px = createPixels();
  fillAll(px, 35, 45, 55);

  // Rows of panels tilted (seen from top = dark blue rectangles)
  for (let row = 0; row < 8; row++) {
    const ry = row * 64 + 4;
    fillRect(px, 8, ry, SIZE - 16, 52, 18, 45, 130);
    // Grid lines within each row
    for (let c = 0; c < 8; c++) {
      const cx = 8 + c * ((SIZE - 16) / 8);
      fillRect(px, Math.round(cx), ry, 1, 52, 25, 55, 145);
    }
    fillRect(px, 8, ry + 25, SIZE - 16, 1, 25, 55, 145);
  }

  addNoise(px, 5);
  return px;
}

// --- COAL PLANT facade: dark industrial with smokestacks ---
function generateCoalPlantFacade() {
  const px = createPixels();
  // Dark gray concrete
  fillAll(px, 65, 65, 68);

  // Main building wall sections
  for (let s = 0; s < 4; s++) {
    const sx = s * 128;
    const shade = 58 + (s % 2) * 14;
    fillRect(px, sx, 100, 126, 412, shade, shade, shade + 2);
    fillRect(px, sx + 126, 100, 2, 412, 40, 40, 42);
  }

  // Windows (industrial, small, grid pattern)
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      const wx = col * 62 + 14;
      const wy = row * 90 + 120;
      // Window frame (dark)
      fillRect(px, wx, wy, 36, 28, 35, 35, 38);
      // Glass (dirty yellowish)
      fillRect(px, wx + 3, wy + 3, 30, 22, 90, 85, 55);
      // Cross bar
      fillRect(px, wx + 17, wy + 3, 2, 22, 50, 50, 52);
      fillRect(px, wx + 3, wy + 13, 30, 2, 50, 50, 52);
    }
  }

  // Smokestack silhouettes at top
  fillRect(px, 80, 0, 50, 100, 55, 52, 50);
  fillRect(px, 200, 0, 65, 80, 50, 48, 46);
  fillRect(px, 350, 0, 55, 95, 52, 50, 48);

  // Red/white hazard stripe at bottom
  for (let x = 0; x < SIZE; x += 40) {
    fillRect(px, x, SIZE - 25, 20, 25, 180, 40, 35);
    fillRect(px, x + 20, SIZE - 25, 20, 25, 200, 200, 195);
  }

  // Soot/grime darkening near top
  for (let y = 0; y < 60; y++) {
    const alpha = 1 - y / 60;
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      px[i] = Math.round(px[i] * (1 - alpha * 0.3));
      px[i+1] = Math.round(px[i+1] * (1 - alpha * 0.3));
      px[i+2] = Math.round(px[i+2] * (1 - alpha * 0.3));
    }
  }

  addNoise(px, 12);
  return px;
}

// --- COAL PLANT roof: industrial rooftop with vents ---
function generateCoalPlantRoof() {
  const px = createPixels();
  fillAll(px, 72, 70, 68);

  // Corrugated roof ridges
  for (let y = 0; y < SIZE; y += 16) {
    const shade = y % 32 === 0 ? 80 : 62;
    fillRect(px, 0, y, SIZE, 14, shade, shade - 2, shade - 4);
  }

  // Smokestacks (circles from above)
  const stacks = [[128, 128, 50], [300, 200, 60], [400, 380, 45]];
  for (const [sx, sy, sr] of stacks) {
    fillCircle(px, sx, sy, sr + 8, 50, 48, 46);
    fillCircle(px, sx, sy, sr, 40, 38, 36);
    fillCircle(px, sx, sy, sr - 10, 30, 25, 22);
  }

  // Pipes
  fillRect(px, 100, 250, 300, 14, 85, 82, 78);
  fillRect(px, 100, 250, 300, 3, 95, 92, 88);

  addNoise(px, 10);
  return px;
}

// --- NUCLEAR PLANT facade: concrete cooling tower / containment building ---
function generateNuclearPlantFacade() {
  const px = createPixels();
  // Pale concrete
  fillAll(px, 175, 170, 168);

  // Vertical concrete panel joints
  for (let s = 0; s < 8; s++) {
    const sx = s * 64;
    const shade = 168 + (s % 2) * 12;
    fillRect(px, sx, 0, 62, SIZE, shade, shade - 3, shade - 5);
    fillRect(px, sx + 62, 0, 2, SIZE, 130, 128, 126);
  }

  // Horizontal expansion joints
  for (let row = 0; row < 6; row++) {
    const ry = row * 90 + 30;
    fillRect(px, 0, ry, SIZE, 2, 140, 138, 135);
  }

  // Radiation trefoil warning sign (center)
  const cx = SIZE / 2, cy = SIZE / 2;
  // Yellow background circle
  fillCircle(px, cx, cy, 65, 240, 200, 20);
  fillCircle(px, cx, cy, 58, 240, 205, 30);
  // Trefoil blades
  for (let a = 0; a < 3; a++) {
    const angle = (a * 2 * Math.PI) / 3 - Math.PI / 2;
    for (let r = 15; r < 48; r++) {
      for (let spread = -0.45; spread <= 0.45; spread += 0.05) {
        const bx = Math.round(cx + Math.cos(angle + spread) * r);
        const by = Math.round(cy + Math.sin(angle + spread) * r);
        setPixel(px, bx, by, 20, 20, 20);
      }
    }
  }
  // Center dot
  fillCircle(px, cx, cy, 10, 20, 20, 20);

  // Containment dome curvature shading (subtle gradient on sides)
  for (let x = 0; x < SIZE; x++) {
    const dist = Math.abs(x - SIZE / 2) / (SIZE / 2);
    const darken = dist * 0.15;
    for (let y = 0; y < SIZE; y++) {
      const i = (y * SIZE + x) * 4;
      px[i] = Math.round(px[i] * (1 - darken));
      px[i+1] = Math.round(px[i+1] * (1 - darken));
      px[i+2] = Math.round(px[i+2] * (1 - darken));
    }
  }

  addNoise(px, 8);
  return px;
}

// --- NUCLEAR PLANT roof: cooling tower top with steam opening ---
function generateNuclearPlantRoof() {
  const px = createPixels();
  fillAll(px, 160, 156, 152);

  const cx = SIZE / 2, cy = SIZE / 2;

  // Cooling tower ring (seen from above)
  // Outer wall
  fillCircle(px, cx, cy, 230, 148, 144, 140);
  // Inner opening
  fillCircle(px, cx, cy, 170, 120, 130, 145);
  // Steam / water
  fillCircle(px, cx, cy, 140, 160, 180, 200);
  fillCircle(px, cx, cy, 100, 180, 200, 220);
  fillCircle(px, cx, cy, 60, 200, 215, 235);

  // Structural ribs radiating out
  for (let a = 0; a < 12; a++) {
    const angle = (a * 2 * Math.PI) / 12;
    for (let r = 170; r < 230; r++) {
      const bx = Math.round(cx + Math.cos(angle) * r);
      const by = Math.round(cy + Math.sin(angle) * r);
      fillRect(px, bx - 2, by - 2, 4, 4, 135, 132, 128);
    }
  }

  addNoise(px, 8);
  return px;
}

// --- Generate all textures ---
const textures = [
  { name: 'wind_turbine_facade', gen: generateWindTurbineFacade },
  { name: 'wind_turbine_roof', gen: generateWindTurbineRoof },
  { name: 'solar_farm_facade', gen: generateSolarFarmFacade },
  { name: 'solar_farm_roof', gen: generateSolarFarmRoof },
  { name: 'coal_plant_facade', gen: generateCoalPlantFacade },
  { name: 'coal_plant_roof', gen: generateCoalPlantRoof },
  { name: 'nuclear_plant_facade', gen: generateNuclearPlantFacade },
  { name: 'nuclear_plant_roof', gen: generateNuclearPlantRoof },
];

for (const { name, gen } of textures) {
  const pixels = gen();
  const png = encodePNG(SIZE, SIZE, pixels);
  const path = `${OUT}/${name}.png`;
  writeFileSync(path, png);
  console.log(`Generated: ${path}`);
}

console.log('Done! 8 energy textures generated.');

/**
 * Generates catalogue thumbnail PNGs for waterfront buildings using pure Node.js (zlib).
 */
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

const SIZE = 256;
const OUT = 'client/public/textures/buildings';

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

function encodePNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crcB]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(Buffer.from([0]), Buffer.from(pixels.buffer, y * width * 4, width * 4));
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rawRows), { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function createPixels() { return new Uint8Array(SIZE * SIZE * 4); }
function setPixel(px, x, y, r, g, b) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
}
function fillRect(px, x0, y0, w, h, r, g, b) {
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
    for (let x = Math.round(x0); x < Math.round(x0 + w); x++)
      setPixel(px, x, y, r, g, b);
}
function fillTri(px, x1, y1, x2, y2, x3, y3, r, g, b) {
  const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3)));
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(x1, x2, x3)));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3)));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(y1, y2, y3)));
  const area = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w1 = ((x2 - x) * (y3 - y) - (x3 - x) * (y2 - y)) / area;
      const w2 = ((x3 - x) * (y1 - y) - (x1 - x) * (y3 - y)) / area;
      const w3 = 1 - w1 - w2;
      if (w1 >= 0 && w2 >= 0 && w3 >= 0) setPixel(px, x, y, r, g, b);
    }
  }
}
function drawSkyAndWater(px, horizon = 136) {
  for (let y = 0; y < SIZE; y++) {
    const sky = y < horizon;
    const t = sky ? y / horizon : (y - horizon) / (SIZE - horizon);
    const r = sky ? 135 + t * 55 : 42 - t * 14;
    const g = sky ? 185 + t * 35 : 122 - t * 28;
    const b = sky ? 225 + t * 15 : 162 - t * 22;
    for (let x = 0; x < SIZE; x++) setPixel(px, x, y, r, g, b);
  }
  for (let row = 0; row < 7; row++) {
    const y = horizon + 14 + row * 16;
    for (let x = (row % 2) * 18; x < SIZE; x += 42) {
      fillRect(px, x, y, 22, 2, 120, 185, 212);
    }
  }
}

function genDock() {
  const px = createPixels();
  drawSkyAndWater(px, 128);
  // Wooden dock shack + pitched roof
  fillRect(px, 140, 74, 88, 62, 152, 108, 76);
  fillTri(px, 132, 76, 184, 44, 236, 76, 110, 68, 48);
  fillRect(px, 162, 92, 18, 18, 245, 215, 130);
  // Timber pier & pilings
  fillRect(px, 22, 132, 216, 14, 138, 98, 64);
  for (let x = 32; x < 230; x += 36) fillRect(px, x, 142, 10, 44, 92, 64, 42);
  // Fishing boat moored
  fillRect(px, 34, 166, 86, 22, 198, 68, 52);
  fillRect(px, 58, 148, 32, 18, 240, 242, 244);
  return px;
}

function genMarina() {
  const px = createPixels();
  drawSkyAndWater(px, 124);
  // Yacht club building
  fillRect(px, 150, 82, 90, 44, 238, 242, 245);
  fillRect(px, 146, 76, 98, 8, 2, 136, 209);
  // Floating pontoon
  fillRect(px, 16, 152, 224, 9, 216, 220, 224);
  // Two sailboats with white sails
  for (const [bx, sc] of [[44, 1], [116, 0.85]]) {
    fillRect(px, bx - 4, 62, 4, 92, 180, 186, 192);
    fillTri(px, bx + 2, 64, bx + 2, 142, bx + 42 * sc, 142, 250, 252, 255);
    fillTri(px, bx - 4, 74, bx - 4, 140, bx - 28 * sc, 140, 235, 244, 252);
    fillRect(px, bx - 28, 146, 70, 14, 245, 248, 250);
    fillRect(px, bx - 26, 156, 66, 4, 2, 136, 209);
  }
  return px;
}

function genFerry() {
  const px = createPixels();
  drawSkyAndWater(px, 130);
  // Ferry terminal concourse + teal wave roof + clock tower
  fillRect(px, 132, 82, 108, 52, 226, 234, 238);
  fillRect(px, 126, 74, 118, 10, 0, 137, 123);
  fillRect(px, 198, 46, 26, 32, 232, 238, 240);
  fillRect(px, 205, 54, 12, 12, 255, 244, 196);
  // Passenger ferry in foreground
  fillRect(px, 20, 156, 124, 24, 38, 70, 83);
  fillRect(px, 28, 136, 104, 20, 245, 248, 250);
  fillRect(px, 42, 120, 68, 16, 245, 248, 250);
  fillRect(px, 34, 142, 92, 6, 42, 157, 143);
  return px;
}

function genPort() {
  const px = createPixels();
  drawSkyAndWater(px, 138);
  // Concrete quay
  fillRect(px, 0, 136, SIZE, 18, 156, 162, 168);
  // Two red/orange gantry cranes
  for (const cx of [64, 156]) {
    fillRect(px, cx, 42, 8, 96, 216, 67, 21);
    fillRect(px, cx + 28, 42, 8, 96, 216, 67, 21);
    fillRect(px, cx - 28, 46, 86, 10, 216, 67, 21);
  }
  // Stacked containers + cargo ship hull
  fillRect(px, 186, 106, 52, 16, 21, 101, 192);
  fillRect(px, 186, 122, 52, 15, 198, 40, 40);
  fillRect(px, 18, 170, 164, 28, 55, 71, 79);
  fillRect(px, 18, 194, 164, 8, 183, 28, 28);
  fillRect(px, 36, 154, 42, 16, 46, 125, 50);
  fillRect(px, 82, 154, 42, 16, 239, 108, 0);
  fillRect(px, 138, 142, 32, 28, 242, 245, 247);
  return px;
}

for (const [name, fn] of [
  ['dock_facade', genDock],
  ['marina_facade', genMarina],
  ['ferry_terminal_facade', genFerry],
  ['cargo_port_facade', genPort],
]) {
  writeFileSync(`${OUT}/${name}.png`, encodePNG(SIZE, SIZE, fn()));
  console.log(`Generated ${OUT}/${name}.png`);
}

/**
 * Minimal, zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, EC Level M, Versions 1–10).
 */

interface VersionSpec {
  version: number;
  dataBytes: number;
  ecBytesPerBlock: number;
  group1Blocks: number;
  group1DataBytes: number;
  group2Blocks: number;
  group2DataBytes: number;
  alignmentCenters: number[];
}

// Error Correction Level M specifications for Versions 1–10 (ISO/IEC 18004 Table 9).
const VERSION_SPECS: VersionSpec[] = [
  { version: 1, dataBytes: 16, ecBytesPerBlock: 10, group1Blocks: 1, group1DataBytes: 16, group2Blocks: 0, group2DataBytes: 0, alignmentCenters: [] },
  { version: 2, dataBytes: 28, ecBytesPerBlock: 16, group1Blocks: 1, group1DataBytes: 28, group2Blocks: 0, group2DataBytes: 0, alignmentCenters: [6, 18] },
  { version: 3, dataBytes: 44, ecBytesPerBlock: 26, group1Blocks: 1, group1DataBytes: 44, group2Blocks: 0, group2DataBytes: 0, alignmentCenters: [6, 22] },
  { version: 4, dataBytes: 64, ecBytesPerBlock: 18, group1Blocks: 2, group1DataBytes: 32, group2Blocks: 0, group2DataBytes: 0, alignmentCenters: [6, 26] },
  { version: 5, dataBytes: 86, ecBytesPerBlock: 24, group1Blocks: 2, group1DataBytes: 43, group2Blocks: 0, group2DataBytes: 0, alignmentCenters: [6, 30] },
  { version: 6, dataBytes: 108, ecBytesPerBlock: 16, group1Blocks: 4, group1DataBytes: 27, group2Blocks: 0, group2DataBytes: 0, alignmentCenters: [6, 34] },
  { version: 7, dataBytes: 124, ecBytesPerBlock: 18, group1Blocks: 4, group1DataBytes: 31, group2Blocks: 0, group2DataBytes: 0, alignmentCenters: [6, 22, 38] },
  { version: 8, dataBytes: 154, ecBytesPerBlock: 22, group1Blocks: 2, group1DataBytes: 38, group2Blocks: 2, group2DataBytes: 39, alignmentCenters: [6, 24, 42] },
  { version: 9, dataBytes: 182, ecBytesPerBlock: 22, group1Blocks: 3, group1DataBytes: 36, group2Blocks: 2, group2DataBytes: 37, alignmentCenters: [6, 26, 46] },
  { version: 10, dataBytes: 216, ecBytesPerBlock: 26, group1Blocks: 4, group1DataBytes: 43, group2Blocks: 1, group2DataBytes: 44, alignmentCenters: [6, 28, 50] },
];

// GF(256) exp/log tables with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeRemainder(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.copyWithin(0, 1);
    res[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecCount; j++) {
        res[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return res;
}

function pickVersion(byteLength: number): VersionSpec {
  for (const spec of VERSION_SPECS) {
    const countBits = spec.version <= 9 ? 8 : 16;
    const totalBitsNeeded = 4 + countBits + byteLength * 8;
    if (totalBitsNeeded <= spec.dataBytes * 8) {
      return spec;
    }
  }
  throw new Error(`QR payload too long (${byteLength} bytes; max supported is 213 bytes)`);
}

function encodeDataCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  // Mode indicator: Byte (0100)
  pushBits(0b0100, 4);
  // Character count indicator
  pushBits(bytes.length, spec.version <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = spec.dataBytes * 8;
  const terminatorLen = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < terminatorLen; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
    out[i >> 3] = byte;
  }

  let padIdx = bits.length >> 3;
  let toggle = true;
  while (padIdx < spec.dataBytes) {
    out[padIdx++] = toggle ? 0xec : 0x11;
    toggle = !toggle;
  }
  return out;
}

function interleaveBlocks(data: Uint8Array, spec: VersionSpec): Uint8Array {
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < spec.group1Blocks; i++) {
    const block = data.slice(offset, offset + spec.group1DataBytes);
    offset += spec.group1DataBytes;
    dataBlocks.push(block);
    ecBlocks.push(rsComputeRemainder(block, spec.ecBytesPerBlock));
  }
  for (let i = 0; i < spec.group2Blocks; i++) {
    const block = data.slice(offset, offset + spec.group2DataBytes);
    offset += spec.group2DataBytes;
    dataBlocks.push(block);
    ecBlocks.push(rsComputeRemainder(block, spec.ecBytesPerBlock));
  }

  const maxDataLen = Math.max(spec.group1DataBytes, spec.group2DataBytes);
  const totalBytes = spec.dataBytes + (spec.group1Blocks + spec.group2Blocks) * spec.ecBytesPerBlock;
  const result = new Uint8Array(totalBytes);
  let idx = 0;

  for (let col = 0; col < maxDataLen; col++) {
    for (const block of dataBlocks) {
      if (col < block.length) result[idx++] = block[col];
    }
  }
  for (let col = 0; col < spec.ecBytesPerBlock; col++) {
    for (const ec of ecBlocks) {
      result[idx++] = ec[col];
    }
  }
  return result;
}

function bchFormatInfo(mask: number): number {
  // EC Level M = 00 (2 bits) + 3-bit mask
  const data = (0b00 << 3) | mask;
  let d = data << 10;
  const gen = 0x537;
  for (let i = 14; i >= 10; i--) {
    if ((d >>> i) & 1) d ^= gen << (i - 10);
  }
  return ((data << 10) | d) ^ 0x5412;
}

function bchVersionInfo(version: number): number {
  let d = version << 12;
  const gen = 0x1f25;
  for (let i = 17; i >= 12; i--) {
    if ((d >>> i) & 1) d ^= gen << (i - 12);
  }
  return (version << 12) | d;
}

function buildBaseMatrix(spec: VersionSpec): { size: number; modules: Int8Array; isFunction: Uint8Array } {
  const size = spec.version * 4 + 17;
  const modules = new Int8Array(size * size);
  const isFunction = new Uint8Array(size * size);

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r * size + c] = dark ? 1 : 0;
    isFunction[r * size + c] = 1;
  };

  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r, c, inOuter && (onBorder || inInner));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setFunc(6, i, dark);
    setFunc(i, 6, dark);
  }

  // Alignment patterns
  const centers = spec.alignmentCenters;
  for (const cr of centers) {
    for (const cc of centers) {
      // Skip corners occupied by finder patterns
      if ((cr === 6 && cc === 6) || (cr === 6 && cc === size - 7) || (cr === size - 7 && cc === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(cr + dr, cc + dc, dark);
        }
      }
    }
  }

  // Dark module
  setFunc(4 * spec.version + 9, 8, true);

  // Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    setFunc(8, size - 1 - i, false);
    if (i < 7) setFunc(size - 1 - i, 8, false);
  }

  // Version info for versions >= 7
  if (spec.version >= 7) {
    const vInfo = bchVersionInfo(spec.version);
    for (let i = 0; i < 18; i++) {
      const bit = Boolean((vInfo >>> i) & 1);
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setFunc(r, c, bit);
      setFunc(c, r, bit);
    }
  }

  return { size, modules, isFunction };
}

function placeDataBits(size: number, modules: Int8Array, isFunction: Uint8Array, codewords: Uint8Array): void {
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // Skip vertical timing column
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        const pos = r * size + c;
        if (isFunction[pos]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (codewords[bitIdx >> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        modules[pos] = bit;
      }
    }
    upward = !upward;
  }
}

function applyMaskAndFormat(
  size: number,
  baseModules: Int8Array,
  isFunction: Uint8Array,
  mask: number,
): Int8Array {
  const out = new Int8Array(baseModules);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const pos = r * size + c;
      if (isFunction[pos]) continue;
      let invert = false;
      switch (mask) {
        case 0: invert = (r + c) % 2 === 0; break;
        case 1: invert = r % 2 === 0; break;
        case 2: invert = c % 3 === 0; break;
        case 3: invert = (r + c) % 3 === 0; break;
        case 4: invert = (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; break;
        case 5: invert = ((r * c) % 2) + ((r * c) % 3) === 0; break;
        case 6: invert = (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; break;
        case 7: invert = (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; break;
      }
      if (invert) out[pos] ^= 1;
    }
  }

  const fmt = bchFormatInfo(mask);
  for (let i = 0; i < 15; i++) {
    const bit = (fmt >>> i) & 1;
    // Horizontal
    if (i < 8) out[8 * size + (size - 1 - i)] = bit;
    else if (i === 8) out[8 * size + 7] = bit;
    else out[8 * size + (14 - i)] = bit;
    // Vertical
    if (i < 6) out[i * size + 8] = bit;
    else if (i < 8) out[(i + 1) * size + 8] = bit;
    else out[(size - 15 + i) * size + 8] = bit;
  }

  return out;
}

function evaluatePenalty(size: number, m: Int8Array): number {
  let penalty = 0;

  // Rule 1: 5+ consecutive same-color modules in row or column
  for (let r = 0; r < size; r++) {
    let runColor = -1;
    let runLen = 0;
    for (let c = 0; c < size; c++) {
      const v = m[r * size + c];
      if (v === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = v;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = -1;
    let runLen = 0;
    for (let r = 0; r < size; r++) {
      const v = m[r * size + c];
      if (v === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = v;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r * size + c];
      if (
        v === m[r * size + c + 1] &&
        v === m[(r + 1) * size + c] &&
        v === m[(r + 1) * size + c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with 4 light modules on either side
  const isPattern = (arr: number[]): boolean => {
    // 1,0,1,1,1,0,1,0,0,0,0 or 0,0,0,0,1,0,1,1,1,0,1
    const a = arr[0] === 1 && arr[1] === 0 && arr[2] === 1 && arr[3] === 1 && arr[4] === 1 &&
      arr[5] === 0 && arr[6] === 1 && arr[7] === 0 && arr[8] === 0 && arr[9] === 0 && arr[10] === 0;
    const b = arr[0] === 0 && arr[1] === 0 && arr[2] === 0 && arr[3] === 0 && arr[4] === 1 &&
      arr[5] === 0 && arr[6] === 1 && arr[7] === 1 && arr[8] === 1 && arr[9] === 0 && arr[10] === 1;
    return a || b;
  };
  const buf = new Array<number>(11);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      for (let k = 0; k < 11; k++) buf[k] = m[r * size + c + k];
      if (isPattern(buf)) penalty += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      for (let k = 0; k < 11; k++) buf[k] = m[(r + k) * size + c];
      if (isPattern(buf)) penalty += 40;
    }
  }

  // Rule 4: dark module ratio deviation from 50%
  let darkCount = 0;
  for (let i = 0; i < m.length; i++) darkCount += m[i];
  const percent = (darkCount * 100) / m.length;
  const prev5 = Math.floor(percent / 5) * 5;
  const next5 = Math.ceil(percent / 5) * 5;
  penalty += Math.min(Math.abs(prev5 - 50) / 5, Math.abs(next5 - 50) / 5) * 10;

  return penalty;
}

export interface QrMatrix {
  size: number;
  modules: Int8Array;
}

/** Encode a UTF-8 string into a QR code matrix (EC Level M). */
export function encodeQrMatrix(text: string): QrMatrix {
  const bytes = new TextEncoder().encode(text);
  const spec = pickVersion(bytes.length);
  const dataCodewords = encodeDataCodewords(bytes, spec);
  const allCodewords = interleaveBlocks(dataCodewords, spec);
  const { size, modules, isFunction } = buildBaseMatrix(spec);
  placeDataBits(size, modules, isFunction, allCodewords);

  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = modules;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMaskAndFormat(size, modules, isFunction, mask);
    const penalty = evaluatePenalty(size, candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = candidate;
    }
  }
  void bestMask;
  return { size, modules: bestModules };
}

/** Render a QR code matrix as a crisp SVG string with a 4-module quiet zone. */
export function renderQrSvg(text: string): string {
  const { size, modules } = encodeQrMatrix(text);
  const quiet = 4;
  const total = size + quiet * 2;
  let pathData = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r * size + c]) {
        pathData += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code for world invite link"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${pathData}" fill="#111111"/></svg>`;
}

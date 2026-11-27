import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeQrMatrix, renderQrSvg } from '../src/ui/qrCode.ts';

function assertFinderPattern(modules: Int8Array, size: number, top: number, left: number): void {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const expected = onBorder || inInner ? 1 : 0;
      assert.equal(
        modules[(top + r) * size + (left + c)],
        expected,
        `Finder mismatch at (${top + r}, ${left + c})`,
      );
    }
  }
}

test('encodeQrMatrix produces valid finder, timing, and dark modules for invite URL', () => {
  const url = 'https://cityzen.example.com/?world=earth-1234abcd';
  const { size, modules } = encodeQrMatrix(url);

  // 49 bytes fits in Version 3 (29x29) or Version 4 (33x33) at EC-M
  assert.equal(size, 33);
  assert.equal(modules.length, size * size);

  assertFinderPattern(modules, size, 0, 0);
  assertFinderPattern(modules, size, 0, size - 7);
  assertFinderPattern(modules, size, size - 7, 0);

  // Timing patterns on row 6 and col 6
  for (let i = 8; i < size - 8; i++) {
    const expected = i % 2 === 0 ? 1 : 0;
    assert.equal(modules[6 * size + i], expected);
    assert.equal(modules[i * size + 6], expected);
  }

  // Dark module at (4*V + 9, 8) -> V=4 => (25, 8)
  assert.equal(modules[25 * size + 8], 1);
});

test('encodeQrMatrix supports Version 7+ URLs with version info', () => {
  const longUrl = `https://cityzen.example.com/CityZen/?world=${'a'.repeat(110)}`;
  const { size, modules } = encodeQrMatrix(longUrl);
  assert.ok(size >= 45, `Expected version 7+ matrix (>=45), got ${size}`);
  assertFinderPattern(modules, size, 0, 0);
  assertFinderPattern(modules, size, 0, size - 7);
  assertFinderPattern(modules, size, size - 7, 0);
});

test('encodeQrMatrix throws on payloads exceeding max capacity', () => {
  assert.throws(() => encodeQrMatrix('x'.repeat(220)), /too long/);
});

test('renderQrSvg outputs crisp SVG with 4-module quiet zone', () => {
  const url = 'https://example.com/?world=test';
  const { size } = encodeQrMatrix(url);
  const svg = renderQrSvg(url);
  const expectedTotal = size + 8;
  assert.match(svg, new RegExp(`viewBox="0 0 ${expectedTotal} ${expectedTotal}"`));
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#ffffff"\/>/);
  assert.match(svg, /<path d="M[^"]+" fill="#111111"\/>/);
});

// Checks Xomoni's mark (#322, ADR-0035), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`: every icon in
// the repository is drawn by apps/extension/scripts/icon.mjs and was regenerated after the drawing last changed, at
// the sizes the manifest names; the drawing uses Xomoni's own blue and still shows two steps at 16 pixels; and no
// interface draws a platform's mark in place of its name.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { FADED, TILE, WHITE, iconPng, markColor } from '../apps/extension/scripts/icon.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'apps/extension/public/manifest.json'), 'utf8'));

/** A PNG written by icon.mjs (RGBA, unfiltered rows), decoded: its size and a pixel reader. */
function decode(bytes) {
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  assert.equal(bytes[25], 6, 'RGBA');
  const chunks = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.subarray(at + 4, at + 8).toString('latin1') === 'IDAT')
      chunks.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const pixel = (x, y) => {
    const row = y * (width * 4 + 1);
    assert.equal(raw[row], 0, 'icon.mjs writes unfiltered rows');
    const i = row + 1 + x * 4;
    return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]];
  };
  return { width, height, pixel };
}

/** Every icon in the repository, with the options icon.mjs draws it with. */
const ICONS = [
  ...[16, 32, 48, 128].map((size) => ({ file: `apps/extension/public/icons/icon${size}.png`, size })),
  { file: 'apps/web/src/app/icon.png', size: 128 },
  { file: 'apps/web/public/logo.png', size: 128 },
  { file: 'apps/web/src/app/apple-icon.png', size: 128, options: { rounded: false } },
  { file: 'docs/store/icon-128.png', size: 128, options: { padding: 16 } },
  { file: 'docs/store/edge-logo-300.png', size: 300, options: { padding: 38 } },
];

describe('the icons are drawn by icon.mjs (#322)', () => {
  for (const { file, size, options } of ICONS)
    it(`${file} matches the drawing`, () => {
      const committed = decode(readFileSync(join(ROOT, file)));
      const drawn = decode(iconPng(size, options));
      assert.deepEqual([committed.width, committed.height], [size, size]);
      // A channel may differ by one or two where another Node rounds a sine differently; a stale icon differs by far more.
      let worst = 0;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const a = committed.pixel(x, y);
          const b = drawn.pixel(x, y);
          for (let c = 0; c < 4; c++) worst = Math.max(worst, Math.abs(a[c] - b[c]));
        }
      assert.ok(
        worst <= 2,
        `${file} differs from icon.mjs by up to ${worst}: run npm run icons and npm run store:images -w @xomoni/extension`,
      );
    });

  it('gives the manifest an icon of each size it names, for the toolbar and the extensions page', () => {
    const named = { ...MANIFEST.icons, ...MANIFEST.action.default_icon };
    assert.deepEqual(Object.keys(MANIFEST.icons).sort(), ['128', '16', '32', '48']);
    for (const [size, path] of Object.entries(named)) {
      const icon = decode(readFileSync(join(ROOT, 'apps/extension/public', path)));
      assert.deepEqual([icon.width, icon.height], [Number(size), Number(size)], path);
    }
  });

  it('draws the same bytes every run', () => {
    assert.deepEqual(iconPng(48), iconPng(48));
    assert.deepEqual(iconPng(128, { padding: 16 }), iconPng(128, { padding: 16 }));
  });
});

describe('the mark (#322, ADR-0035)', () => {
  it('is a tile of Xomoni’s own blue, the brand ramp’s shades 90 and 70', () => {
    const theme = readFileSync(join(ROOT, 'packages/fluent-theme/src/index.ts'), 'utf8');
    const hex = (rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
    assert.match(theme, new RegExp(`\\b90: '${hex(TILE.light)}'`));
    assert.match(theme, new RegExp(`\\b70: '${hex(TILE.dark)}'`));
    // The old icon's near-black tile (#0f172a, like X's own) is gone: the tile is blue at every point.
    for (const [u, v] of [
      [0.5, 0.05],
      [0.05, 0.5],
      [0.95, 0.5],
      [0.5, 0.95],
    ]) {
      const [r, g, b] = markColor(u, v);
      assert.ok(b > r + 80 && b > g + 30, `${u},${v} is blue`);
    }
  });

  it('draws the newer step white and the older one fading into the tile, not gone', () => {
    // The middle of each print's sole.
    assert.deepEqual(markColor(0.665, 0.31), WHITE);
    const older = markColor(0.385, 0.57);
    const along = (0.385 + 0.57) / 2;
    const tile = TILE.light.map((c, i) => c + (TILE.dark[i] - c) * along);
    older.forEach((c, i) => assert.ok(Math.abs(c - (tile[i] + (255 - tile[i]) * FADED)) < 1e-9, `channel ${i}`));
    assert.ok(FADED > 0.25 && FADED < 0.6, 'visible, and clearly behind the newer step');
  });

  it('keeps the tile’s rounded corners transparent, but fills them for Apple’s touch icon', () => {
    assert.equal(markColor(0.01, 0.01), null);
    assert.notEqual(markColor(0.01, 0.01, { rounded: false }), null);
    assert.equal(markColor(-0.01, 0.5), null);
    assert.equal(markColor(0.5, 1.01, { rounded: false }), null);
    const apple = decode(iconPng(128, { rounded: false }));
    assert.equal(apple.pixel(0, 0)[3], 255);
    assert.equal(decode(iconPng(128)).pixel(0, 0)[3], 0);
  });

  it('still shows two steps at 16 pixels: a white one at the top right and a paler one at the bottom left', () => {
    const icon = decode(readFileSync(join(ROOT, 'apps/extension/public/icons/icon16.png')));
    const lightest = (x0, y0) => {
      let best = 0;
      for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) best = Math.max(best, icon.pixel(x, y)[0]);
      return best;
    };
    const tileRed = Math.max(TILE.light[0], TILE.dark[0]);
    assert.ok(lightest(8, 0) >= 235, `top right: ${lightest(8, 0)}`);
    assert.ok(lightest(0, 8) > tileRed + 40 && lightest(0, 8) < 210, `bottom left: ${lightest(0, 8)}`);
    // Nothing in the other two quadrants' corners: the mark is a diagonal of steps, not a cross.
    assert.ok(icon.pixel(3, 3)[0] < tileRed + 20, 'top left is tile');
    assert.ok(icon.pixel(12, 12)[0] < tileRed + 20, 'bottom right is tile');
  });
});

/** Every file under `dir` (repository-relative) whose name `pattern` accepts, skipping builds and dependencies. */
function sources(dir, pattern, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (['node_modules', 'dist', '.next', 'coverage'].includes(name)) continue;
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) sources(path, pattern, out);
    else if (pattern(name)) out.push(path);
  }
  return out;
}

describe('no platform’s mark in Xomoni’s interfaces (ADR-0035)', () => {
  it('never writes X as a logo-like letter, the double-struck 𝕏 or the bold 𝐗: X is named in words', () => {
    // Tests may name the glyphs, to check they are absent.
    const shipped = (pattern) => (name) => pattern.test(name) && !/\.test\.tsx?$/.test(name);
    const glyphs = /\u{1D54F}|\u{1D417}/u;
    const files = [
      ...sources('apps/extension/src', shipped(/\.(ts|tsx|css|html)$/)),
      ...sources('apps/web/src', shipped(/\.(ts|tsx|css)$/)),
      'apps/extension/dashboard.html',
      'apps/extension/public/manifest.json',
    ];
    assert.ok(files.length > 50);
    const found = files.filter((file) => glyphs.test(readFileSync(join(ROOT, file), 'utf8')));
    assert.deepEqual(found, []);
  });
});

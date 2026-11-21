// The Xomoni mark (#322, ADR-0035): two shoe prints walking up a tile of Xomoni's blue, the newer one white and the
// older one fading. A footprint being tidied, which is what Xomoni does: on X today, in other places later. It is no
// platform's mark and holds no letter.
//
// Drawn here as a PNG without any image dependencies, so every size comes from the same drawing: `make-icons.mjs`
// renders the extension's icons and the website's, and `store-images.mjs` the stores'. `tooling/icons.test.mjs` checks
// that each committed PNG still matches this drawing.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** An RGBA PNG of `size` × `size`, with unfiltered rows (`tooling/store-listing.test.mjs` reads them back). */
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Xomoni's blue at shades 90 and 70 (`XOMONI_BRAND`, packages/fluent-theme): the tile, lighter at its top left. */
export const TILE = { light: [0x43, 0x87, 0xdb], dark: [0x1e, 0x58, 0x9f] };

/** The newer print's color. */
export const WHITE = [255, 255, 255];

/** How much white the older print keeps over the tile: fading, not gone, so it still shows at 16 pixels. */
export const FADED = 0.42;

/** The tile's corner radius, as a share of its side (the old icon's, so the toolbar keeps its shape). */
const RADIUS = 0.22;

/** The prints lean this many degrees clockwise: walking up and to the right, never upright like an exclamation mark. */
const TILT = 24;

/** A print's size, as a share of the tile: the pair spans about 0.57 × 0.68 of it, centered. */
const SCALE = 0.25;

/** The two steps: the newer, the right foot, ahead and white; the older, the left foot, behind and fading. */
const STEPS = [
  { x: 0.64, y: 0.36, side: 1, white: 1 },
  { x: 0.36, y: 0.62, side: -1, white: FADED },
];

const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

/** A polynomial smooth minimum: joins two shapes with a rounded waist instead of a corner. */
const smoothMin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

/** About the distance from (x, y) to an ellipse's edge, negative inside. */
const ellipse = (x, y, cx, cy, rx, ry) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);

/**
 * A shoe print in its own units, toes toward −y, as a signed distance (negative inside): a sole, from the ball of the
 * foot to a narrow waist, and a separate D-shaped heel with a flat front. `side` mirrors it: 1 the right foot, −1 the
 * left.
 */
function shoePrint(x, y, side) {
  const sx = x * side;
  const sole = smoothMin(ellipse(sx, y, 0.04, -0.4, 0.38, 0.46), ellipse(sx, y, -0.03, 0.1, 0.27, 0.34), 0.3);
  const heel = Math.max(ellipse(sx, y, -0.02, 0.66, 0.33, 0.26), 0.52 - y);
  return Math.min(sole, heel);
}

/** Whether (u, v) falls inside a rounded square of corner radius `r` filling the unit square. */
function inTile(u, v, r) {
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  return Math.hypot(qx, qy) <= r;
}

/**
 * The mark's color at (u, v) in the unit square (x right, y down, 0 to 1), or null where it is transparent. The tile
 * is a gradient of Xomoni's blue; a print mixes white into it, wholly for the newer step and `FADED` for the older, so
 * the older print stays the tile's hue at every size. `rounded: false` fills the square to its corners, for an app
 * icon that the system rounds itself (Apple's touch icon).
 */
export function markColor(u, v, { rounded = true } = {}) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  if (rounded && !inTile(u, v, RADIUS)) return null;
  const tile = mix(TILE.light, TILE.dark, (u + v) / 2);
  const angle = (-TILT * Math.PI) / 180;
  for (const step of STEPS) {
    const dx = u - step.x;
    const dy = v - step.y;
    const x = dx * Math.cos(angle) - dy * Math.sin(angle);
    const y = dx * Math.sin(angle) + dy * Math.cos(angle);
    if (shoePrint(x / SCALE, y / SCALE, step.side) <= 0) return mix(tile, WHITE, step.white);
  }
  return tile;
}

/** Samples per pixel along each side: 8 × 8, enough for smooth edges at 16 pixels. */
const SUPERSAMPLE = 8;

/**
 * The icon as a PNG of `size` × `size` pixels, with `padding` transparent pixels on every side around the artwork (the
 * Chrome Web Store asks for 96 × 96 artwork inside a 128 × 128 icon). Each pixel averages 8 × 8 samples of
 * `markColor`, so the same drawing gives every size, and the same bytes every run.
 */
export function iconPng(size, { padding = 0, rounded = true } = {}) {
  const art = size - 2 * padding;
  const n = SUPERSAMPLE;
  return png(size, (x, y) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let hits = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const c = markColor((x - padding + (i + 0.5) / n) / art, (y - padding + (j + 0.5) / n) / art, { rounded });
        if (!c) continue;
        r += c[0];
        g += c[1];
        b += c[2];
        hits++;
      }
    if (!hits) return [0, 0, 0, 0];
    return [Math.round(r / hits), Math.round(g / hits), Math.round(b / hits), Math.round((255 * hits) / (n * n))];
  });
}

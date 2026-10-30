// Renders the extension icons as PNGs without any image dependencies.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

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

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = y * (size * 4 + 1) + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
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

const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// Unit-space shape: rounded square, a white stroke and a shorter blue stroke
// that stops short — an "X" being erased.
function sample(u, v) {
  const r = 0.22;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
  const qy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
  if (Math.hypot(qx, qy) > r) return null;
  if (segDist(u, v, 0.3, 0.28, 0.7, 0.72) < 0.075) return [255, 255, 255];
  if (segDist(u, v, 0.7, 0.28, 0.54, 0.46) < 0.075) return [96, 165, 250];
  if (Math.hypot(u - 0.36, v - 0.66) < 0.05) return [96, 165, 250];
  return [15, 23, 42];
}

for (const size of [16, 32, 48, 128]) {
  const ss = 4;
  const buf = png(size, (x, y) => {
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let i = 0; i < ss; i++)
      for (let j = 0; j < ss; j++) {
        const c = sample((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
        if (c) {
          r += c[0];
          g += c[1];
          b += c[2];
          n++;
        }
      }
    return n ? [r / n, g / n, b / n, Math.round((255 * n) / (ss * ss))] : [0, 0, 0, 0];
  });
  writeFileSync(`public/icons/icon${size}.png`, buf);
}
console.log('icons written');

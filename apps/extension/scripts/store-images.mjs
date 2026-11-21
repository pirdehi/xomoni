// Makes the images the Chrome Web Store and Microsoft Edge Add-ons listings need (docs/STORE-LISTING.md, #301):
//
//   npm run store:images -w @xomoni/extension [-- --port 4791] [-- --out <folder>] [-- --site <folder>]
//
// - the store icon (128 × 128, artwork 96 × 96 with 16 transparent pixels around it) and Edge's logo (300 × 300),
//   drawn by icon.mjs like the extension's own icons;
// - five screenshots of the dashboard at 1280 × 800, from the UI preview with its demo data (src/dev/preview.ts):
//   a made-up account, never anyone's real data;
// - the small promo tile (440 × 280);
// - and, into apps/web/public/screens (or --site), the two pictures of Home on xomoni.com's home page, light and
//   dark, at 1440 × 1000, from the same preview: they show the sidebar's logo, so they change with the icon (#322).
//
// It starts Vite's dev server for the preview on 127.0.0.1 (port 4791 unless --port says otherwise, never 3000, which
// the website uses) and drives Playwright's Chromium, headless. Nothing reaches X or xomoni.com: the preview stubs the
// extension's APIs and the dashboard's CSP is not involved. Needs Playwright's Chromium once:
// `npx playwright install chromium`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { iconPng } from './icon.mjs';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4791' },
    out: { type: 'string', default: resolve(EXT, '../../docs/store') },
    site: { type: 'string', default: resolve(EXT, '../web/public/screens') },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000)
  throw new Error(`--port must be a free port from 1024 to 65535, and not 3000 (the website's): got ${values.port}`);
const out = resolve(values.out);
const site = resolve(values.site);
mkdirSync(out, { recursive: true });
mkdirSync(site, { recursive: true });

/** The dashboard pages shown: the stores' five, in the listing's order, then the website's two. */
const SHOTS = [
  { file: join(out, 'screenshot-1-overview.png'), page: 'overview', theme: 'light' },
  { file: join(out, 'screenshot-2-cleanup.png'), page: 'cleanup', theme: 'light' },
  { file: join(out, 'screenshot-3-library.png'), page: 'library', theme: 'light' },
  { file: join(out, 'screenshot-4-activity.png'), page: 'jobs', theme: 'light' },
  { file: join(out, 'screenshot-5-settings-dark.png'), page: 'settings', theme: 'dark' },
  { file: join(site, 'overview.png'), page: 'overview', theme: 'light', width: 1440, height: 1000 },
  { file: join(site, 'overview-dark.png'), page: 'overview', theme: 'dark', width: 1440, height: 1000 },
];

// The icons need no browser.
writeFileSync(join(out, 'icon-128.png'), iconPng(128, { padding: 16 }));
writeFileSync(join(out, 'edge-logo-300.png'), iconPng(300, { padding: 38 }));

const server = await createServer({
  configFile: join(EXT, 'vite.config.ts'),
  root: EXT,
  logLevel: 'warn',
  server: { host: '127.0.0.1', port, strictPort: true, open: false },
});
await server.listen();
const browser = await chromium.launch();
try {
  for (const shot of SHOTS) {
    // A fresh context each time: an empty IndexedDB, which the preview fills with its demo account.
    const context = await browser.newContext({
      viewport: { width: shot.width ?? 1280, height: shot.height ?? 800 },
      deviceScaleFactor: 1,
      colorScheme: shot.theme,
      reducedMotion: 'reduce',
    });
    // The same demo data every run: the preview draws its dates and likes with Math.random.
    await context.addInitScript(() => {
      let seed = 301;
      Math.random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    const page = await context.newPage();
    page.on('pageerror', (err) => console.warn(`[${shot.page}] page error: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.warn(`[${shot.page}] console: ${msg.text()}`);
    });
    await page.goto(`http://127.0.0.1:${port}/preview.html#/${shot.page}`);
    await page.locator('#root nav').first().waitFor();
    await page.waitForLoadState('networkidle');
    // Let live queries, charts and fonts settle.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot.file });
    await context.close();
    console.log(relative(resolve(EXT, '../..'), shot.file));
  }

  const tile = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await tile.setContent(promoTile(iconPng(256).toString('base64')));
  await tile.screenshot({ path: join(out, 'promo-small-440x280.png') });
  console.log('promo-small-440x280.png');
} finally {
  await browser.close();
  await server.close();
}
console.log(`Store images written to ${out}, the website's to ${site}`);

/**
 * The small promo tile: the mark, the name and what Xomoni is, on the page color of Xomoni's light theme
 * (packages/fluent-theme), where the blue tile stands out as it does in a light toolbar.
 */
function promoTile(iconBase64) {
  return `<!doctype html>
<html><head><style>
  html, body { margin: 0; width: 440px; height: 280px; }
  body {
    display: flex; align-items: center; gap: 26px; padding: 0 34px; box-sizing: border-box;
    background: linear-gradient(135deg, #fcfcfb 0%, #f4f4f1 55%, #ecf2f9 100%); color: #0b0b0b;
    font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  img { width: 112px; height: 112px; flex: none; }
  h1 { margin: 0 0 6px; font-size: 42px; font-weight: 700; letter-spacing: -0.6px; }
  .what { margin: 0 0 10px; font-size: 20px; font-weight: 600; line-height: 1.25; color: #1e589f; }
  .how { margin: 0; font-size: 15px; line-height: 1.35; color: #52514e; }
</style></head>
<body>
  <img src="data:image/png;base64,${iconBase64}" alt="">
  <div>
    <h1>Xomoni</h1>
    <p class="what">Digital footprint manager</p>
    <p class="how">Starting with X: review and remove your old posts and likes.</p>
  </div>
</body></html>`;
}

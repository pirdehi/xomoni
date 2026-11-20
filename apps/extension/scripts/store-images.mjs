// Makes the images the Chrome Web Store and Microsoft Edge Add-ons listings need (docs/STORE-LISTING.md, #301):
//
//   npm run store:images -w @xomoni/extension [-- --port 4791] [-- --out <folder>]
//
// - the store icon (128 × 128, artwork 96 × 96 with 16 transparent pixels around it) and Edge's logo (300 × 300),
//   drawn by icon.mjs like the extension's own icons;
// - five screenshots of the dashboard at 1280 × 800, from the UI preview with its demo data (src/dev/preview.ts):
//   a made-up account, never anyone's real data;
// - the small promo tile (440 × 280).
//
// It starts Vite's dev server for the preview on 127.0.0.1 (port 4791 unless --port says otherwise, never 3000, which
// the website uses) and drives Playwright's Chromium, headless. Nothing reaches X or xomoni.com: the preview stubs the
// extension's APIs and the dashboard's CSP is not involved. Needs Playwright's Chromium once:
// `npx playwright install chromium`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3000)
  throw new Error(`--port must be a free port from 1024 to 65535, and not 3000 (the website's): got ${values.port}`);
const out = resolve(values.out);
mkdirSync(out, { recursive: true });

/** The dashboard pages shown, in the listing's order, with what each screenshot is for. */
const SHOTS = [
  { file: 'screenshot-1-overview.png', page: 'overview', theme: 'light' },
  { file: 'screenshot-2-cleanup.png', page: 'cleanup', theme: 'light' },
  { file: 'screenshot-3-library.png', page: 'library', theme: 'light' },
  { file: 'screenshot-4-activity.png', page: 'jobs', theme: 'light' },
  { file: 'screenshot-5-settings-dark.png', page: 'settings', theme: 'dark' },
];

// The icons need no browser.
writeFileSync(join(out, 'icon-128.png'), iconPng(128, 16));
writeFileSync(join(out, 'edge-logo-300.png'), iconPng(300, 38));

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
      viewport: { width: 1280, height: 800 },
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
    await page.screenshot({ path: join(out, shot.file) });
    await context.close();
    console.log(`${shot.file}`);
  }

  const tile = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
  await tile.setContent(promoTile(iconPng(128).toString('base64')));
  await tile.screenshot({ path: join(out, 'promo-small-440x280.png') });
  console.log('promo-small-440x280.png');
} finally {
  await browser.close();
  await server.close();
}
console.log(`Store images written to ${out}`);

/** The small promo tile: the icon, the name and one line on Xomoni's brand blue (packages/fluent-theme). */
function promoTile(iconBase64) {
  return `<!doctype html>
<html><head><style>
  html, body { margin: 0; width: 440px; height: 280px; }
  body {
    display: flex; align-items: center; gap: 24px; padding: 0 36px; box-sizing: border-box;
    background: linear-gradient(135deg, #2a78d6 0%, #184781 100%); color: #ffffff;
    font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  img { width: 96px; height: 96px; flex: none; }
  h1 { margin: 0 0 10px; font-size: 40px; font-weight: 700; letter-spacing: -0.5px; }
  p { margin: 0; font-size: 18px; line-height: 1.35; color: #dce7f4; }
</style></head>
<body>
  <img src="data:image/png;base64,${iconBase64}" alt="">
  <div><h1>Xomoni</h1><p>Clean up your own X account, slowly and safely, on your computer.</p></div>
</body></html>`;
}

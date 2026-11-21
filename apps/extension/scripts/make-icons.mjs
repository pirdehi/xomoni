// Renders the icons from the drawing in icon.mjs (`npm run icons -w @xomoni/extension`): the extension's, and the
// website's favicon, Apple touch icon and header logo, so xomoni.com always shows the same mark as the extension.
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconPng } from './icon.mjs';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = resolve(EXT, '../web');

for (const size of [16, 32, 48, 128]) writeFileSync(resolve(EXT, `public/icons/icon${size}.png`), iconPng(size));

// The favicon and the logo in the site's header and in Supabase's emails keep the rounded tile.
writeFileSync(resolve(WEB, 'src/app/icon.png'), iconPng(128));
writeFileSync(resolve(WEB, 'public/logo.png'), iconPng(128));
// Apple rounds a touch icon itself and shows a transparent corner as black, so this one fills its square.
writeFileSync(resolve(WEB, 'src/app/apple-icon.png'), iconPng(128, { rounded: false }));
console.log('icons written');

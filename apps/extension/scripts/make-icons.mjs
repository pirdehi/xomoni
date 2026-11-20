// Renders the extension icons as PNGs (`npm run icons`), from the drawing in icon.mjs.
import { writeFileSync } from 'node:fs';
import { iconPng } from './icon.mjs';

for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon${size}.png`, iconPng(size));
console.log('icons written');

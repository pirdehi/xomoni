// Fails when xomoni.com's browser bundle holds a server secret (#421, ADR-0042): the name of Supabase's service-role
// key or Polar's keys, or their values when this process has them. Run after `npm run build -w @xomoni/web` (CI's
// `verify` job does).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuild, secretsIn } from './browser-bundle-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = join(ROOT, 'apps/web/.next/static');

if (!existsSync(STATIC)) {
  console.error('No website build at apps/web/.next/static: run `npm run build -w @xomoni/web` first.');
  process.exit(2);
}
const files = readBuild(STATIC, ROOT);
const found = secretsIn(files, process.env);
if (found.length) {
  console.error(`Server secrets in the browser bundle (${found.length}):`);
  for (const line of found) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`Browser bundle check passed: ${files.length} files, no server secret in any.`);

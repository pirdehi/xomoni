// Checks apps/web/vercel.json (#331): Vercel skips a build only when nothing the website is built from changed, so
// pushes that touch only the extension, docs or tooling don't spend the plan's daily deployments, and every change the
// site depends on still deploys. Run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(ROOT, 'apps/web/vercel.json'), 'utf8'));
const web = JSON.parse(readFileSync(join(ROOT, 'apps/web/package.json'), 'utf8'));
const tsconfig = readFileSync(join(ROOT, 'apps/web/tsconfig.json'), 'utf8');

/** The paths after `--` in the ignore command, relative to apps/web (Vercel's Root Directory). */
function watched() {
  const command = config.ignoreCommand;
  assert.match(command, /^git diff --quiet HEAD\^ HEAD -- /, 'exit 0 (skip) only when the diff is empty');
  return command.split(' -- ')[1].trim().split(/\s+/);
}

describe('Vercel builds the website only when it changed (#331)', () => {
  it('watches the app itself, the shared packages, the lockfile and the base tsconfig', () => {
    const paths = watched();
    for (const path of ['.', '../../packages', '../../package.json', '../../package-lock.json'])
      assert.ok(paths.includes(path), path);
  });

  it('watches every workspace package the website depends on', () => {
    const own = Object.keys(web.dependencies ?? {}).filter((name) => name.startsWith('@xomoni/'));
    assert.ok(own.length > 0);
    // All of them live under packages/, which is watched as a whole.
    assert.ok(watched().includes('../../packages'));
  });

  it('watches what apps/web/tsconfig.json extends', () => {
    const extended = /"extends":\s*"([^"]+)"/.exec(tsconfig)?.[1];
    assert.ok(extended, 'apps/web/tsconfig.json extends a base config');
    assert.ok(watched().includes(extended), extended);
  });
});

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SERVER_SECRETS, browserFiles, readBuild, secretsIn } from './browser-bundle-lib.mjs';

describe('server secrets in the browser bundle (#421)', () => {
  it('covers Supabase’s service-role key and Polar’s two keys', () => {
    assert.deepEqual(SERVER_SECRETS, ['SUPABASE_SERVICE_ROLE_KEY', 'POLAR_ACCESS_TOKEN', 'POLAR_WEBHOOK_SECRET']);
  });

  it('finds a secret’s name in a script, without echoing any value', () => {
    const files = [
      { path: 'a.js', text: 'const k = process.env.SUPABASE_SERVICE_ROLE_KEY;' },
      { path: 'b.js', text: 'console.log("ok")' },
    ];
    assert.deepEqual(secretsIn(files), ['a.js: SUPABASE_SERVICE_ROLE_KEY']);
  });

  it('finds a secret’s value when the build had it, and names only the variable', () => {
    const env = { POLAR_ACCESS_TOKEN: 'polar_oat_abcdef123456', POLAR_WEBHOOK_SECRET: 'short' };
    const files = [{ path: 'c.js', text: 'fetch(u,{headers:{a:"Bearer polar_oat_abcdef123456"}})' }];
    assert.deepEqual(secretsIn(files, env), ['c.js: the value of POLAR_ACCESS_TOKEN']);
    // A value too short to tell from ordinary code is not looked for.
    assert.deepEqual(secretsIn([{ path: 'd.js', text: 'short' }], env), []);
  });

  it('passes a bundle with only public settings', () => {
    const files = [{ path: 'e.js', text: 'NEXT_PUBLIC_SUPABASE_URL sb_publishable_x' }];
    assert.deepEqual(secretsIn(files, { SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_0123456789' }), []);
  });

  it('reads the scripts, styles and maps of a build, and nothing else', () => {
    const root = mkdtempSync(join(tmpdir(), 'bundle-'));
    mkdirSync(join(root, 'chunks'));
    writeFileSync(join(root, 'chunks', 'one.js'), 'POLAR_WEBHOOK_SECRET');
    writeFileSync(join(root, 'two.css'), 'body{}');
    writeFileSync(join(root, 'three.map'), '{}');
    writeFileSync(join(root, 'notes.txt'), 'POLAR_ACCESS_TOKEN');
    assert.equal(browserFiles(root).length, 3);
    assert.deepEqual(browserFiles(join(root, 'missing')), []);
    const files = readBuild(root, root);
    assert.deepEqual(secretsIn(files), ['chunks/one.js: POLAR_WEBHOOK_SECRET']);
  });
});

// Checks on the GitHub workflows (#142), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, verify, webcrypto } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '.github/workflows');
const workflows = readdirSync(DIR)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));

/** The lines of `text` from `start` up to the next line indented at most as much (one YAML block). */
function block(text, start) {
  const lines = text.split('\n');
  const from = lines.findIndex((line) => line.trimEnd() === start);
  assert.ok(from >= 0, `no "${start.trim()}" block`);
  const indent = start.length - start.trimStart().length;
  const end = lines.findIndex((line, i) => i > from && line.trim() && line.length - line.trimStart().length <= indent);
  return lines.slice(from, end < 0 ? undefined : end).join('\n');
}

describe('GitHub workflows (#142)', () => {
  it('pin every action by its full commit SHA, with the version beside it', () => {
    for (const { name, text } of workflows) {
      for (const [, action] of text.matchAll(/uses:\s*(\S+)/g)) {
        assert.match(action, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name}: ${action}`);
      }
      for (const line of text.split('\n').filter((l) => /uses:\s*\S+@[0-9a-f]{40}/.test(l))) {
        assert.match(line, /# v\d/, `${name}: the version comment is missing on "${line.trim()}"`);
      }
    }
  });

  it('never leave the checkout token behind for npm scripts', () => {
    for (const { name, text } of workflows) {
      const checkouts = text.split('\n').filter((line) => line.includes('actions/checkout@')).length;
      const kept = (text.match(/persist-credentials: false/g) ?? []).length;
      assert.equal(kept, checkouts, `${name}: every checkout sets persist-credentials: false`);
    }
  });

  it('give no workflow write access by default, and the release build none at all', () => {
    for (const { name, text } of workflows) {
      assert.match(text, /^permissions:( \{\}|\n {2}contents: read$)/m, `${name}: top-level permissions`);
    }
    const release = workflows.find((w) => w.name === 'release.yml').text;
    const build = block(release, '  build:');
    const publish = block(release, '  publish:');
    assert.match(build, /permissions:\n\s+contents: read\n/);
    assert.doesNotMatch(build, /write/);
    // The job that can write runs no npm code: it only downloads, attests and publishes.
    assert.doesNotMatch(publish, /npm |node |actions\/checkout/);
    assert.match(publish, /attest-build-provenance@/);
    assert.match(build, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  });
});

/** The `run: |` script of the step named `name`, without its indentation. */
function stepScript(text, name) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `no step "${name}"`);
  const stepIndent = lines[at].indexOf('-');
  const run = lines.findIndex((line, i) => i > at && line.trim() === 'run: |');
  assert.ok(run > at, `step "${name}" has no run block`);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && line.length - line.trimStart().length <= stepIndent + 2) break;
    body.push(line);
  }
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return body.map((line) => line.slice(indent)).join('\n');
}

const SIGN_STEP = 'Sign the zips for one-click updates (Ed25519)';
const openssl = spawnSync('openssl', ['version'], { encoding: 'utf8' });
// `pkeyutl -rawin` for Ed25519 needs OpenSSL 3, as on GitHub's runners; macOS's own LibreSSL lacks it.
const OPENSSL_3 = openssl.status === 0 && /^OpenSSL 3\./.test(openssl.stdout);

/** A throwaway Ed25519 key pair, made for one test: the PEM the secret holds, and the public key as the extension keeps it. */
function throwawayKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey,
    raw: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
  };
}

/** Runs the publish job's signing step on two zips, as the runner would, and returns what it left. */
function runSigning({ secret, trusted }) {
  const dir = mkdtempSync(join(tmpdir(), 'xomoni-sign-'));
  const runnerTemp = mkdtempSync(join(tmpdir(), 'xomoni-runner-'));
  mkdirSync(join(dir, 'release'));
  const zip = Buffer.from('PK\x03\x04 a release, as bytes');
  for (const name of ['xomoni-extension.zip', 'xomoni-extension-0.5.0.zip'])
    writeFileSync(join(dir, 'release', name), zip);
  writeFileSync(join(dir, 'release/release-keys'), trusted.map((key) => `${key}\n`).join(''));
  const script = stepScript(workflows.find((w) => w.name === 'release.yml').text, SIGN_STEP);
  const env = { PATH: process.env.PATH, RUNNER_TEMP: runnerTemp, ...(secret ? { RELEASE_SIGNING_KEY: secret } : {}) };
  const result = spawnSync('bash', ['-c', script], { cwd: dir, env, encoding: 'utf8' });
  const cleanup = () => [dir, runnerTemp].forEach((path) => rmSync(path, { recursive: true, force: true }));
  return { dir, runnerTemp, zip, status: result.status, output: `${result.stdout}${result.stderr}`, cleanup };
}

describe('release signing for one-click updates (#305)', () => {
  const release = workflows.find((w) => w.name === 'release.yml').text;
  const build = block(release, '  build:');
  const publish = block(release, '  publish:');

  it('signs in the publish job only, with a secret only its signing step sees, in an environment for tags', () => {
    assert.match(publish, /^ {4}environment: release$/m);
    assert.equal((release.match(/secrets\./g) ?? []).length, 1, 'one secret, used once');
    assert.match(publish, /^ {10}RELEASE_SIGNING_KEY: \$\{\{ secrets\.RELEASE_SIGNING_KEY \}\}$/m);
    assert.doesNotMatch(build, /secrets\.|RELEASE_SIGNING_KEY/);
    assert.ok(publish.indexOf(SIGN_STEP) < publish.indexOf('Create the release'), 'signed before the release exists');
    assert.match(publish, /files=\(release\/\*\.zip release\/\*\.zip\.sig release\/SHA256SUMS\)/);
  });

  it('builds the release without running any dependency’s install script', () => {
    assert.match(build, /^ {6}- run: npm ci --ignore-scripts$/m);
    assert.doesNotMatch(build, /^ {6}- run: npm ci$/m);
  });

  it('never prints the key, and removes the file it writes', () => {
    const script = stepScript(release, SIGN_STEP);
    assert.match(script, /^set -euo pipefail$/m);
    assert.doesNotMatch(script, /set -x|cat "\$key"|(echo|printf)[^\n]*\$\{?RELEASE_SIGNING_KEY[^>\n]*$/m);
    // The one use of the key's value writes it to a file only the job's user can read.
    assert.match(script, /printf '%s\\n' "\$RELEASE_SIGNING_KEY" > "\$key"/);
    assert.match(script, /umask 077/);
    assert.match(script, /trap 'rm -f "\$key" "\$public"' EXIT/);
  });

  it('signs each zip with Ed25519, as the extension checks it', { skip: !OPENSSL_3 && 'needs OpenSSL 3' }, async () => {
    const key = throwawayKey();
    const run = runSigning({ secret: key.pem, trusted: [throwawayKey().raw, key.raw] });
    try {
      assert.equal(run.status, 0, run.output);
      assert.doesNotMatch(run.output, /PRIVATE KEY/);
      assert.deepEqual(readdirSync(run.runnerTemp), [], 'the key file is gone');
      for (const name of ['xomoni-extension.zip', 'xomoni-extension-0.5.0.zip']) {
        const signature = readFileSync(join(run.dir, 'release', `${name}.sig`));
        assert.equal(signature.length, 64);
        assert.ok(verify(null, run.zip, key.publicKey, signature), `${name}: Node's crypto`);
        // The extension's own check: Web Crypto's Ed25519 with the raw key from release-keys.json.
        const raw = Buffer.from(key.raw, 'base64');
        const imported = await webcrypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
        assert.ok(await webcrypto.subtle.verify({ name: 'Ed25519' }, imported, signature, run.zip), name);
        const tampered = Buffer.from(run.zip);
        tampered[5] ^= 1;
        assert.equal(await webcrypto.subtle.verify({ name: 'Ed25519' }, imported, signature, tampered), false);
      }
    } finally {
      run.cleanup();
    }
  });

  it('releases unsigned, with a warning, while the extension trusts no key, even with the secret set', () => {
    for (const secret of ['', throwawayKey().pem]) {
      const run = runSigning({ secret, trusted: [] });
      try {
        assert.equal(run.status, 0, run.output);
        assert.match(run.output, /::warning::Not signed: .*trusts no signing key yet/);
        assert.deepEqual(
          readdirSync(join(run.dir, 'release')).filter((name) => name.endsWith('.sig')),
          [],
        );
        assert.deepEqual(readdirSync(run.runnerTemp), [], 'no key file written');
      } finally {
        run.cleanup();
      }
    }
  });

  it('refuses to release without the secret once the extension trusts a key', () => {
    const run = runSigning({ secret: '', trusted: [throwawayKey().raw] });
    try {
      assert.notEqual(run.status, 0);
      assert.match(
        run.output,
        /::error::The extension trusts a signing key, but the RELEASE_SIGNING_KEY secret is not set/,
      );
      assert.deepEqual(
        readdirSync(join(run.dir, 'release')).filter((name) => name.endsWith('.sig')),
        [],
      );
    } finally {
      run.cleanup();
    }
  });

  it(
    'refuses a key the extension doesn’t trust, naming the key to add',
    { skip: !OPENSSL_3 && 'needs OpenSSL 3' },
    () => {
      const key = throwawayKey();
      const run = runSigning({ secret: key.pem, trusted: [throwawayKey().raw] });
      try {
        assert.notEqual(run.status, 0);
        assert.match(
          run.output,
          new RegExp(`doesn't trust this signing key\\. Add ${key.raw.replace(/[+/]/g, '\\$&')}`),
        );
        assert.deepEqual(
          readdirSync(join(run.dir, 'release')).filter((name) => name.endsWith('.sig')),
          [],
        );
        assert.deepEqual(readdirSync(run.runnerTemp), [], 'the key file is gone');
      } finally {
        run.cleanup();
      }
    },
  );
});

describe('creating the release (#305)', () => {
  const release = workflows.find((w) => w.name === 'release.yml').text;

  /** Runs the create step with a `gh` that prints its arguments, over these files in release/. */
  function runCreate(names) {
    const dir = mkdtempSync(join(tmpdir(), 'xomoni-create-'));
    mkdirSync(join(dir, 'release'));
    mkdirSync(join(dir, 'bin'));
    for (const name of names) writeFileSync(join(dir, 'release', name), name);
    writeFileSync(join(dir, 'bin/gh'), '#!/bin/sh\nfor arg in "$@"; do echo "$arg"; done\n', { mode: 0o755 });
    const script = stepScript(release, 'Create the release');
    const env = { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, GITHUB_REF_NAME: 'v0.5.0' };
    const result = spawnSync('bash', ['-c', script], { cwd: dir, env, encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, args: result.stdout.trim().split('\n'), output: result.stderr };
  }

  const ZIPS = ['xomoni-extension.zip', 'xomoni-extension-0.5.0.zip'];

  it('attaches the signatures with the zips when the release was signed', () => {
    const run = runCreate([...ZIPS, ...ZIPS.map((zip) => `${zip}.sig`), 'SHA256SUMS']);
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.args.slice(0, 7), [
      'release',
      'create',
      'v0.5.0',
      'release/xomoni-extension-0.5.0.zip',
      'release/xomoni-extension.zip',
      'release/xomoni-extension-0.5.0.zip.sig',
      'release/xomoni-extension.zip.sig',
    ]);
    assert.ok(run.args.includes('release/SHA256SUMS'));
    assert.ok(run.args.includes('--verify-tag'));
  });

  it('attaches only the zips and the checksums when it wasn’t, with no literal pattern left over', () => {
    const run = runCreate([...ZIPS, 'SHA256SUMS']);
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.args.slice(0, 6), [
      'release',
      'create',
      'v0.5.0',
      'release/xomoni-extension-0.5.0.zip',
      'release/xomoni-extension.zip',
      'release/SHA256SUMS',
    ]);
    assert.ok(!run.args.some((arg) => arg.includes('*')));
  });
});

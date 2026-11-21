// Checks on the GitHub workflows (#142, #303, #340, #343), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, verify, webcrypto } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STORE_SECRETS } from './store-api.mjs';

const DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), '.github/workflows');
const workflows = readdirSync(DIR)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));

/** A reusable workflow of this repository, called as `uses: ./.github/workflows/<name>.yml`. */
const LOCAL_WORKFLOW = /^\.\/\.github\/workflows\/([\w-]+\.yml)$/;

/** The lines of `text` from `start` up to the next line indented at most as much (one YAML block). */
function block(text, start) {
  const lines = text.split('\n');
  const from = lines.findIndex((line) => line.trimEnd() === start);
  assert.ok(from >= 0, `no "${start.trim()}" block`);
  const indent = start.length - start.trimStart().length;
  const end = lines.findIndex((line, i) => i > from && line.trim() && line.length - line.trimStart().length <= indent);
  return lines.slice(from, end < 0 ? undefined : end).join('\n');
}

/** Every `run:` script in `text`: the rest of its line, or the block indented below it. */
function runScripts(text) {
  const lines = text.split('\n');
  const scripts = [];
  lines.forEach((line, i) => {
    const match = /^\s*(?:- )?run:\s*(.*)$/.exec(line);
    if (!match) return;
    if (!/^[|>]/.test(match[1])) return scripts.push(match[1]);
    const indent = line.length - line.trimStart().length;
    const end = lines.findIndex((next, j) => j > i && next.trim() && next.length - next.trimStart().length <= indent);
    scripts.push(lines.slice(i + 1, end < 0 ? undefined : end).join('\n'));
  });
  return scripts;
}

describe('GitHub workflows (#142)', () => {
  it('pin every action by its full commit SHA, with the version beside it', () => {
    for (const { name, text } of workflows) {
      for (const [, action] of text.matchAll(/uses:\s*(\S+)/g)) {
        // A workflow of this repository runs from the caller's own commit: there is nothing to pin (#340).
        if (LOCAL_WORKFLOW.test(action)) continue;
        assert.match(action, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name}: ${action}`);
      }
      for (const line of text.split('\n').filter((l) => /uses:\s*\S+@[0-9a-f]{40}/.test(l))) {
        assert.match(line, /# v\d/, `${name}: the version comment is missing on "${line.trim()}"`);
      }
    }
  });

  it("run only GitHub's own actions and supabase/setup-cli, as the repository allows", () => {
    for (const { name, text } of workflows) {
      for (const [, action] of text.matchAll(/uses:\s*([^@\s]+)@/g)) {
        assert.match(action, /^(actions|github)\/|^supabase\/setup-cli$/, `${name}: ${action}`);
      }
    }
  });

  it("call only this repository's own workflows, each made to be called", () => {
    for (const { name, text } of workflows) {
      for (const [, path] of text.matchAll(/uses:\s*(\.\S*)/g)) {
        const called = LOCAL_WORKFLOW.exec(path)?.[1];
        assert.ok(called, `${name}: ${path} is not a workflow in .github/workflows`);
        const target = workflows.find((w) => w.name === called);
        assert.ok(target, `${name}: ${called} doesn't exist`);
        assert.match(block(target.text, 'on:'), /^ {2}workflow_call:/m, `${called} has no workflow_call trigger`);
      }
    }
  });

  it('never paste an expression into a script, where an input could inject commands', () => {
    for (const { name, text } of workflows) {
      for (const script of runScripts(text)) assert.doesNotMatch(script, /\$\{\{/, `${name}: pass it in env instead`);
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

  it('let only the jobs that record a result write to issues', () => {
    // The release's publish job, which comments the release on its issue; the nightly's report; the check after each
    // release's report, and the release job that calls it (#340, #343). Nothing else, however it is written.
    const writers = {
      'release.yml': ['publish', 'after-release'],
      'nightly.yml': ['report'],
      'release-check.yml': ['report'],
    };
    for (const { name, text } of workflows) {
      const jobs = writers[name] ?? [];
      assert.equal([...text.matchAll(/\bissues:\s*write\b/g)].length, jobs.length, `${name}: issues: write`);
      for (const job of jobs) assert.match(block(text, `  ${job}:`), /^ {6}issues: write$/m, `${name}: ${job}`);
      assert.doesNotMatch(text, /write-all/, `${name}: no blanket write`);
    }
  });
});

describe('the release gate (#340, ADR-0037)', () => {
  const release = workflows.find((w) => w.name === 'release.yml').text;
  const ci = workflows.find((w) => w.name === 'ci.yml').text;
  const jobs = {
    ci: block(release, '  ci:'),
    readiness: block(release, '  readiness:'),
    build: block(release, '  build:'),
    publish: block(release, '  publish:'),
  };

  it('runs the full CI on the tagged commit, read-only, before anything is built', () => {
    assert.match(block(ci, 'on:'), /^ {2}workflow_call:$/m);
    assert.equal(
      jobs.ci.trimEnd(),
      [
        '  ci:',
        '    name: ci',
        '    permissions:',
        '      contents: read',
        '    uses: ./.github/workflows/ci.yml',
      ].join('\n'),
      'the ci job calls ci.yml with read-only permissions, and passes it nothing else',
    );
    // ci.yml's jobs are the ones a merge needs, and ask for nothing more than read access.
    for (const job of ['verify', 'database', 'e2e']) assert.match(ci, new RegExp(`\n {2}${job}:\n {4}name: ${job}\n`));
    assert.match(ci, /^permissions:\n {2}contents: read$/m);
    assert.doesNotMatch(ci, /write|secrets\./);
    assert.match(jobs.build, /^ {4}needs: ci$/m);
  });

  it('keeps its own concurrency group apart from the CI it calls, which would otherwise cancel one of them', () => {
    // Called by the release, ci.yml's group is ci-push-<the tag's ref>; called by the nightly, ci-schedule-refs/heads/main.
    // No pull request or push to main shares either, so none cancels the other (#343).
    assert.match(block(ci, 'concurrency:'), /^ {2}group: ci-\$\{\{ github\.event_name \}\}-\$\{\{ github\.ref \}\}$/m);
    for (const { name, text } of workflows.filter((w) => w.name !== 'ci.yml'))
      assert.doesNotMatch(text, /group: ci-/, `${name} takes a group of ci.yml's`);
  });

  it('reads the release issue in a job that can only read', () => {
    assert.match(
      jobs.readiness,
      /\n {4}permissions:\n {6}contents: read\n {6}issues: read\n {4}outputs:\n {6}issue: \$\{\{ steps\.check\.outputs\.issue \}\}\n/,
    );
    assert.doesNotMatch(jobs.readiness, /write|secrets\.|environment:|npm /);
    assert.match(jobs.readiness, /\n {8}id: check\n/);
    assert.match(jobs.readiness, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
    assert.match(jobs.readiness, /^ {8}run: node tooling\/check-release-issue\.mjs "\$GITHUB_REF_NAME"$/m);
  });

  it('publishes only after the build and the readiness check, and the build only after CI', () => {
    assert.match(jobs.publish, /^ {4}needs: \[build, readiness\]$/m);
    assert.match(jobs.build, /^ {4}needs: ci$/m);
    // The build keeps its guarantees: a read-only token, no install scripts, the tag on main.
    assert.match(jobs.build, /permissions:\n {6}contents: read\n {4}env:/);
    assert.match(jobs.build, /^ {6}- run: npm ci --ignore-scripts$/m);
    assert.match(jobs.build, /git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  });

  it('audits every dependency at high in the build, after installing and before anything runs', () => {
    assert.match(jobs.build, /^ {8}run: npm audit --audit-level=high$/m);
    assert.doesNotMatch(release, /--omit|--audit-level=(critical|moderate|low|info)/);
    const install = jobs.build.indexOf('- run: npm ci --ignore-scripts');
    const audit = jobs.build.indexOf('run: npm audit --audit-level=high');
    assert.ok(install < audit && audit < jobs.build.indexOf('run: npm run verify'));
  });

  it('comments the release on its issue and closes it, after the release exists', () => {
    const steps = ['Create the release', 'Comment the release on its issue and close it'];
    assert.ok(jobs.publish.indexOf(steps[0]) < jobs.publish.indexOf(steps[1]));
    assert.match(jobs.publish, /^ {10}ISSUE: \$\{\{ needs\.readiness\.outputs\.issue \}\}$/m);
  });

  it('checks the release as people get it once it is out, and passes that check only what it needs (#343)', () => {
    assert.equal(
      block(release, '  after-release:').trimEnd(),
      [
        '  after-release:',
        '    name: after-release',
        '    needs: publish',
        '    permissions:',
        '      contents: read',
        '      attestations: read',
        '      # Only for its report job, to comment the result on the release issue.',
        '      issues: write',
        '    uses: ./.github/workflows/release-check.yml',
        '    with:',
        '      tag: ${{ github.ref_name }}',
      ].join('\n'),
    );
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
/** The zips a release signs, and the store build's, which it doesn't: nothing in it checks a signature (#303). */
const SIGNED = ['xomoni-extension.zip', 'xomoni-extension-0.5.0.zip'];
const STORE_ZIP = 'xomoni-extension-store-0.5.0.zip';
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
  for (const name of [...SIGNED, STORE_ZIP]) writeFileSync(join(dir, 'release', name), zip);
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

  it('builds, checks and packages the store build after the GitHub zips, and attests every zip (#303)', () => {
    const order = [
      'run: npm run build -w @xomoni/extension',
      'run: node tooling/check-remote-code.mjs',
      'node tooling/release.mjs package\n',
      'run: npm run build:store -w @xomoni/extension',
      'run: node tooling/check-remote-code.mjs',
      'node tooling/release.mjs package-store',
    ];
    let at = 0;
    for (const step of order) {
      const found = build.indexOf(step, at);
      assert.ok(found >= at, `"${step.trim()}" comes after the steps before it`);
      at = found + step.length;
    }
    assert.match(publish, /subject-path: release\/\*\.zip\n/);
  });

  it('builds the release without running any dependency’s install script', () => {
    assert.match(build, /^ {6}- run: npm ci --ignore-scripts$/m);
    assert.doesNotMatch(build, /^ {6}- run: npm ci$/m);
  });

  it('never prints the key, and removes the file it writes', () => {
    const script = stepScript(release, SIGN_STEP);
    assert.match(script, /^set -euo pipefail$/m);
    assert.doesNotMatch(script, /set -x/);
    assert.doesNotMatch(script, /cat "\$key"/);
    // Printing the key's value, unless the line sends it into a file (`> "$key"`).
    assert.doesNotMatch(script, /(?:echo|printf)[^\n]*\$\{?RELEASE_SIGNING_KEY[^>\n]*$/m);
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
      assert.deepEqual(
        readdirSync(join(run.dir, 'release'))
          .filter((name) => name.endsWith('.sig'))
          .sort(),
        SIGNED.map((name) => `${name}.sig`).sort(),
        'the store build is not signed',
      );
      for (const name of SIGNED) {
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
        assert.ok(run.output.includes(`doesn't trust this signing key. Add ${key.raw}`), run.output);
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
  const STORE = 'xomoni-extension-store-0.5.0.zip';

  it('attaches the signatures with the zips when the release was signed', () => {
    const run = runCreate([...ZIPS, STORE, ...ZIPS.map((zip) => `${zip}.sig`), 'SHA256SUMS']);
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.args.slice(0, 8), [
      'release',
      'create',
      'v0.5.0',
      'release/xomoni-extension-0.5.0.zip',
      'release/xomoni-extension-store-0.5.0.zip',
      'release/xomoni-extension.zip',
      'release/xomoni-extension-0.5.0.zip.sig',
      'release/xomoni-extension.zip.sig',
    ]);
    assert.ok(run.args.includes('release/SHA256SUMS'));
    assert.ok(run.args.includes('--verify-tag'));
  });

  it('attaches only the zips and the checksums when it wasn’t, with no literal pattern left over', () => {
    const run = runCreate([...ZIPS, STORE, 'SHA256SUMS']);
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.args.slice(0, 7), [
      'release',
      'create',
      'v0.5.0',
      'release/xomoni-extension-0.5.0.zip',
      'release/xomoni-extension-store-0.5.0.zip',
      'release/xomoni-extension.zip',
      'release/SHA256SUMS',
    ]);
    assert.ok(!run.args.some((arg) => arg.includes('*')));
  });
});

describe('recording the release on its issue (#340)', () => {
  const release = workflows.find((w) => w.name === 'release.yml').text;
  const STEP = 'Comment the release on its issue and close it';
  const RELEASE_URL = 'https://github.com/pirdehi/xomoni/releases/tag/v0.5.0';

  /** Runs the step with a `gh` that logs the arguments of each call and answers `release view`. */
  function runRecord(issue) {
    const dir = mkdtempSync(join(tmpdir(), 'xomoni-record-'));
    mkdirSync(join(dir, 'bin'));
    const log = join(dir, 'gh.log');
    writeFileSync(
      join(dir, 'bin/gh'),
      `#!/bin/bash\nprintf '%s\\x1f' "$@" >> "${log}"\nprintf '\\x1e' >> "${log}"\n` +
        `[ "$1 $2" = "release view" ] && echo "${RELEASE_URL}"\nexit 0\n`,
      { mode: 0o755 },
    );
    const env = {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      ISSUE: issue,
      GITHUB_REF_NAME: 'v0.5.0',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'pirdehi/xomoni',
      GITHUB_RUN_ID: '123456',
    };
    const result = spawnSync('bash', ['-c', stepScript(release, STEP)], { cwd: dir, env, encoding: 'utf8' });
    let calls = [];
    try {
      calls = readFileSync(log, 'utf8')
        .split('\x1e')
        .slice(0, -1)
        .map((call) => call.split('\x1f').slice(0, -1));
    } catch {
      // No call was made.
    }
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, calls, output: `${result.stdout}${result.stderr}` };
  }

  it('comments the release and the run on the issue, then closes it', () => {
    const run = runRecord('42');
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(
      run.calls.map((args) => args.slice(0, 3)),
      [
        ['release', 'view', 'v0.5.0'],
        ['issue', 'comment', '42'],
        ['issue', 'close', '42'],
      ],
    );
    const body = run.calls[1][run.calls[1].indexOf('--body') + 1];
    assert.ok(body.includes(`Released v0.5.0: ${RELEASE_URL}`), body);
    assert.ok(body.includes('Workflow run: https://github.com/pirdehi/xomoni/actions/runs/123456'), body);
    assert.deepEqual(run.calls[2].slice(3), ['--reason', 'completed']);
  });

  it('touches no issue when the readiness job named none, or named something that is no issue number', () => {
    for (const issue of ['', '0', '12abc', '1; gh repo delete', '$(id)', '-1']) {
      const run = runRecord(issue);
      assert.notEqual(run.status, 0, `"${issue}"`);
      assert.match(run.output, /::error::The readiness job named no release issue/);
      assert.deepEqual(run.calls, [], `"${issue}": no gh call`);
    }
  });
});

describe('store workflow (#303)', () => {
  const store = workflows.find((w) => w.name === 'store.yml').text;
  const jobs = {
    release: block(store, '  release:'),
    chrome: block(store, '  chrome:'),
    edge: block(store, '  edge:'),
  };

  it('runs only by hand, from main, for a release tag', () => {
    assert.match(block(store, 'on:'), /^on:\n {2}workflow_dispatch:\n/);
    assert.doesNotMatch(block(store, 'on:'), /push|pull_request|schedule|workflow_run/);
    assert.match(jobs.release, /\[\[ "\$GITHUB_REF" == refs\/heads\/main \]\]/);
    assert.match(jobs.release, /\[\[ "\$TAG" =~ \^v\[0-9\]\+/);
    for (const job of ['chrome', 'edge']) assert.match(jobs[job], /needs: release\n/);
  });

  it("sends the release's own store build, checked against SHA256SUMS and its provenance, and never builds one", () => {
    assert.doesNotMatch(store, /\bnpm |release\.mjs|npm run build/);
    assert.match(
      jobs.release,
      /gh release download "\$TAG" .*\n.*--pattern "xomoni-extension-store-\$\{TAG#v\}\.zip" --pattern SHA256SUMS/,
    );
    assert.match(jobs.release, /sha256sum --check --strict --ignore-missing SHA256SUMS/);
    assert.match(jobs.release, /gh attestation verify "release\/xomoni-extension-store-\$\{TAG#v\}\.zip"/);
    // Never the GitHub zip, which has the one-click updater (ADR-0033).
    assert.doesNotMatch(store, /xomoni-extension-\$\{TAG#v\}|xomoni-extension\.zip/);
    assert.match(jobs.release, /--signer-workflow "\$GITHUB_REPOSITORY\/\.github\/workflows\/release\.yml"/);
    assert.match(jobs.release, /--source-ref "refs\/tags\/\$TAG"/);
    for (const job of ['chrome', 'edge']) {
      assert.match(jobs[job], /sha256sum --check --strict --ignore-missing SHA256SUMS/);
      assert.match(jobs[job], new RegExp(`run: node tooling/store\\.mjs "\\$ACTION" ${job} "\\$TAG"`));
    }
  });

  it('keeps the store keys in the stores environment, each job with only its own store', () => {
    // The job that downloads and checks the release sees no secret and needs no approval.
    assert.doesNotMatch(jobs.release, /secrets\.|environment:/);
    assert.match(jobs.release, /permissions:\n {6}contents: read\n {6}attestations: read\n {4}steps:/);
    for (const job of ['chrome', 'edge']) {
      assert.match(jobs[job], /\n {4}environment: stores\n/);
      assert.match(jobs[job], /permissions:\n {6}contents: read\n {4}steps:/, `${job}: read-only, nothing else`);
      assert.doesNotMatch(jobs[job], /github\.token|GH_TOKEN/);
      const used = [...jobs[job].matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
      assert.deepEqual(used, STORE_SECRETS[job]);
      // Every key is read from secrets, under its own name: none is written in the workflow.
      for (const name of STORE_SECRETS[job])
        assert.match(jobs[job], new RegExp(`\n {10}${name}: \\$\\{\\{ secrets\\.${name} \\}\\}\n`));
    }
    const everywhere = [...store.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]).sort();
    assert.deepEqual(everywhere, Object.values(STORE_SECRETS).flat().sort());
  });
});

describe('pull request policy workflow (#339)', () => {
  const policy = workflows.find((w) => w.name === 'pr-policy.yml').text;
  const ci = workflows.find((w) => w.name === 'ci.yml').text;
  const jobs = { policy: block(policy, '  pr-policy:'), review: block(policy, '  dependency-review:') };

  it('runs on every pull request, again when its description or labels change', () => {
    const on = block(policy, 'on:');
    assert.match(on.trimEnd(), /^on:\n {2}pull_request:\n {4}types: \[[^\]]+\]$/);
    const types = /types: \[([^\]]+)\]/
      .exec(on)[1]
      .split(',')
      .map((type) => type.trim());
    for (const type of ['opened', 'edited', 'synchronize', 'reopened', 'labeled', 'unlabeled'])
      assert.ok(types.includes(type), type);
    // pull_request_target would run with a write token on a fork's code.
    assert.doesNotMatch(policy, /pull_request_target|workflow_run|^ {2}push:/m);
    // No concurrency group: two events at once (a PR opened with a label) would leave a cancelled required check,
    // which blocks the merge even though the other run passed (#363).
    assert.doesNotMatch(policy, /^concurrency:/m);
  });

  it('reads only, and sees no secret', () => {
    assert.match(policy, /^permissions:\n {2}contents: read\n/m);
    assert.doesNotMatch(policy, /: write\b|secrets\.|github\.token|GH_TOKEN/);
    // Only the top-level permissions: no job asks for more.
    assert.equal((policy.match(/permissions:/g) ?? []).length, 1);
  });

  it('names the two jobs as the ruleset will require them', () => {
    assert.match(jobs.policy, /^ {4}name: pr-policy$/m);
    assert.match(jobs.review, /^ {4}name: dependency-review$/m);
  });

  it('checks the policy from the event file, with the whole history and no dependency installed', () => {
    assert.deepEqual(runScripts(jobs.policy), ['node tooling/check-pr.mjs']);
    assert.match(jobs.policy, /fetch-depth: 0\n/);
    assert.doesNotMatch(jobs.policy, /npm |cache:/);
    // The description and title are the author's text: they reach the script only through the event file.
    assert.doesNotMatch(policy, /github\.event\.pull_request\.(?:body|title|head\.ref)|github\.head_ref/);
    for (const action of ['actions/checkout', 'actions/setup-node']) {
      const pin = new RegExp(`uses: ${action}@[0-9a-f]{40} # v\\d+`);
      assert.equal(pin.exec(jobs.policy)?.[0], pin.exec(ci)?.[0], `${action}: the same pin as ci.yml`);
    }
  });

  it('fails on a new dependency with a high or critical vulnerability, without commenting', () => {
    assert.match(jobs.review, /uses: actions\/dependency-review-action@[0-9a-f]{40} # v\d/);
    assert.match(jobs.review, /^ {10}fail-on-severity: high$/m);
    assert.match(jobs.review, /^ {10}comment-summary-in-pr: never$/m);
    assert.doesNotMatch(jobs.review, /actions\/checkout|run:/);
  });
});

/** The permissions a job's block grants, one `name: level` each, without comments. */
function grants(job) {
  const lines = job.split('\n');
  const at = lines.findIndex((line) => line === '    permissions:');
  assert.ok(at >= 0, 'the job sets its permissions');
  const granted = [];
  for (const line of lines.slice(at + 1)) {
    if (!line.startsWith('      ')) break;
    if (!line.trim().startsWith('#')) granted.push(line.trim());
  }
  return granted;
}

describe('the nightly run (#343, R18 of docs/QUALITY-GATES.md)', () => {
  const nightly = workflows.find((w) => w.name === 'nightly.yml').text;
  const jobs = { ci: block(nightly, '  ci:'), audit: block(nightly, '  audit:'), report: block(nightly, '  report:') };

  it('runs every night at the time the docs give, and by hand, never for a push or a pull request', () => {
    const on = block(nightly, 'on:');
    const cron = /^ {4}- cron: '(\d{1,2}) (\d{1,2}) \* \* \*'$/m.exec(on);
    assert.ok(cron, 'one daily schedule');
    const [minute, hour] = [Number(cron[1]), Number(cron[2])];
    assert.ok(minute > 0 && minute < 60 && hour < 24, 'off the hour, when GitHub delays scheduled runs the most');
    assert.match(on, /^ {2}schedule:$/m);
    assert.match(on, /^ {2}workflow_dispatch:$/m);
    assert.doesNotMatch(on, /push|pull_request|workflow_run|workflow_call|release/);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`;
    for (const doc of ['docs/QUALITY-GATES.md', 'docs/RELEASING.md'])
      assert.ok(readFileSync(join(DIR, '../..', doc), 'utf8').includes(time), `${doc} gives the time, ${time}`);
  });

  it('runs the full CI read-only, and audits every dependency without installing one', () => {
    assert.equal(
      jobs.ci.trimEnd(),
      [
        '  ci:',
        '    name: ci',
        '    permissions:',
        '      contents: read',
        '    uses: ./.github/workflows/ci.yml',
      ].join('\n'),
      'the ci job calls ci.yml with read-only permissions, and passes it nothing else',
    );
    assert.deepEqual(grants(jobs.audit), ['contents: read']);
    assert.deepEqual(runScripts(jobs.audit), ['npm audit --audit-level=high']);
    assert.doesNotMatch(jobs.audit, /npm ci|npm install|cache:|secrets\./);
  });

  it('reports in a job that can write only to issues, runs no npm code, and reads every job it reports', () => {
    assert.match(jobs.report, /^ {4}needs: \[ci, audit\]$/m);
    // After a red night too, but not when a person cancels the run.
    assert.match(jobs.report, /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
    assert.deepEqual(grants(jobs.report), ['contents: read', 'issues: write']);
    assert.deepEqual(runScripts(jobs.report), [
      'node tooling/nightly-report.mjs "ci=$CI_RESULT" "audit=$AUDIT_RESULT"',
    ]);
    assert.match(jobs.report, /^ {10}CI_RESULT: \$\{\{ needs\.ci\.result \}\}$/m);
    assert.match(jobs.report, /^ {10}AUDIT_RESULT: \$\{\{ needs\.audit\.result \}\}$/m);
    assert.match(jobs.report, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
    assert.match(jobs.report, /^ {10}sparse-checkout: tooling$/m);
    assert.doesNotMatch(jobs.report, /npm |cache:|secrets\./);
  });

  it('reads only by default, sees no secret, and runs one night at a time', () => {
    assert.match(nightly, /^permissions: \{\}$/m);
    assert.doesNotMatch(nightly, /secrets\./);
    assert.equal(
      block(nightly, 'concurrency:').trimEnd(),
      'concurrency:\n  group: nightly\n  cancel-in-progress: false',
    );
  });
});

describe('the check after each release (#343, R18 of docs/QUALITY-GATES.md)', () => {
  const check = workflows.find((w) => w.name === 'release-check.yml').text;
  const jobs = { check: block(check, '  check:'), report: block(check, '  report:') };

  it('runs when release.yml calls it, by hand for a tag, and when a person publishes a release', () => {
    const on = block(check, 'on:');
    assert.match(on, /^ {2}release:\n {4}types: \[published\]$/m);
    for (const trigger of ['workflow_dispatch', 'workflow_call']) {
      const inputs = block(on, `  ${trigger}:`);
      assert.match(inputs, /^ {4}inputs:\n {6}tag:\n/m, trigger);
      assert.match(inputs, /^ {8}required: true$/m, trigger);
      assert.match(inputs, /^ {8}type: string$/m, trigger);
    }
    assert.doesNotMatch(on, /push|pull_request|schedule|workflow_run/);
    // The tag reaches the scripts through the environment only; the script checks that it is vX.Y.Z.
    assert.match(check, /^env:\n {2}TAG: \$\{\{ inputs\.tag \|\| github\.event\.release\.tag_name \}\}$/m);
  });

  it('checks in a job that can only read, and reports in one that can write only to issues', () => {
    assert.match(check, /^permissions: \{\}$/m);
    assert.deepEqual(grants(jobs.check), ['contents: read', 'attestations: read']);
    assert.match(jobs.check, /^ {4}outputs:\n {6}report: \$\{\{ steps\.check\.outputs\.report \}\}$/m);
    assert.match(jobs.check, /^ {8}id: check$/m);
    assert.deepEqual(runScripts(jobs.check), ['node tooling/check-published-release.mjs check "$TAG"']);
    assert.match(jobs.report, /^ {4}needs: check$/m);
    assert.match(jobs.report, /^ {4}if: \$\{\{ !cancelled\(\) \}\}$/m);
    assert.deepEqual(grants(jobs.report), ['contents: read', 'issues: write']);
    assert.deepEqual(runScripts(jobs.report), ['node tooling/check-published-release.mjs report "$TAG"']);
    assert.match(jobs.report, /^ {10}RESULT: \$\{\{ needs\.check\.result \}\}$/m);
    assert.match(jobs.report, /^ {10}REPORT: \$\{\{ needs\.check\.outputs\.report \}\}$/m);
  });

  it('installs nothing, runs no npm code and sees no secret', () => {
    const code = check
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.doesNotMatch(code, /\bnpm\b|cache:|secrets\./);
    for (const job of Object.values(jobs)) {
      assert.match(job, /^ {10}sparse-checkout: tooling$/m);
      assert.match(job, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
    }
  });
});

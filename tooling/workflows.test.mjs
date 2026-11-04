// Checks on the GitHub workflows (#142), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

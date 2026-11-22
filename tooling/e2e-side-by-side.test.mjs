// Checks on the side-by-side browser tests (#404), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RUNS, sideBySide } from './e2e-side-by-side.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A run of Node itself with `script`, as a test's stand-in for a Playwright run. */
const node = (label, script) => ({ label, command: process.execPath, args: ['-e', script] });

/** Collects what sideBySide writes. */
function sink() {
  const lines = [];
  return { lines, write: (text) => lines.push(...text.split('\n').filter(Boolean)) };
}

describe('the browser tests side by side (#404)', () => {
  it('runs both at once: two runs of 800 ms take about 800 ms, not 1,600', async () => {
    const out = sink();
    const started = Date.now();
    const code = await sideBySide(
      [node('a', 'setTimeout(() => {}, 800)'), node('b', 'setTimeout(() => {}, 800)')],
      out,
    );
    assert.equal(code, 0);
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
  });

  it('passes only when both pass', async () => {
    assert.equal(await sideBySide([node('a', ''), node('b', '')], sink()), 0);
    assert.equal(await sideBySide([node('a', 'process.exit(1)'), node('b', '')], sink()), 1);
    assert.equal(await sideBySide([node('a', ''), node('b', 'process.exit(3)')], sink()), 3);
  });

  it('fails when the website fails fast while the extension still runs, and waits for the extension', async () => {
    const out = sink();
    const code = await sideBySide(
      [node('website', 'process.exit(2)'), node('extension', 'setTimeout(() => console.log("last test"), 300)')],
      out,
    );
    assert.equal(code, 2);
    assert.ok(out.lines.includes('extension │ last test'), 'the extension ran to its end');
    assert.deepEqual(out.lines.slice(-2), ['website: failed (exit 2)', 'extension: passed']);
  });

  it('labels every line of both outputs, stderr too, padded to one width, and keeps a last line with no newline', async () => {
    const out = sink();
    await sideBySide(
      [
        node('website', 'console.log("1 passed"); console.error("a warning")'),
        node('extension', 'process.stdout.write("2 passed\\n3 passed")'),
      ],
      out,
    );
    for (const line of [
      'website   │ 1 passed',
      'website   │ a warning',
      'extension │ 2 passed',
      'extension │ 3 passed',
    ])
      assert.ok(out.lines.includes(line), `missing "${line}" in ${JSON.stringify(out.lines)}`);
  });

  it('counts a run killed by a signal, or one that cannot start, as failed', async () => {
    const out = sink();
    assert.equal(await sideBySide([node('a', 'process.kill(process.pid, "SIGKILL")'), node('b', '')], out), 1);
    assert.ok(out.lines.includes('a: failed (exit 1)'));
    const missing = sink();
    assert.equal(
      await sideBySide([{ label: 'gone', command: 'xomoni-no-such-command', args: [] }, node('b', '')], missing),
      1,
    );
    assert.ok(missing.lines.some((line) => line.startsWith('gone │ could not start:')));
  });

  it("runs the website's tests and the extension's, from apps/web", () => {
    assert.deepEqual(
      RUNS.map((run) => [run.command, ...run.args].join(' ')),
      ['npx playwright test', 'npx playwright test -c playwright.extension.config.ts'],
    );
  });

  it('keeps the two runs in folders of their own, so neither empties the other’s', () => {
    const site = readFileSync(join(ROOT, 'apps/web/playwright.config.ts'), 'utf8');
    const extension = readFileSync(join(ROOT, 'apps/web/playwright.extension.config.ts'), 'utf8');
    assert.match(site, /outputDir: 'test-results\/website'/);
    assert.match(site, /outputFolder: 'playwright-report\/website'/);
    assert.match(extension, /outputDir: 'test-results\/extension'/);
    assert.match(extension, /outputFolder: 'playwright-report\/extension'/);
  });

  it('is how e2e and e2e-edge run their browser tests', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    assert.equal(ci.match(/run: node \.\.\/\.\.\/tooling\/e2e-side-by-side\.mjs\n/g)?.length, 2);
    assert.doesNotMatch(ci, /run: npx playwright test/, 'no browser tests run one after the other any more');
  });
});

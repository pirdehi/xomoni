// The on-device scanner never touches X (ADR-0049, #491), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
// Two checks keep its boundary: dependency-cruiser's `ext-scanner-*` rules (`npm run arch`) and ESLint's ban on
// `chrome` and `fetch` in its core (`npm run lint`). These tests prove each one refuses what it must, on the real
// configuration, so a rule that is weakened or loses its match fails here.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { forbidden } = createRequire(import.meta.url)(resolve(ROOT, '.dependency-cruiser.cjs'));

/** The rule named `name`, which must exist. */
function rule(name) {
  const found = forbidden.find((r) => r.name === name);
  assert.ok(found, `${name} is in .dependency-cruiser.cjs`);
  return found;
}

/** A path matches a rule's `path` (a pattern or a list of them), as dependency-cruiser reads it. */
const matches = (pattern, path) => pattern !== undefined && [pattern].flat().some((p) => new RegExp(p).test(path));

/** Whether importing `to` from `from` breaks `r`. */
function breaks(r, from, to) {
  return matches(r.from.path, from) && !matches(r.from.pathNot, from) && matches(r.to.path, to);
}

const EXT = 'apps/extension/src';

describe('the scanner’s dependency rules (ADR-0049)', () => {
  it('refuses an import from the scanner into the engine, page scripts, the UI or the cloud', () => {
    const headless = rule('ext-scanner-is-headless');
    assert.equal(headless.severity, 'error');
    for (const to of ['engine/runner.ts', 'content/actor.ts', 'inject/interceptor.ts', 'ui/App.tsx', 'cloud/report.ts'])
      assert.ok(breaks(headless, `${EXT}/scanner/run.ts`, `${EXT}/${to}`), `scanner/ → ${to} is refused`);
    for (const to of ['shared/db.ts', 'scanner/ports.ts'])
      assert.ok(!breaks(headless, `${EXT}/scanner/run.ts`, `${EXT}/${to}`), `scanner/ → ${to} is allowed`);
  });

  it('keeps the core off the model adapters, which only the composition root and models/ import', () => {
    const ports = rule('ext-scanner-core-uses-ports');
    assert.equal(ports.severity, 'error');
    for (const adapter of ['chrome-ai', 'transformers', 'webllm', 'store']) {
      const to = `${EXT}/scanner/models/${adapter}.ts`;
      assert.ok(breaks(ports, `${EXT}/scanner/run.ts`, to), `the core → models/${adapter}.ts is refused`);
      assert.ok(breaks(ports, `${EXT}/scanner/detectors/model.ts`, to), `a detector → models/${adapter}.ts is refused`);
      assert.ok(!breaks(ports, `${EXT}/scanner/platform.ts`, to), `platform.ts → models/${adapter}.ts is allowed`);
      assert.ok(!breaks(ports, `${EXT}/scanner/models/choose.ts`, to), `models/ → models/${adapter}.ts is allowed`);
    }
    assert.ok(!breaks(ports, `${EXT}/scanner/run.ts`, `${EXT}/scanner/ports.ts`), 'the core → ports.ts is allowed');
  });

  it('leaves the rest of the extension as it was: the engine may not import the scanner either way', () => {
    assert.ok(breaks(rule('ext-engine-is-headless'), `${EXT}/engine/runner.ts`, `${EXT}/scanner/run.ts`));
    assert.ok(breaks(rule('ext-shared-is-the-kernel'), `${EXT}/shared/db.ts`, `${EXT}/scanner/ports.ts`));
  });
});

describe('the scanner’s lint (ADR-0049)', () => {
  const eslint = new ESLint({ cwd: ROOT });

  /** The globals ESLint forbids in `file`, by name. */
  async function forbiddenGlobals(file) {
    const config = await eslint.calculateConfigForFile(resolve(ROOT, file));
    const setting = config.rules?.['no-restricted-globals'];
    if (!Array.isArray(setting) || setting[0] === 0 || setting[0] === 'off') return new Set();
    return new Set(setting.slice(1).map((g) => (typeof g === 'string' ? g : g.name)));
  }

  it('forbids chrome and fetch in the scanner’s core', async () => {
    for (const file of [
      'scanner/run.ts',
      'scanner/worker.ts',
      'scanner/detectors/model.ts',
      'scanner/models/chrome-ai.ts',
    ]) {
      const globals = await forbiddenGlobals(`${EXT}/${file}`);
      assert.ok(globals.has('chrome'), `${file}: chrome is forbidden`);
      assert.ok(globals.has('fetch'), `${file}: fetch is forbidden`);
    }
  });

  it('allows them only in the composition root and the model pack store', async () => {
    for (const file of ['scanner/platform.ts', 'scanner/models/store.ts'])
      assert.ok(!(await forbiddenGlobals(`${EXT}/${file}`)).has('fetch'), `${file}: fetch is allowed`);
  });

  it('refuses a fetch written in the core, as `npm run lint` does', async () => {
    // A file that isn't on disk has no type information, so the type-aware rules are off for this one lint.
    const [result] = await new ESLint({ cwd: ROOT, overrideConfig: tseslint.configs.disableTypeChecked }).lintText(
      'export const pack = () => fetch("https://example.invalid/model.bin");\n',
      { filePath: resolve(ROOT, `${EXT}/scanner/zz-sample.ts`) },
    );
    assert.ok(
      result.messages.some((m) => m.ruleId === 'no-restricted-globals' && /model pack/.test(m.message)),
      result.messages.map((m) => `${m.ruleId}: ${m.message}`).join('\n'),
    );
  });
});

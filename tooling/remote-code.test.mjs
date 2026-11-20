// Tests for tooling/remote-code-lib.mjs (#301), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`. The
// built bundle itself is checked by `npm run remote-code:check`, the step after these tests.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { bundleProblems, manifestProblems, parseCsp, textProblems } from './remote-code-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'apps/extension/public/manifest.json'), 'utf8'));

describe('scripts and pages (#301)', () => {
  it('finds every way to run code from a string or from another site', () => {
    const cases = {
      'eval("x")': 'eval()',
      'window.eval(code)': 'eval()',
      'const f = new Function("a", "return a")': 'new Function()',
      'Function("return this")()': 'Function() called with a string',
      'setTimeout("tick()", 10)': 'setTimeout or setInterval with a string',
      "setInterval('tick()', 10)": 'setTimeout or setInterval with a string',
      "importScripts('lib.js')": 'importScripts()',
      'await import("https://cdn.example.com/m.js")': 'import of a remote URL',
      "import x from '//cdn.example.com/m.js'": 'import of a remote URL',
      'new Worker("https://cdn.example.com/w.js")': 'a Worker from a remote URL',
      "chrome.scripting.executeScript({ target, code: 'x' })": 'executeScript with code',
      'WebAssembly.instantiateStreaming(fetch(url))': 'WebAssembly compiled at run time',
    };
    for (const [code, rule] of Object.entries(cases))
      assert.deepEqual(textProblems('a.js', code), [`a.js: ${rule}`], code);
  });

  it('leaves alone what only looks like it', () => {
    const clean = [
      'page.evaluate(() => 1)',
      'retrieval(x); medieval(y)',
      'const fn = Function.prototype.call',
      'setTimeout(() => tick(), 10)',
      "import x from './local.js'",
      'await import("./chunk.js")',
      "new Worker(new URL('./timer-worker.js', import.meta.url), { type: 'module' })",
      "fetch('https://ueegjwwmuuxlxyibgokx.supabase.co/rest/v1/rpc/device_report')",
    ];
    for (const code of clean) assert.deepEqual(textProblems('a.js', code), [], code);
  });

  it('refuses scripts from elsewhere, inline scripts and inline handlers in a page', () => {
    assert.deepEqual(textProblems('p.html', '<script src="https://cdn.example.com/x.js"></script>', true), [
      'p.html: <script> from a remote URL',
    ]);
    assert.deepEqual(textProblems('p.html', '<script>alert(1)</script>', true), ['p.html: an inline <script>']);
    assert.deepEqual(textProblems('p.html', '<img src="x.png" onerror="go()">', true), [
      'p.html: an inline event handler',
    ]);
    assert.deepEqual(textProblems('p.html', '<script type="module" src="./assets/app.js"></script>', true), []);
  });
});

describe('the manifest (#301)', () => {
  const all = () => true;

  it('passes as it ships: scripts only from the extension, every script in the bundle', () => {
    assert.deepEqual(manifestProblems(MANIFEST, all), []);
  });

  it('refuses a CSP that lets code in from a string or from another site', () => {
    const withCsp = (policy) => ({ content_security_policy: { extension_pages: policy } });
    assert.deepEqual(manifestProblems(withCsp("script-src 'self' 'unsafe-eval'; object-src 'none'"), all), [
      "manifest.json: the CSP's script-src allows 'unsafe-eval'",
      "manifest.json: the CSP's worker-src allows 'unsafe-eval'",
    ]);
    assert.deepEqual(manifestProblems(withCsp("default-src 'self' https://cdn.example.com"), all), [
      "manifest.json: the CSP's script-src allows https://cdn.example.com",
      "manifest.json: the CSP's worker-src allows https://cdn.example.com",
      "manifest.json: the CSP's object-src allows https://cdn.example.com",
    ]);
    assert.deepEqual(manifestProblems(withCsp("img-src 'self'"), all), [
      'manifest.json: the CSP sets no script-src (nor default-src)',
      'manifest.json: the CSP sets no worker-src (nor default-src)',
      'manifest.json: the CSP sets no object-src (nor default-src)',
    ]);
    assert.equal(parseCsp("Script-Src 'self'").get('script-src')[0], "'self'");
  });

  it('refuses a script that is a URL or is missing from the bundle', () => {
    const manifest = {
      background: { service_worker: 'sw.js' },
      content_scripts: [{ js: ['https://cdn.example.com/c.js'] }, { js: ['content.js'] }],
    };
    assert.deepEqual(
      manifestProblems(manifest, (path) => path === 'sw.js'),
      [
        'manifest.json: script https://cdn.example.com/c.js is a URL',
        'manifest.json: script content.js is not in the bundle',
      ],
    );
  });
});

describe('a built bundle (#301)', () => {
  /** A small bundle like apps/extension/dist, with `extra` files on top. */
  const bundle = (extra = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'xomoni-bundle-'));
    const files = {
      'manifest.json': JSON.stringify(MANIFEST),
      'sw.js': 'self.addEventListener("install", () => {})',
      'inject.js': '(() => {})()',
      'content.js': '(() => {})()',
      'dashboard.html': '<!doctype html><script type="module" src="./assets/dashboard.js"></script>',
      'assets/dashboard.js': 'import("./chunk.js")',
      ...extra,
    };
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  };

  it('passes a clean bundle', () => {
    const dir = bundle();
    try {
      assert.deepEqual(bundleProblems(dir), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('names each problem with its file, in nested folders too', () => {
    const dir = bundle({
      'assets/lib.js': 'var g = new Function("return this")()',
      'dashboard.html': '<script type="module" src="./assets/missing.js"></script>',
    });
    try {
      assert.deepEqual(bundleProblems(dir), [
        'assets/lib.js: new Function()',
        'dashboard.html: <script src="./assets/missing.js"> is not in the bundle',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when there is nothing built, rather than passing an empty folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xomoni-bundle-'));
    try {
      assert.match(bundleProblems(dir)[0], /no manifest\.json; build the extension first/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the extension's own sources (#301)", () => {
  /** Every TypeScript file under `dir`, skipping tests and the never-shipped preview. */
  const sources = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === 'dev' || name === 'node_modules' ? [] : sources(path);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });

  it('build nothing from strings and load nothing from elsewhere, before any build runs', () => {
    const dirs = ['apps/extension/src', 'packages/bridge/src', 'packages/consent/src', 'packages/fluent-theme/src'];
    const files = dirs.flatMap((dir) => sources(join(ROOT, dir)));
    assert.ok(files.length > 50, 'the sources were found');
    const problems = files.flatMap((file) => textProblems(file.slice(ROOT.length + 1), readFileSync(file, 'utf8')));
    assert.deepEqual(problems, []);
  });
});

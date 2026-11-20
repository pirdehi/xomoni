// Checks docs/STORE-LISTING.md and docs/store against the manifest and the stores' limits (#301), run by
// `node --test 'tooling/*.test.mjs'` in `npm run verify`. A permission added to the manifest without a justification,
// a draft over a store's length limit, or an image of the wrong size fails here.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = readFileSync(join(ROOT, 'docs/STORE-LISTING.md'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'apps/extension/public/manifest.json'), 'utf8'));
const STORE = join(ROOT, 'docs/store');

/** The text between `<!-- name:start -->` and `<!-- name:end -->`, without a code fence around it. */
function block(name) {
  const match = new RegExp(`<!-- ${name}:start -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`).exec(DOC);
  assert.ok(match, `docs/STORE-LISTING.md has no ${name} block`);
  return match[1].replace(/^```\w*\n/, '').replace(/\n```$/, '');
}

/** The items of a `- ` list block. */
const items = (name) =>
  block(name)
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim());

/** The first cell of every row of the permissions table (§5). */
function permissionRows() {
  const section = DOC.slice(DOC.indexOf('## 5. Permissions'), DOC.indexOf('## 6. '));
  return section
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => line.split(' | ')[0].slice(2).trim());
}

/** Whether `text` holds a link to exactly `host` and `path`, compared as parsed URLs, not as substrings. */
function linksTo(text, host, path) {
  return [...text.matchAll(/https:\/\/[^\s)<>"'`]+/g)].some((match) => {
    const url = new URL(match[0].replace(/[.,;:]+$/, ''));
    return url.hostname === host && url.pathname === path;
  });
}

describe('the permissions table (#301)', () => {
  const rows = permissionRows();

  it('justifies every permission the manifest asks for, and no other', () => {
    for (const permission of MANIFEST.permissions) assert.ok(rows.includes(`\`${permission}\``), permission);
    const named = rows.filter((cell) => /^`\w+`$/.test(cell)).map((cell) => cell.slice(1, -1));
    const keys = ['externally_connectable', 'content_security_policy'];
    for (const name of named)
      assert.ok(MANIFEST.permissions.includes(name) || (keys.includes(name) && name in MANIFEST), name);
  });

  it('covers each content script, the page-world one as such, and the other manifest items that need a reason', () => {
    for (const { js, world } of MANIFEST.content_scripts)
      for (const file of js) {
        const row = rows.find((cell) => cell.startsWith('`content_scripts`') && cell.includes(`\`${file}\``));
        assert.ok(row, file);
        if (world === 'MAIN') assert.match(row, /"world": "MAIN"/);
        for (const match of MANIFEST.content_scripts.flatMap((cs) => cs.matches)) assert.ok(row.includes(match));
      }
    for (const key of ['externally_connectable', 'content_security_policy', 'incognito', 'minimum_chrome_version'])
      if (key in MANIFEST)
        assert.ok(
          rows.some((cell) => cell.startsWith(`\`${key}\``)),
          key,
        );
  });

  it('is repeated in the notes for reviewers, so the two never disagree on what is asked for', () => {
    const notes = block('reviewer-notes');
    for (const permission of [...MANIFEST.permissions, 'externally_connectable'])
      assert.ok(notes.includes(permission), permission);
  });
});

describe('the listing text (#301)', () => {
  it('proposes names within Chrome’s 75 characters, each starting with Xomoni', () => {
    const names = items('name-drafts');
    assert.ok(names.length >= 2);
    for (const name of names) {
      assert.ok(name.length <= 75, name);
      assert.match(name, /^Xomoni\b/);
    }
  });

  it('proposes short descriptions within the 132 characters of the manifest’s description', () => {
    const drafts = items('summary-drafts');
    assert.ok(drafts.length >= 1);
    for (const draft of drafts) assert.ok(draft.length <= 132, `${draft.length}: ${draft}`);
  });

  it('writes a detailed description Edge accepts, which says Xomoni is not X’s', () => {
    const text = block('detailed-description');
    assert.ok(text.length >= 250 && text.length <= 10_000, `${text.length} characters`);
    assert.match(text, /Not affiliated with X Corp\./);
    assert.ok(linksTo(text, 'xomoni.com', '/privacy'), 'links the privacy policy');
  });

  it('states one purpose, and gives the reviewers the safety rules and the privacy policy', () => {
    assert.match(block('single-purpose'), /clean up their own X account/);
    const notes = block('reviewer-notes');
    for (const rule of ['one fifth', 'No credentials', 'No evasion', 'Confirmation for every job', 'Data stays local'])
      assert.ok(notes.includes(rule), rule);
    assert.match(notes, /Not affiliated with X Corp\./);
    assert.ok(linksTo(notes, 'xomoni.com', '/privacy'), 'links the privacy policy');
  });

  it('names the homepage, the support page and the privacy policy the stores ask for', () => {
    // The rows of the fields table (§1), with Xomoni's value in the last column.
    assert.match(DOC, /^\| Homepage \|.*\| https:\/\/xomoni\.com \|$/m);
    assert.match(DOC, /^\| Support \|.*\| https:\/\/github\.com\/pirdehi\/xomoni\/issues \|$/m);
    assert.match(DOC, /^\| Privacy policy \|.*\| https:\/\/xomoni\.com\/privacy \|$/m);
  });
});

/** A PNG's width, height, color type (2 RGB, 6 RGBA) and, for an unfiltered RGBA image, the alpha at a pixel. */
function png(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', file);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colorType = bytes[25];
  const alphaAt = (x, y) => {
    const chunks = [];
    for (let at = 8; at < bytes.length;) {
      const length = bytes.readUInt32BE(at);
      if (bytes.subarray(at + 4, at + 8).toString('latin1') === 'IDAT')
        chunks.push(bytes.subarray(at + 8, at + 8 + length));
      at += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    const row = y * (width * 4 + 1);
    assert.equal(raw[row], 0, 'icon.mjs writes unfiltered rows');
    return raw[row + 1 + x * 4 + 3];
  };
  return { width, height, colorType, alphaAt };
}

describe('the store images (#301)', () => {
  const expected = {
    'icon-128.png': [128, 128, 6],
    'edge-logo-300.png': [300, 300, 6],
    'promo-small-440x280.png': [440, 280, 2],
    'screenshot-1-overview.png': [1280, 800, 2],
    'screenshot-2-cleanup.png': [1280, 800, 2],
    'screenshot-3-library.png': [1280, 800, 2],
    'screenshot-4-activity.png': [1280, 800, 2],
    'screenshot-5-settings-dark.png': [1280, 800, 2],
  };

  it('are the sizes the stores take, the screenshots and the tile without transparency', () => {
    for (const [name, [width, height, colorType]] of Object.entries(expected)) {
      assert.ok(existsSync(join(STORE, name)), `${name}: run npm run store:images -w @xomoni/extension`);
      const image = png(join(STORE, name));
      assert.deepEqual([image.width, image.height, image.colorType], [width, height, colorType], name);
    }
    assert.ok(readdirSync(STORE).filter((name) => name.includes('screenshot')).length <= 5, 'Chrome takes 5 at most');
  });

  it('give the store icon 16 transparent pixels around 96 × 96 artwork, as Chrome asks', () => {
    const icon = png(join(STORE, 'icon-128.png'));
    for (const [x, y] of [
      [0, 0],
      [15, 64],
      [64, 15],
      [112, 64],
      [64, 112],
    ])
      assert.equal(icon.alphaAt(x, y), 0, `${x},${y}`);
    for (const [x, y] of [
      [20, 64],
      [64, 64],
      [107, 64],
    ])
      assert.equal(icon.alphaAt(x, y), 255, `${x},${y}`);
  });

  it('are all listed in the doc, and nothing else sits in docs/store', () => {
    assert.deepEqual(readdirSync(STORE).sort(), Object.keys(expected).sort());
    for (const name of Object.keys(expected)) assert.ok(DOC.includes(`(store/${name})`), name);
  });
});

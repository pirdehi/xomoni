// Tests for tooling/docs-layout-lib.mjs (#344, ADR-0041), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
// Each case writes a small docs/ into a temporary folder. The repository's own docs/ is checked by `npm run docs:check`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  DOCS_MAP,
  LIVING_DOCS,
  MONTH_FOLDER,
  REPORTS_DIR,
  checkDocsLayout,
  linkedPaths,
  markdownLinks,
} from './docs-layout-lib.mjs';

const LIVING = ['ARCHITECTURE.md', 'PLAYBOOK.fa.md', 'features.json'];
const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** A repository in a temporary folder with these files (path → text); returns its root. */
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'xomoni-docs-layout-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A map linking the living documents of {@link LIVING} and these folders, as `name/README.md` or `name/`. */
const MAP = [
  '# Docs',
  '',
  '- [Architecture](ARCHITECTURE.md#layers) · [فارسی](PLAYBOOK.fa.md) · [registry](features.json "The features")',
  '- [Decisions](adr/README.md) and [reports](reports/), [kept](https://example.com/docs/x.md)',
].join('\n');

/** A valid docs/: the living documents, the map, an ADR folder with its index and a report in its month's folder. */
function validDocs(extra = {}) {
  return {
    'docs/ARCHITECTURE.md': '# Architecture',
    'docs/PLAYBOOK.fa.md': '# Playbook',
    'docs/features.json': '{}',
    [DOCS_MAP]: MAP,
    'docs/adr/README.md': '# ADRs',
    'docs/reports/2026-11/STATUS-2026-11-14.md': '# Status',
    'docs/reports/2026-11/STATUS-2026-11-14.fa.md': '# وضعیت',
    ...extra,
  };
}

/** `files` without the paths `drop` accepts. */
function without(files, drop) {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !drop(path)));
}

describe('markdownLinks', () => {
  it('returns each link target in order, without its title', () => {
    assert.deepEqual(markdownLinks('[a](one.md) and ![b](two.png "Two") then [c](three.md#part)'), [
      'one.md',
      'two.png',
      'three.md#part',
    ]);
  });

  it('leaves out links inside fenced code blocks and inline code, which are examples', () => {
    const text = ['[real](real.md) `[inline](inline.md)`', '```md', '[fenced](fenced.md)', '```'].join('\n');
    assert.deepEqual(markdownLinks(text), ['real.md']);
  });
});

describe('linkedPaths', () => {
  it('resolves relative links from the file, dropping anchors and a folder’s trailing slash', () => {
    const paths = linkedPaths('docs/README.md', '[a](ROADMAP.md#phase-1) [b](reports/) [c](../AGENTS.md) [d](./adr/)');
    assert.deepEqual([...paths].sort(), ['AGENTS.md', 'docs/ROADMAP.md', 'docs/adr', 'docs/reports']);
  });

  it('leaves out web, mail and same-page links', () => {
    const text = '[a](https://x.com/docs/ROADMAP.md) [b](mailto:privacy@xomoni.com) [c](#top) [d](http://a.b/c)';
    assert.equal(linkedPaths('docs/README.md', text).size, 0);
  });

  it('decodes encoded paths', () => {
    assert.deepEqual([...linkedPaths('docs/README.md', '[a](My%20Doc.md)')], ['docs/My Doc.md']);
  });
});

describe('checkDocsLayout', () => {
  it('passes a docs/ of living documents, a map that links them and its folders, and reports by month', () => {
    assert.deepEqual(checkDocsLayout(repo(validDocs()), LIVING), []);
  });

  it('refuses a new file at the root of docs/ and says where dated reports go', () => {
    const problems = checkDocsLayout(repo(validDocs({ 'docs/STATUS-2026-12-01.md': '# Status' })), LIVING);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^docs\/STATUS-2026-12-01\.md: not a living document/);
    assert.ok(problems[0].includes(`${REPORTS_DIR}/<yyyy-mm>/`));
    assert.ok(problems[0].includes('LIVING_DOCS'));
  });

  it('refuses any kind of file at the root, not only Markdown', () => {
    const problems = checkDocsLayout(repo(validDocs({ 'docs/notes.txt': 'notes', 'docs/plan.pdf': '%PDF' })), LIVING);
    assert.deepEqual(
      problems.map((problem) => problem.split(':')[0]),
      ['docs/notes.txt', 'docs/plan.pdf'],
    );
  });

  it('ignores files whose name starts with a dot, such as the .DS_Store macOS leaves', () => {
    const root = repo(validDocs({ 'docs/.DS_Store': '', 'docs/reports/.DS_Store': '' }));
    assert.deepEqual(checkDocsLayout(root, LIVING), []);
  });

  it('fails for a listed living document that is missing, so the list can’t go stale', () => {
    const files = without(validDocs(), (path) => path === 'docs/features.json');
    const problems = checkDocsLayout(repo(files), LIVING);
    assert.deepEqual(problems, [
      'docs/features.json: is on LIVING_DOCS in tooling/docs-layout-lib.mjs but missing: take it off the list',
    ]);
  });

  it('fails when the map is missing, and checks nothing more about it', () => {
    const files = without(validDocs(), (path) => path === DOCS_MAP);
    const problems = checkDocsLayout(repo(files), LIVING);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^docs\/README\.md: missing: the map of docs\//);
  });

  it('fails when the map misses a living document', () => {
    const root = repo(validDocs({ [DOCS_MAP]: MAP.replace('[فارسی](PLAYBOOK.fa.md)', 'PLAYBOOK.fa.md') }));
    assert.deepEqual(checkDocsLayout(root, LIVING), [
      'docs/README.md: does not link PLAYBOOK.fa.md: the map links every living document',
    ]);
  });

  it('does not count a living document named only in inline code as linked', () => {
    const root = repo(validDocs({ [DOCS_MAP]: MAP.replace('[فارسی](PLAYBOOK.fa.md)', '`[فارسی](PLAYBOOK.fa.md)`') }));
    assert.equal(checkDocsLayout(root, LIVING).length, 1);
  });

  it('fails when the map misses a folder, and accepts the folder or its README as its link', () => {
    const missing = checkDocsLayout(repo(validDocs({ 'docs/guides/HOW-TO.md': '# How' })), LIVING);
    assert.deepEqual(missing, ['docs/README.md: does not link the folder guides/: the map links every folder']);

    for (const link of ['[guides](guides/)', '[guides](guides)', '[guides](guides/README.md)']) {
      const root = repo(validDocs({ 'docs/guides/README.md': '# Guides', [DOCS_MAP]: `${MAP}\n${link}` }));
      assert.deepEqual(checkDocsLayout(root, LIVING), [], link);
    }
  });

  it('does not count a link to a file inside a folder as a link to the folder', () => {
    const root = repo(validDocs({ 'docs/guides/HOW-TO.md': '# How', [DOCS_MAP]: `${MAP}\n[how](guides/HOW-TO.md)` }));
    assert.equal(checkDocsLayout(root, LIVING).length, 1);
  });

  it('fails for a report directly in reports/, outside a month folder', () => {
    const problems = checkDocsLayout(repo(validDocs({ 'docs/reports/STATUS.md': '# Status' })), LIVING);
    assert.deepEqual(problems, ["docs/reports/STATUS.md: put it in its month's folder, docs/reports/<yyyy-mm>/"]);
  });

  it('fails for a reports folder not named after its month, and allows a README in reports/', () => {
    const files = validDocs({
      'docs/reports/README.md': '# Reports',
      'docs/reports/november/STATUS.md': '# Status',
      'docs/reports/2026-13/STATUS.md': '# Status',
    });
    assert.deepEqual(
      checkDocsLayout(repo(files), LIVING).map((problem) => problem.split(':')[0]),
      ['docs/reports/2026-13', 'docs/reports/november'],
    );
  });

  it('passes with no reports folder at all', () => {
    const files = without(validDocs({ [DOCS_MAP]: MAP.replace('[reports](reports/)', 'reports') }), (path) =>
      path.startsWith(REPORTS_DIR),
    );
    assert.deepEqual(checkDocsLayout(repo(files), LIVING), []);
  });
});

describe('the lists', () => {
  it('names month folders as <yyyy-mm>', () => {
    for (const name of ['2026-11', '2027-01', '2026-12']) assert.ok(MONTH_FOLDER.test(name), name);
    for (const name of ['2026-1', '2026-00', '2026-13', '26-11', '2026-11-14', 'november']) {
      assert.ok(!MONTH_FOLDER.test(name), name);
    }
  });

  it('keeps every living document a plain file name, once, and never the map itself', () => {
    assert.equal(new Set(LIVING_DOCS).size, LIVING_DOCS.length);
    for (const name of LIVING_DOCS) assert.match(name, /^[A-Za-z0-9.-]+\.(md|json)$/);
    assert.ok(!LIVING_DOCS.includes('README.md'));
    assert.ok(Object.isFrozen(LIVING_DOCS));
  });

  it('lists no dated report as a living document', () => {
    for (const name of LIVING_DOCS) assert.doesNotMatch(name, /\d{4}-\d{2}-\d{2}/);
  });
});

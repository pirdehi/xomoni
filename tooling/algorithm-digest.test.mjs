// Tests for the monthly digest of X's open ranking code (#430, ADR-0046): the rules in tooling/algorithm-digest-lib.mjs
// against a fake GitHub, and tooling/algorithm-digest.mjs run as the workflow runs it, in a copy of the tooling folder,
// with `fetch` replaced before the script starts. Nothing here reaches the network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import {
  AREAS,
  COMPARE_FILE_CAP,
  DATA_DIR,
  DIGEST_FIELDS,
  DIGEST_REPO,
  DigestError,
  LIMITS,
  MAX_FILES_READ,
  areaOf,
  askGitHub,
  changedParameters,
  checkDigest,
  cleanText,
  definitions,
  draft,
  draftDigest,
  formatJson,
  indexSource,
  latestDigest,
  monthOf,
  parameterNames,
  parseArgs,
  pullRequestBody,
  readFileAt,
  summarizeCompare,
  treeDiff,
  unpatchedParameterFiles,
} from './algorithm-digest-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const OLD = 'c'.repeat(40);
const API = `https://api.github.com/repos/${DIGEST_REPO}/`;
/** Characters no digest may keep: NUL, a tab, escape, DEL, a C1 control, zero-width space, a line separator, an RTL override, an isolate, a BOM. */
const UNSAFE = [0x00, 0x09, 0x1b, 0x7f, 0x85, 0x200b, 0x2028, 0x202e, 0x2066, 0xfeff].map((c) =>
  String.fromCodePoint(c),
);

/** A file of a comparison as GitHub lists it. */
const file = (filename, fields = {}) => ({ filename, status: 'modified', ...fields });
/** A commit of a comparison as GitHub lists it. */
const commit = (message, sha = HEAD) => ({ sha, commit: { message, committer: { date: '2026-11-21T03:11:26Z' } } });

/** A comparison as GitHub answers it, by default two commits touching a scorer and a parameter file. */
function comparison(fields = {}) {
  return {
    status: 'ahead',
    total_commits: 2,
    commits: [commit('Open-source X Recommendation Algorithm'), commit('Open-source X Recommendation Algorithm')],
    files: [
      file('home-mixer/scorers/phoenix_scorer.rs', { patch: '@@ -1 +1 @@\n-const A: u8 = 1;\n+const A: u8 = 2;' }),
      file('home-mixer/params/config.rs', {
        patch:
          '@@ -1,2 +1,2 @@\n-param!(ReplyWeight, f64, "rust_home_mixer_reply_weight", 5.0);\n+param!(ReplyWeight, f64, "rust_home_mixer_reply_weight", 4.0);',
      }),
    ],
    ...fields,
  };
}

/** A digest that passes `checkDigest`: a draft of `month`, from `from` to `to`. */
function digest(fields = {}) {
  return {
    ...draftDigest({
      month: '2026-11',
      from: BASE,
      to: HEAD,
      toDate: '2026-11-21',
      compare: summarizeCompare(comparison()),
    }),
    ...fields,
  };
}

/** A fake response: a status and a JSON body (or text that isn't JSON). */
function answer(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

/**
 * A fake `fetch` for GitHub: `routes` maps a path under the repository's API (`commits?per_page=1`) to an answer, or to
 * a function of the call. Every call is logged with its URL and options; a path with no route answers 404.
 */
function fakeGitHub(routes) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    if (!url.startsWith(API)) throw new Error(`the digest asked ${url}`);
    const route = routes[url.slice(API.length)];
    if (route instanceof Error) throw route;
    if (typeof route === 'function') return route(url, options);
    return route ?? answer(404, { message: 'Not Found' });
  };
  return { fetchFn, calls };
}

/** The usual GitHub: the newest commit is HEAD, and the comparison from BASE to it. */
const usualRoutes = (fields = {}) => ({
  'commits?per_page=1': answer(200, [commit('newest', HEAD)]),
  [`compare/${BASE}...${HEAD}`]: answer(200, comparison()),
  ...fields,
});

/** An in-memory data folder, with every read and write logged. */
function memoryStore(files = {}) {
  const data = new Map(Object.entries(files));
  const reads = [];
  const writes = [];
  return {
    data,
    reads,
    writes,
    list: () => [...data.keys()].sort(),
    read: (name) => {
      reads.push(name);
      return data.get(name);
    },
    write: (name, text) => {
      writes.push(name);
      data.set(name, text);
    },
  };
}

/** A data folder holding last month's published digest, which ends at BASE. */
const lastMonth = () =>
  memoryStore({
    '2026-10.json': `${formatJson(digest({ month: '2026-10', from: OLD, to: BASE, status: 'published', summary: 'S' }))}\n`,
    'index.ts': indexSource(['2026-10']),
  });

const NOW = new Date('2026-11-20T06:17:00Z');

/** Runs `draft` with the usual inputs and the given changes. */
const run = (fields) => draft({ options: { month: '', from: '', to: '' }, token: '', now: NOW, ...fields });

/** Prettier's own output for `text`, with this repository's settings. */
async function prettierOf(text, parser) {
  const config = JSON.parse(readFileSync(join(ROOT, '.prettierrc.json'), 'utf8'));
  return prettier.format(text, { ...config, parser });
}

describe('cleaning text from X’s repository (ADR-0046, 4)', () => {
  it('keeps the first line, turns unsafe characters into spaces and collapses them', () => {
    for (const char of UNSAFE) assert.equal(cleanText(`a${char}b`), 'a b', `U+${char.codePointAt(0).toString(16)}`);
    assert.equal(cleanText('  Fix ranking  \nSigned-off-by: someone'), 'Fix ranking');
    assert.equal(cleanText('one\r\ntwo'), 'one');
  });

  it('keeps markup as plain text, for the website to show as text', () => {
    assert.equal(cleanText('<script>alert(1)</script> & <b>'), '<script>alert(1)</script> & <b>');
  });

  it('cuts at 200 characters with an ellipsis, counting an emoji as one', () => {
    assert.equal(cleanText('x'.repeat(200)), 'x'.repeat(200));
    const cut = cleanText('x'.repeat(250));
    assert.equal(Array.from(cut).length, LIMITS.text);
    assert.ok(cut.endsWith('…'));
    const emoji = String.fromCodePoint(0x1f600);
    assert.equal(Array.from(cleanText(emoji.repeat(300))).length, LIMITS.text);
    assert.equal(cleanText('abcdef', 4), 'abc…');
  });

  it('gives an empty string for anything but a string', () => {
    for (const value of [undefined, null, 3, {}, ['a']]) assert.equal(cleanText(value), '');
  });
});

describe('sorting changed files into areas', () => {
  it('follows the repository’s layout, parameter files first', () => {
    const cases = {
      'home-mixer/scorers/phoenix_scorer.rs': 'ranking',
      'home-mixer/selectors/top_k.rs': 'ranking',
      'home-mixer/models/candidate.rs': 'ranking',
      'phoenix/python/model.py': 'ranking',
      'vm-ranker/scoring/score.rs': 'ranking',
      'home-mixer/filters/muted_keyword_filter.rs': 'filters',
      'visibility-filtering/rules/a.rs': 'filters',
      'abuse-enforcement-service/server/src/main.rs': 'filters',
      'home-mixer/sources/thunder_source.rs': 'candidate-sources',
      'home-mixer/candidate_hydrators/x.rs': 'candidate-sources',
      'candidate-pipeline/source.rs': 'candidate-sources',
      'thunder/posts/a.rs': 'candidate-sources',
      'home-mixer/ads/following_ad_blender.rs': 'ads-blending',
      'grox/core/lm/a.py': 'content-understanding',
      'media-model-proxy/src/main.rs': 'content-understanding',
      'home-mixer/params/config.rs': 'parameters',
      'home-mixer/candidate_pipeline/performance_params.json': 'parameters',
      'vm-ranker/params.rs': 'parameters',
      'visibility-filtering/params/client_switches.rs': 'parameters',
      'docs/overview.md': 'docs',
      'README.md': 'docs',
      'phoenix/TRAINING.md': 'docs',
      'home-mixer/main.rs': 'other',
      'Cargo.toml': 'other',
    };
    for (const [path, area] of Object.entries(cases)) assert.equal(areaOf(path), area, path);
    for (const area of Object.values(cases)) assert.ok(AREAS.includes(area));
  });
});

describe('the names of the parameters that changed', () => {
  const patch = (lines) => ({ filename: 'home-mixer/params/config.rs', patch: ['@@ -1 +1 @@', ...lines].join('\n') });

  it('reads a one-line param! by its quoted name, else its Rust name', () => {
    assert.deepEqual(parameterNames(patch(['+param!(ReplyWeight, f64, "rust_home_mixer_reply_weight", 4.0);'])), [
      'rust_home_mixer_reply_weight',
    ]);
    assert.deepEqual(parameterNames(patch(['-param!(Unnamed, f64);'])), ['Unnamed']);
  });

  it('names a param! spread over lines when any of its lines changed, and not when none did', () => {
    const block = (value) => [
      ' param!(',
      '     PhotoExpandWeight,',
      '     f64,',
      '     "rust_home_mixer_photo_expand_weight",',
      value,
      ' );',
    ];
    assert.deepEqual(parameterNames(patch(block('-    0.05'))), ['rust_home_mixer_photo_expand_weight']);
    assert.deepEqual(parameterNames(patch(block('     0.05'))), []);
    // A block the patch cuts before its end still counts.
    assert.deepEqual(parameterNames(patch(block('+    0.06').slice(0, 5))), ['rust_home_mixer_photo_expand_weight']);
  });

  it('reads JSON keys, constants and YAML or TOML keys from changed lines only', () => {
    assert.deepEqual(parameterNames(patch(['+  "rust_home_mixer_click_weight": 0,', '   "unchanged": 1,'])), [
      'rust_home_mixer_click_weight',
    ]);
    assert.deepEqual(parameterNames(patch(['+pub const MAX_RESULTS: usize = 400;', '-static TTL_SECS: u64 = 5;'])), [
      'MAX_RESULTS',
      'TTL_SECS',
    ]);
    const yaml = { filename: 'grox/config/model.yaml', patch: '@@ -1 +1 @@\n-  top_k: 5\n+  top_k: 6' };
    assert.deepEqual(parameterNames(yaml), ['top_k', 'top_k']);
    // In a Rust file, `name: value` is a field, not a parameter.
    assert.deepEqual(parameterNames(patch(['+  top_k: 6,'])), []);
  });

  it('gives none for a file without a patch, and drops names that aren’t names', () => {
    assert.deepEqual(parameterNames({ filename: 'x.json' }), []);
    assert.deepEqual(parameterNames(null), []);
    assert.deepEqual(parameterNames(patch(['+  "a": 1,', `+  "${'n'.repeat(100)}": 1`])), []);
  });

  it('compares whole files when GitHub gave no patch: JSON keys, param! blocks and constants', () => {
    const json = (o) => JSON.stringify(o, null, 2);
    assert.deepEqual(
      changedParameters(json({ a_weight: 1, same: 2, gone: 3 }), json({ a_weight: 2, same: 2, added: 1 }), 'p.json'),
      ['a_weight', 'added', 'gone'],
    );
    assert.deepEqual(changedParameters(null, json({ new_one: 1 }), 'p.json'), ['new_one']);
    assert.deepEqual(changedParameters(json({ old_one: 1 }), null, 'p.json'), ['old_one']);
    assert.deepEqual(changedParameters('not json', '{"a_b": 1}', 'p.json'), ['a_b']);
    const rust = (v) =>
      `param!(\n    ReplyWeight,\n    f64,\n    "rust_reply_weight",\n    ${v}\n);\nconst TOP_K: u8 = 5;\n`;
    assert.deepEqual(changedParameters(rust('5.0'), rust('4.0'), 'config.rs'), ['rust_reply_weight']);
    assert.deepEqual(changedParameters(rust('5.0'), rust('5.0'), 'config.rs'), []);
    assert.deepEqual([...definitions('top_k = 5\n# note\n', 'a.toml').keys()], ['top_k']);
    assert.deepEqual([...definitions('[1, 2]', 'list.json').keys()], []);
  });

  it('lists the parameter files GitHub gave no patch for, with the path at each end', () => {
    const files = [
      file('home-mixer/params/config.rs'),
      file('home-mixer/candidate_pipeline/performance_params.json', { status: 'added' }),
      file('vm-ranker/params.rs', { status: 'removed' }),
      file('visibility-filtering/params/new.rs', {
        status: 'renamed',
        previous_filename: 'visibility-filtering/params/old.rs',
      }),
      file('home-mixer/params/patched.rs', { patch: '@@ -1 +1 @@' }),
      file('home-mixer/scorers/no_patch.rs'),
    ];
    assert.deepEqual(unpatchedParameterFiles({ files }), [
      {
        path: 'home-mixer/params/config.rs',
        before: 'home-mixer/params/config.rs',
        after: 'home-mixer/params/config.rs',
      },
      {
        path: 'home-mixer/candidate_pipeline/performance_params.json',
        before: null,
        after: 'home-mixer/candidate_pipeline/performance_params.json',
      },
      { path: 'vm-ranker/params.rs', before: 'vm-ranker/params.rs', after: null },
      {
        path: 'visibility-filtering/params/new.rs',
        before: 'visibility-filtering/params/old.rs',
        after: 'visibility-filtering/params/new.rs',
      },
    ]);
    const many = Array.from({ length: 30 }, (_, i) => file(`home-mixer/params/p${i}.rs`));
    assert.equal(unpatchedParameterFiles({ files: many }).length, MAX_FILES_READ);
    assert.deepEqual(unpatchedParameterFiles({}), []);
  });
});

describe('summarizing a comparison', () => {
  it('counts files by area in the digest’s order, names parameters from parameter files only', () => {
    const summary = summarizeCompare(comparison());
    assert.deepEqual(summary, {
      status: 'ahead',
      commits: 2,
      files: 2,
      filesCapped: false,
      areas: [
        { area: 'ranking', files: 1, paths: ['home-mixer/scorers/phoenix_scorer.rs'] },
        { area: 'parameters', files: 1, paths: ['home-mixer/params/config.rs'] },
      ],
      // The constant in the scorer is not a parameter.
      parameters: ['rust_home_mixer_reply_weight'],
      parameterCount: 1,
      messages: ['Open-source X Recommendation Algorithm'],
    });
  });

  it('counts a param! wherever it is declared, and adds the names read from whole files', () => {
    const files = [
      file('home-mixer/scorers/x.rs', { patch: '@@ -1 +1 @@\n+param!(NewSwitch, bool, "new_switch", false);' }),
    ];
    const summary = summarizeCompare(comparison({ files }), ['from_whole_file', 'new_switch']);
    assert.deepEqual(summary.parameters, ['from_whole_file', 'new_switch']);
  });

  it('caps the names at 50 and the paths at 10, and says how many in all', () => {
    const files = Array.from({ length: COMPARE_FILE_CAP }, (_, i) =>
      file(`home-mixer/params/p${String(i).padStart(3, '0')}.json`, { patch: `@@ -1 +1 @@\n+  "name_${i}": 1` }),
    );
    const summary = summarizeCompare(comparison({ files }));
    assert.equal(summary.files, COMPARE_FILE_CAP);
    assert.equal(summary.filesCapped, true);
    assert.deepEqual(
      summary.areas.map((a) => [a.area, a.files, a.paths.length]),
      [['parameters', 300, LIMITS.paths]],
    );
    assert.equal(summary.parameters.length, LIMITS.parameters);
    assert.equal(summary.parameterCount, 300);
    assert.deepEqual(summary.parameters, [...summary.parameters].sort());
  });

  it('keeps up to 20 distinct messages, cleaned, in order', () => {
    const commits = [
      commit(`First${UNSAFE[1]}line\nbody`),
      commit('<img src=x onerror=alert(1)>'),
      commit('First line'),
      ...Array.from({ length: 40 }, (_, i) => commit(`Change ${i}`)),
    ];
    const { messages } = summarizeCompare(comparison({ commits }));
    assert.equal(messages.length, LIMITS.messages);
    assert.deepEqual(messages.slice(0, 3), ['First line', '<img src=x onerror=alert(1)>', 'Change 0']);
  });

  it('refuses an answer not shaped as GitHub’s', () => {
    for (const bad of [
      null,
      'text',
      { ...comparison(), status: 'weird' },
      { ...comparison(), total_commits: -1 },
      { ...comparison(), total_commits: '2' },
      { ...comparison(), files: {} },
      { ...comparison(), files: [{ filename: '' }] },
      { ...comparison(), files: [{}] },
    ])
      assert.throws(() => summarizeCompare(bad), DigestError, JSON.stringify(bad));
  });
});

describe('every file of a range, when GitHub’s list stops at 300', () => {
  /** A tree as GitHub's API answers it, from path → blob id. */
  const tree = (blobs, fields = {}) => ({
    sha: 'x',
    truncated: false,
    tree: [
      { path: 'home-mixer', type: 'tree', sha: 't1' },
      ...Object.entries(blobs).map(([path, sha]) => ({ path, type: 'blob', sha })),
    ],
    ...fields,
  });

  it('lists what was added, changed and removed, by path, and nothing that stayed', () => {
    const before = tree({ 'b.rs': '1', 'a.rs': '1', 'gone.rs': '1' });
    const after = tree({ 'a.rs': '2', 'b.rs': '1', 'new.rs': '1' });
    assert.deepEqual(treeDiff(before, after), [
      { filename: 'a.rs', status: 'modified' },
      { filename: 'gone.rs', status: 'removed' },
      { filename: 'new.rs', status: 'added' },
    ]);
    assert.deepEqual(treeDiff(before, before), []);
  });

  it('gives up on a tree GitHub cut short, or one not shaped as a tree', () => {
    const ok = tree({ 'a.rs': '1' });
    assert.equal(treeDiff(tree({}, { truncated: true }), ok), null);
    assert.equal(treeDiff(ok, { tree: [] }), null);
    assert.equal(treeDiff(ok, null), null);
    assert.equal(treeDiff(ok, tree({}, { tree: [{ type: 'blob', path: 7, sha: '1' }] })), null);
  });

  it('drafts from both trees when the comparison lists 300 files, so no area is left out', async () => {
    const listed = Array.from({ length: COMPARE_FILE_CAP }, (_, i) =>
      file(`abuse-x/f${String(i).padStart(3, '0')}.rs`),
    );
    const before = Object.fromEntries(listed.map((f) => [f.filename, '1']));
    const after = { ...Object.fromEntries(listed.map((f) => [f.filename, '2'])), 'home-mixer/scorers/late.rs': '1' };
    const store = lastMonth();
    const { fetchFn, calls } = fakeGitHub(
      usualRoutes({
        [`compare/${BASE}...${HEAD}`]: answer(200, comparison({ files: listed })),
        [`git/trees/${BASE}?recursive=1`]: answer(200, tree(before)),
        [`git/trees/${HEAD}?recursive=1`]: answer(200, tree(after)),
      }),
    );
    const { digest: d } = await run({ fetch: fetchFn, store });
    assert.equal(d.files, COMPARE_FILE_CAP + 1);
    assert.equal(d.filesCapped, false);
    assert.deepEqual(
      d.areas.map((a) => [a.area, a.files]),
      [
        ['ranking', 1],
        ['filters', COMPARE_FILE_CAP],
      ],
    );
    assert.ok(calls.every((c) => c.url.startsWith(API)));
  });

  it('keeps GitHub’s 300, saying so, when a tree is cut short', async () => {
    const listed = Array.from({ length: COMPARE_FILE_CAP }, (_, i) => file(`docs/f${i}.md`));
    const routes = usualRoutes({
      [`compare/${BASE}...${HEAD}`]: answer(200, comparison({ files: listed })),
      [`git/trees/${BASE}?recursive=1`]: answer(200, tree({}, { truncated: true })),
      [`git/trees/${HEAD}?recursive=1`]: answer(200, tree({})),
    });
    const { digest: d } = await run({ fetch: fakeGitHub(routes).fetchFn, store: lastMonth() });
    assert.equal(d.filesCapped, true);
    assert.equal(d.files, COMPARE_FILE_CAP);
  });

  it('writes nothing when a tree can’t be read', async () => {
    const listed = Array.from({ length: COMPARE_FILE_CAP }, (_, i) => file(`docs/f${i}.md`));
    const store = lastMonth();
    const routes = usualRoutes({
      [`compare/${BASE}...${HEAD}`]: answer(200, comparison({ files: listed })),
      [`git/trees/${BASE}?recursive=1`]: answer(500, {}),
    });
    await assert.rejects(run({ fetch: fakeGitHub(routes).fetchFn, store }), /answered 500 for git\/trees/);
    assert.deepEqual(store.writes, []);
  });
});

describe('a digest’s shape', () => {
  it('drafts with every field, no summary and status draft, and passes the check', () => {
    const d = digest();
    assert.deepEqual(Object.keys(d), DIGEST_FIELDS);
    assert.equal(d.status, 'draft');
    assert.equal(d.summary, '');
    assert.equal(d.repo, DIGEST_REPO);
    assert.deepEqual(checkDigest(d), []);
    assert.deepEqual(checkDigest(digest({ status: 'published', summary: 'Plain words.' })), []);
  });

  it('refuses any field outside the shape, and any missing', () => {
    assert.match(checkDigest({ ...digest(), extra: 1 }).join(), /unknown field "extra"/);
    const { summary: _summary, ...missing } = digest();
    assert.match(checkDigest(missing).join(), /missing field "summary"/);
    assert.deepEqual(checkDigest([]), ['the digest is not an object']);
    assert.deepEqual(checkDigest(null), ['the digest is not an object']);
  });

  it('refuses each wrong value', () => {
    const cases = [
      [{ version: 2 }, /version/],
      [{ month: '2026-13' }, /month/],
      [{ month: '26-11' }, /month/],
      [{ repo: 'someone/else' }, /repo/],
      [{ from: 'abc123' }, /full commit ids/],
      [{ to: HEAD.toUpperCase() }, /full commit ids/],
      [{ to: BASE }, /same commit/],
      [{ toDate: '21/11/2026' }, /toDate/],
      [{ status: 'public' }, /status/],
      [{ summary: 7 }, /summary/],
      [{ summary: 'x'.repeat(LIMITS.summary + 1) }, /summary/],
      [{ status: 'published', summary: '  ' }, /no summary/],
      [{ commits: 0 }, /commits/],
      [{ files: -1 }, /files is not a count/],
      [{ filesCapped: 'no' }, /filesCapped/],
      [{ areas: 'ranking' }, /areas is not a list/],
      [{ areas: [{ area: 'secret-sauce', files: 1, paths: [] }] }, /area is unknown/],
      [
        {
          areas: [
            { area: 'ranking', files: 1, paths: [] },
            { area: 'ranking', files: 1, paths: [] },
          ],
        },
        /repeated/,
      ],
      [{ areas: [{ area: 'ranking', files: 1, paths: [], extra: 1 }] }, /area is unknown/],
      [{ areas: [{ area: 'ranking', files: 0, paths: [] }] }, /files is not a count of at least 1/],
      [{ areas: [{ area: 'ranking', files: 1, paths: [`a${UNSAFE[0]}b`] }] }, /clean file names/],
      [{ areas: [{ area: 'ranking', files: 11, paths: Array.from({ length: 11 }, (_, i) => `p${i}`) }] }, /paths/],
      [{ parameters: Array.from({ length: 51 }, (_, i) => `p_${i}`), parameterCount: 51 }, /parameters/],
      [{ parameters: ['<script>'] }, /parameters/],
      [{ parameters: ['a_b', 'c_d'], parameterCount: 1 }, /parameterCount/],
      [{ messages: [`line${UNSAFE[6]}two`] }, /messages/],
      [{ messages: [''] }, /messages/],
      [{ messages: Array.from({ length: 21 }, (_, i) => `m${i}`) }, /messages/],
    ];
    for (const [change, problem] of cases)
      assert.match(checkDigest(digest(change)).join('; '), problem, JSON.stringify(change));
  });
});

describe('files as Prettier writes them', () => {
  it('writes JSON as Prettier would: short lists on one line, long ones one value per line', async () => {
    const samples = [
      digest(),
      digest({ parameters: [], messages: [], areas: [] }),
      digest({
        parameters: Array.from({ length: 50 }, (_, i) => `rust_home_mixer_parameter_${i}`),
        parameterCount: 80,
      }),
      digest({ messages: ['He said "hi" \\ <b>', 'é ü ✓'] }),
      { nested: { list: [1, 2, 3], empty: {}, words: ['x'.repeat(100), 'y'] } },
    ];
    for (const sample of samples) {
      const text = `${formatJson(sample)}\n`;
      assert.equal(text, await prettierOf(text, 'json'));
      assert.deepEqual(JSON.parse(text), sample);
    }
  });

  it('writes the index as Prettier would, for no file, one, and many', async () => {
    const many = Array.from(
      { length: 30 },
      (_, i) => `20${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    );
    for (const months of [[], ['2026-11'], ['2026-11', '2026-01', '2026-05'], many]) {
      const source = indexSource(months);
      assert.equal(source, await prettierOf(source, 'typescript'), months.join());
    }
    assert.match(indexSource([]), /export const DIGEST_FILES: readonly unknown\[\] = \[\];/);
    const three = indexSource(['2026-11', '2026-01', '2026-05']);
    assert.ok(three.indexOf("'./2026-01.json'") < three.indexOf("'./2026-05.json'"), 'oldest first');
    assert.match(three, /= \[digest202601, digest202605, digest202611\];/);
  });
});

describe('where the next digest starts', () => {
  const entry = (d) => ({ name: `${d.month}.json`, text: formatJson(d) });

  it('is the newest digest’s last commit, whatever the order of the files', () => {
    const files = [
      entry(digest({ month: '2026-08', from: OLD, to: BASE })),
      { name: 'index.ts', text: 'not json' },
      entry(digest({ month: '2026-10', from: BASE, to: HEAD })),
      entry(digest({ month: '2026-09', from: OLD, to: BASE })),
    ];
    assert.deepEqual(latestDigest(files), { month: '2026-10', to: HEAD });
    assert.equal(latestDigest([]), null);
    assert.equal(latestDigest([{ name: 'index.ts', text: '' }]), null);
  });

  it('refuses a broken file rather than move the range', () => {
    assert.throws(() => latestDigest([{ name: '2026-10.json', text: '{' }]), /2026-10.json is not JSON/);
    assert.throws(() => latestDigest([{ name: '2026-10.json', text: '{}' }]), /is not a digest/);
    assert.throws(
      () => latestDigest([{ name: '2026-09.json', text: formatJson(digest({ month: '2026-10' })) }]),
      /holds the digest of 2026-10/,
    );
  });
});

describe('the command line’s options', () => {
  it('reads each option, and takes an empty one as not given', () => {
    assert.deepEqual(parseArgs([]).options, { month: '', from: '', to: '', bodyFile: '' });
    assert.deepEqual(parseArgs(['--month', '2026-05', '--from', BASE, '--to', HEAD, '--body-file', '/tmp/b']).options, {
      month: '2026-05',
      from: BASE,
      to: HEAD,
      bodyFile: '/tmp/b',
    });
    assert.deepEqual(parseArgs(['--month', '', '--from', ' ', '--to', '']).options, {
      month: '',
      from: '',
      to: '',
      bodyFile: '',
    });
  });

  it('refuses an unknown option, one without a value, a bad month or a short commit', () => {
    for (const argv of [
      ['--repo', 'x/y'],
      ['--month'],
      ['--month', '2026-5'],
      ['--from', 'abc1234'],
      ['--to', `${HEAD}0`],
      ['--from', '../../etc'],
    ])
      assert.ok(parseArgs(argv).problem, argv.join(' '));
  });

  it('drafts this month in UTC by default', () => {
    assert.equal(monthOf(new Date('2026-11-30T23:59:59Z')), '2026-11');
    assert.equal(monthOf(new Date('2026-12-01T00:00:00Z')), '2026-12');
  });
});

describe('drafting a digest from GitHub (#430)', () => {
  it('writes the draft and the index after asking GitHub for the newest commit and the comparison only', async () => {
    const store = lastMonth();
    const { fetchFn, calls } = fakeGitHub(usualRoutes());
    const result = await run({ fetch: fetchFn, store, token: 'token-123' });
    assert.equal(result.changed, true);
    assert.equal(result.month, '2026-11');
    assert.deepEqual(
      calls.map((call) => call.url),
      [`${API}commits?per_page=1`, `${API}compare/${BASE}...${HEAD}`],
    );
    for (const { options } of calls) {
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer token-123');
      assert.equal(options.headers.Accept, 'application/vnd.github+json');
    }
    assert.deepEqual(store.writes, ['2026-11.json', 'index.ts']);
    const written = JSON.parse(store.data.get('2026-11.json'));
    assert.deepEqual(checkDigest(written), []);
    assert.deepEqual([written.from, written.to, written.toDate, written.status], [BASE, HEAD, '2026-11-21', 'draft']);
    assert.equal(store.data.get('index.ts'), indexSource(['2026-10', '2026-11']));
    // Only the folder's own digests were read.
    assert.deepEqual(store.reads, ['2026-10.json']);
  });

  it('sends no token when there is none, and asks for `--to` and from `--from` when given', async () => {
    const { fetchFn, calls } = fakeGitHub({
      [`commits?per_page=1&sha=${HEAD}`]: answer(200, [commit('x', HEAD)]),
      [`compare/${OLD}...${HEAD}`]: answer(200, comparison()),
    });
    const store = memoryStore();
    const result = await run({ fetch: fetchFn, store, options: { month: '2026-01', from: OLD, to: HEAD } });
    assert.equal(result.month, '2026-01');
    assert.ok(calls.every(({ options }) => !('Authorization' in options.headers)));
    assert.deepEqual(store.writes, ['2026-01.json', 'index.ts']);
  });

  it('writes nothing when there is no new commit', async () => {
    const store = lastMonth();
    const { fetchFn, calls } = fakeGitHub({ 'commits?per_page=1': answer(200, [commit('same', BASE)]) });
    const result = await run({ fetch: fetchFn, store });
    assert.equal(result.changed, false);
    assert.match(result.reason, /No new commit/);
    assert.equal(calls.length, 1);
    assert.deepEqual(store.writes, []);
  });

  it('writes nothing when GitHub says the range is identical', async () => {
    const store = lastMonth();
    const routes = usualRoutes({
      [`compare/${BASE}...${HEAD}`]: answer(
        200,
        comparison({ status: 'identical', total_commits: 0, commits: [], files: [] }),
      ),
    });
    const result = await run({ fetch: fakeGitHub(routes).fetchFn, store });
    assert.equal(result.changed, false);
    assert.deepEqual(store.writes, []);
  });

  it('stops with no file when the history changed', async () => {
    for (const status of ['diverged', 'behind']) {
      const store = lastMonth();
      const routes = usualRoutes({ [`compare/${BASE}...${HEAD}`]: answer(200, comparison({ status })) });
      await assert.rejects(run({ fetch: fakeGitHub(routes).fetchFn, store }), new RegExp(`is ${status} of`));
      assert.deepEqual(store.writes, []);
    }
  });

  it('stops with no file on a 403, 404, 429 or 500 from GitHub, at either request', async () => {
    for (const status of [403, 404, 429, 500])
      for (const at of ['commits?per_page=1', `compare/${BASE}...${HEAD}`]) {
        const store = lastMonth();
        const routes = usualRoutes({ [at]: answer(status, { message: 'nope' }) });
        await assert.rejects(
          run({ fetch: fakeGitHub(routes).fetchFn, store, token: 'token-123' }),
          (error) =>
            error instanceof DigestError &&
            error.message.includes(`answered ${status}`) &&
            !error.message.includes('token-123'),
        );
        assert.deepEqual(store.writes, [], `${status} at ${at}`);
      }
  });

  it('stops with no file when GitHub can’t be reached or answers something else', async () => {
    const cases = [
      { 'commits?per_page=1': new Error('getaddrinfo ENOTFOUND') },
      { 'commits?per_page=1': answer(200, 'not json') },
      { 'commits?per_page=1': answer(200, []) },
      { 'commits?per_page=1': answer(200, [{ sha: 'short', commit: {} }]) },
      { [`compare/${BASE}...${HEAD}`]: answer(200, { status: 'ahead' }) },
    ];
    for (const routes of cases) {
      const store = lastMonth();
      await assert.rejects(run({ fetch: fakeGitHub(usualRoutes(routes)).fetchFn, store }), DigestError);
      assert.deepEqual(store.writes, []);
    }
    const store = memoryStore();
    const wrong = fakeGitHub({ [`commits?per_page=1&sha=${HEAD}`]: answer(200, [commit('x', BASE)]) });
    await assert.rejects(
      run({ fetch: wrong.fetchFn, store, options: { month: '', from: OLD, to: HEAD } }),
      /answered a{40} for b{40}/,
    );
  });

  it('refuses a month that has a digest, and a first digest with no start, before asking GitHub', async () => {
    const { fetchFn, calls } = fakeGitHub(usualRoutes());
    await assert.rejects(
      run({ fetch: fetchFn, store: lastMonth(), options: { month: '2026-10', from: '', to: '' } }),
      /exists already/,
    );
    await assert.rejects(run({ fetch: fetchFn, store: memoryStore() }), /no digest yet to start from/);
    await assert.rejects(run({ fetch: fetchFn, store: memoryStore({ '2026-10.json': '{' }) }), /is not JSON/);
    assert.equal(calls.length, 0);
  });

  it('reads parameter files GitHub gave no patch for, at both ends of the range, and nothing else', async () => {
    const config = 'home-mixer/params/config.rs';
    const added = 'home-mixer/candidate_pipeline/performance_params.json';
    const content = (text) => answer(200, { encoding: 'base64', content: Buffer.from(text).toString('base64') });
    const rust = (v) => `param!(ReplyWeight, f64, "rust_home_mixer_reply_weight", ${v});\n`;
    const files = [file(config), file(added, { status: 'added' }), file('home-mixer/scorers/big.rs')];
    const { fetchFn, calls } = fakeGitHub(
      usualRoutes({
        [`compare/${BASE}...${HEAD}`]: answer(200, comparison({ files })),
        [`contents/home-mixer/params/config.rs?ref=${BASE}`]: content(rust('5.0')),
        [`contents/home-mixer/params/config.rs?ref=${HEAD}`]: content(rust('4.0')),
        [`contents/home-mixer/candidate_pipeline/performance_params.json?ref=${HEAD}`]: content('{"new_weight": 1}'),
      }),
    );
    const store = lastMonth();
    const result = await run({ fetch: fetchFn, store });
    assert.deepEqual(result.digest.parameters, ['new_weight', 'rust_home_mixer_reply_weight']);
    assert.deepEqual(
      calls.map((c) => c.url.slice(API.length)).filter((u) => u.startsWith('contents/')),
      [
        `contents/home-mixer/params/config.rs?ref=${BASE}`,
        `contents/home-mixer/params/config.rs?ref=${HEAD}`,
        `contents/home-mixer/candidate_pipeline/performance_params.json?ref=${HEAD}`,
      ],
    );
  });

  it('reads a file only by a plain path in the repository, and takes a missing or too large file as none', async () => {
    const { fetchFn, calls } = fakeGitHub({
      [`contents/a/b%20c.rs?ref=${HEAD}`]: answer(200, {
        encoding: 'base64',
        content: Buffer.from('x').toString('base64'),
      }),
      [`contents/big.json?ref=${HEAD}`]: answer(200, { encoding: 'none', content: '' }),
      [`contents/bad.json?ref=${HEAD}`]: answer(500, {}),
    });
    assert.equal(await readFileAt(fetchFn, '', 'a/b c.rs', HEAD), 'x');
    assert.equal(await readFileAt(fetchFn, '', 'gone.rs', HEAD), null);
    assert.equal(await readFileAt(fetchFn, '', 'big.json', HEAD), null);
    await assert.rejects(readFileAt(fetchFn, '', 'bad.json', HEAD), /answered 500/);
    for (const path of ['../secrets', 'a/../../b', '/etc/passwd', 'a//b', './x'])
      await assert.rejects(readFileAt(fetchFn, '', path, HEAD), /Refused to read/);
    await assert.rejects(readFileAt(fetchFn, '', 'a.rs', 'main'), /Refused to read/);
    assert.ok(calls.every((c) => c.url.startsWith(`${API}contents/`)));
  });

  it('asks nothing but GitHub’s API for X’s repository (security)', async () => {
    const urls = [];
    const fetchFn = async (url, options) => {
      urls.push(url);
      return fakeGitHub(usualRoutes()).fetchFn(url, options);
    };
    await run({ fetch: fetchFn, store: lastMonth() });
    assert.ok(urls.length > 0);
    for (const url of urls) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://api.github.com');
      assert.ok(parsed.pathname.startsWith(`/repos/${DIGEST_REPO}/`), url);
    }
    const { fetchFn: only } = fakeGitHub({});
    assert.equal(await askGitHub(only, '', 'missing', { missingOk: true }), null);
  });

  it('keeps hostile text from the repository as cleaned text in the draft', async () => {
    const hostile = [commit(`<script>alert(1)</script>${UNSAFE[7]}gnp.exe`), commit(`${'A'.repeat(300)}`)];
    const files = [file(`home-mixer/scorers/${UNSAFE[0]}evil<img src=x>.rs`)];
    const store = lastMonth();
    const routes = usualRoutes({ [`compare/${BASE}...${HEAD}`]: answer(200, comparison({ commits: hostile, files })) });
    const result = await run({ fetch: fakeGitHub(routes).fetchFn, store });
    const written = JSON.parse(store.data.get('2026-11.json'));
    assert.deepEqual(written, result.digest);
    assert.equal(written.messages[0], '<script>alert(1)</script> gnp.exe');
    assert.equal(Array.from(written.messages[1]).length, LIMITS.text);
    assert.deepEqual(written.areas[0].paths, ['home-mixer/scorers/ evil<img src=x>.rs']);
    for (const char of UNSAFE) assert.ok(!store.data.get('2026-11.json').includes(char));
  });

  it('describes the pull request with the range, the issue and the reasons pr-policy asks for', () => {
    const body = pullRequestBody(digest());
    assert.match(body, /Part of #430/);
    assert.match(body, /^- No changelog: .+/m);
    assert.match(body, /^- No scenarios: .+/m);
    assert.match(body, new RegExp(`https://github.com/${DIGEST_REPO}/compare/${BASE}\\.\\.\\.${HEAD}`));
    assert.match(body, /`ranking` \(1\), `parameters` \(1\)/);
    assert.match(body, /Set `status` to `"published"`/);
    assert.match(pullRequestBody(digest({ areas: [], filesCapped: true })), /Areas: none/);
  });
});

/**
 * Runs the command line as the workflow does, in a copy of the tooling folder so nothing is written to this
 * repository, with `fetch` replaced by one that answers from `routes` (a path under the repository's API → status
 * and body) and logs each URL. Returns the exit status, the output, the files written and the step outputs.
 */
function runCommandLine({ routes, args = [], files = {}, token = 'token-123' }) {
  const dir = mkdtempSync(join(tmpdir(), 'xomoni-digest-'));
  mkdirSync(join(dir, 'tooling'));
  for (const name of ['algorithm-digest.mjs', 'algorithm-digest-lib.mjs'])
    copyFileSync(join(ROOT, 'tooling', name), join(dir, 'tooling', name));
  const data = join(dir, DATA_DIR);
  mkdirSync(data, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(data, name), text);
  writeFileSync(join(dir, 'routes.json'), JSON.stringify(routes));
  writeFileSync(
    join(dir, 'fake-fetch.mjs'),
    `import { appendFileSync, readFileSync } from 'node:fs';
const routes = JSON.parse(readFileSync(${JSON.stringify(join(dir, 'routes.json'))}, 'utf8'));
globalThis.fetch = async (url) => {
  appendFileSync(${JSON.stringify(join(dir, 'urls.log'))}, url + '\\n');
  const route = routes[url.slice(${JSON.stringify(API)}.length)];
  if (!url.startsWith(${JSON.stringify(API)}) || !route) return { status: 404, json: async () => ({}) };
  return { status: route.status, json: async () => route.body };
};
`,
  );
  const outputs = join(dir, 'outputs');
  writeFileSync(outputs, '');
  const result = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(join(dir, 'fake-fetch.mjs')).href, join(dir, 'tooling/algorithm-digest.mjs'), ...args],
    { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_TOKEN: token, GITHUB_OUTPUT: outputs } },
  );
  const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
  const written = readdirSync(data).sort();
  const urls = read(join(dir, 'urls.log')).split('\n').filter(Boolean);
  const steps = read(outputs);
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, written, outputs: steps, urls };
}

describe('the command line, as the workflow runs it', () => {
  const last = { '2026-10.json': `${formatJson(digest({ month: '2026-10', from: OLD, to: BASE }))}\n` };
  const routes = {
    'commits?per_page=1': { status: 200, body: [commit('newest', HEAD)] },
    [`compare/${BASE}...${HEAD}`]: { status: 200, body: comparison() },
  };

  it('drafts, writes the description and tells the workflow which month changed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xomoni-body-'));
    const bodyFile = join(dir, 'body.md');
    const run = runCommandLine({ routes, files: last, args: ['--month', '2026-11', '--body-file', bodyFile] });
    try {
      assert.equal(run.status, 0, run.output);
      assert.deepEqual(run.written, ['2026-10.json', '2026-11.json', 'index.ts']);
      assert.equal(run.outputs, 'changed=true\nmonth=2026-11\n');
      assert.match(readFileSync(bodyFile, 'utf8'), /Part of #430/);
      assert.ok(run.urls.every((url) => url.startsWith(API)));
      assert.doesNotMatch(run.output, /token-123/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes nothing and says so when there is no new commit', () => {
    const same = { 'commits?per_page=1': { status: 200, body: [commit('same', BASE)] } };
    const run = runCommandLine({ routes: same, files: last });
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.written, ['2026-10.json']);
    assert.equal(run.outputs, 'changed=false\n');
    assert.match(run.output, /::notice::No new commit/);
  });

  it('fails with no file and no output on an error from GitHub, without printing the token', () => {
    for (const status of [403, 404, 500]) {
      const broken = { ...routes, [`compare/${BASE}...${HEAD}`]: { status, body: { message: 'token-123' } } };
      const run = runCommandLine({ routes: broken, files: last });
      assert.equal(run.status, 1, run.output);
      assert.match(run.output, new RegExp(`::error::GitHub answered ${status}`));
      assert.deepEqual(run.written, ['2026-10.json']);
      assert.equal(run.outputs, '');
      assert.doesNotMatch(run.output, /token-123/);
    }
  });

  it('refuses a bad option before asking anything', () => {
    const run = runCommandLine({ routes, files: last, args: ['--from', 'not-a-commit'] });
    assert.equal(run.status, 1);
    assert.match(run.output, /Usage: node tooling\/algorithm-digest\.mjs/);
    assert.deepEqual(run.urls, []);
  });
});

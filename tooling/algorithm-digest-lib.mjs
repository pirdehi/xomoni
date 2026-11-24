// The monthly digest of X's open ranking code (#430, ADR-0046): the rules of tooling/algorithm-digest.mjs, kept apart
// from its command line so tooling/algorithm-digest.test.mjs can test them with a fake GitHub.
//
// The digest is made from public code only: X's repository `xai-org/x-algorithm`, read through GitHub's public REST
// API. It reads the newest commit and the comparison between the last digested commit and it (and both commits' trees
// when GitHub's comparison stops at 300 files, and parameter files it gives no patch for), sorts the changed files
// into areas, lists the parameters whose lines changed, and writes a draft (`status: "draft"`) for a maintainer to
// review, write up in plain English and publish. No X data, no Xomoni user's data, no cookie and no analytics take part.
//
// Everything that comes from the repository (commit messages, file names, parameter names) is untrusted text: it is
// cut to 200 characters, control and direction characters are removed, and the draft is checked against a strict
// shape before it is written. Node's built-ins only, so the workflow job that runs it installs nothing.

/** The one repository a digest is made from: X's open-source recommendation code, Apache-2.0. */
export const DIGEST_REPO = 'xai-org/x-algorithm';

/** GitHub's REST API, the only host the digest asks anything of. */
export const GITHUB_API = 'https://api.github.com';

/** Where the digests live, relative to the repository's root: one `<yyyy-mm>.json` per month, and `index.ts`. */
export const DATA_DIR = 'apps/web/src/modules/algorithm/data';

/** The version of a digest file's shape. The website refuses any other. */
export const DIGEST_VERSION = 1;

/** The limits of a digest, the same as the website's `parseDigest` checks. */
export const LIMITS = Object.freeze({
  /** Characters of one commit message, file name or parameter name, once cleaned. */
  text: 200,
  /** Distinct commit messages kept, in order. */
  messages: 20,
  /** Parameter names kept; `parameterCount` says how many changed in all. */
  parameters: 50,
  /** File names kept for each area; its `files` says how many changed in all. */
  paths: 10,
  /** Characters of the maintainer's summary. */
  summary: 2000,
});

/** The areas a changed file can fall in, in the order a digest lists them. `other` is a path no rule knows. */
export const AREAS = Object.freeze([
  'ranking',
  'filters',
  'candidate-sources',
  'ads-blending',
  'content-understanding',
  'parameters',
  'docs',
  'other',
]);

/**
 * Which area a path of `xai-org/x-algorithm` falls in: the first rule that matches wins, so parameter files count as
 * parameters wherever they sit. The rules follow the repository's layout as of November 2026 (`home-mixer`, `phoenix`,
 * `thunder`, `visibility-filtering`, `grox` and the rest). When X moves its paths, these change in the same pull
 * request as the next digest (ADR-0046).
 */
export const AREA_RULES = Object.freeze([
  { area: 'docs', test: /(^|\/)docs\/|(^|\/)(README|LICENSE|NOTICE|CONTRIBUTING)[^/]*$|\.(md|txt)$/i },
  {
    area: 'parameters',
    test: /(^|\/)params?(\/|\.[a-z]+$)|(^|\/)[^/]*_params?\.[a-z]+$|(^|\/)feature_switches?(\/|\.)/i,
  },
  { area: 'ads-blending', test: /(^|\/)ads(\/|_)|(^|\/)[^/]*ads?_blend/i },
  {
    area: 'filters',
    test: /(^|\/)filters?\/|^(visibility-filtering|safety-label|takedowns|abuse-|adult-content|pnsfwmedia|botmaker|scarecrow|user-cred|under-the-hood)/i,
  },
  {
    area: 'candidate-sources',
    test: /(^|\/)(sources|candidate_pipeline|candidate_hydrators|query_hydrators)\/|^(candidate-pipeline|thunder|simclusters)(\/|$)/i,
  },
  {
    area: 'ranking',
    test: /(^|\/)(scorers|selectors|models)\/|^(phoenix|vm-ranker|xai-value-model)/i,
  },
  { area: 'content-understanding', test: /^(grox|clip|media-model-proxy|agatha|bdsm)(\/|$)/i },
]);

/** An error the command line reports as it is, with a non-zero exit code and no file written. */
export class DigestError extends Error {
  /** Names the error, for the command line. */
  constructor(message) {
    super(message);
    this.name = 'DigestError';
  }
}

/**
 * Whether a character is unsafe to keep: a control character (C0, DEL and C1), a zero-width mark, a line or paragraph
 * separator, one of Unicode's direction overrides and isolates, or a byte-order mark. None survives cleaning.
 */
function unsafe(char) {
  const code = char.codePointAt(0) ?? 0;
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/**
 * Untrusted text as a digest keeps it: its first line only, unsafe characters turned into spaces, spaces collapsed,
 * and at most `max` characters (counting each emoji as one), the last one an ellipsis when it was cut. Not a string:
 * an empty one.
 */
export function cleanText(value, max = LIMITS.text) {
  if (typeof value !== 'string') return '';
  const line = value.split(/\r\n|\r|\n/, 1)[0] ?? '';
  const text = Array.from(line, (char) => (unsafe(char) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

/** The area of one changed path (see `AREA_RULES`). */
export function areaOf(path) {
  return AREA_RULES.find((rule) => rule.test.test(path))?.area ?? 'other';
}

/** A parameter's name as a digest keeps it: a letter, then letters, digits, `_`, `.` or `-`, at most 80 in all. */
export const PARAMETER_NAME = /^[A-Za-z][\w.-]{1,79}$/;

/** `param!(Name, type, "string_name", default)`, X's macro for a feature switch, on one line. */
const PARAM_MACRO = /param!\(\s*([A-Za-z]\w*)(?:\s*,\s*[^,"]+,\s*"([A-Za-z][\w.-]*)")?/;
/** A quoted name alone on a line, as in a `param!(` that spans lines, or a list of names. */
const QUOTED_LINE = /^\s*"([A-Za-z][\w.-]*)"\s*,?\s*$/;
/** A JSON key: `"name": value`. */
const JSON_KEY = /^\s*"([A-Za-z][\w.-]*)"\s*:/;
/** A Rust or Scala constant: `pub const NAME: T = …` or `val NAME = …`. */
const CONSTANT = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const|static|val|final\s+val)\s+([A-Z][A-Z0-9_]+)\b/;
/** A YAML or TOML key with a value on the same line. */
const CONFIG_KEY = /^\s*([A-Za-z][\w.-]*)\s*[:=]\s*\S/;

/**
 * The names of the parameters whose lines changed in one file of a comparison, from its patch: a `param!` (on one
 * line, or across lines when any of its lines changed: its quoted name, else its Rust name), a JSON key, a constant, or
 * a YAML or TOML key. A file without a patch (binary, or too large for GitHub to show) gives none.
 */
export function parameterNames(file) {
  const patch = typeof file?.patch === 'string' ? file.patch : '';
  const config = /\.(ya?ml|toml)$/i.test(String(file?.filename ?? ''));
  const names = [];
  let block = null;
  for (const raw of patch.split('\n')) {
    const mark = raw[0];
    if (mark !== '+' && mark !== '-' && mark !== ' ') continue;
    const line = raw.slice(1);
    const changed = mark !== ' ';
    if (block || /param!\(/.test(line)) {
      block ??= { names: [], changed: false };
      const macro = PARAM_MACRO.exec(line);
      if (macro?.[2]) block.names.unshift(macro[2]);
      else if (macro?.[1]) block.names.push(macro[1]);
      const quoted = QUOTED_LINE.exec(line)?.[1];
      if (quoted) block.names.unshift(quoted);
      block.changed ||= changed;
      if (/\)\s*;?\s*$/.test(line)) {
        if (block.changed && block.names[0]) names.push(block.names[0]);
        block = null;
      }
      continue;
    }
    if (!changed) continue;
    const name =
      JSON_KEY.exec(line)?.[1] ??
      CONSTANT.exec(line)?.[1] ??
      (config ? CONFIG_KEY.exec(line)?.[1] : undefined) ??
      QUOTED_LINE.exec(line)?.[1];
    if (name) names.push(name);
  }
  if (block?.changed && block.names[0]) names.push(block.names[0]);
  return names.filter((name) => PARAMETER_NAME.test(name));
}

/** GitHub lists at most 300 files in a comparison; a range that touched more is summarized from those. */
export const COMPARE_FILE_CAP = 300;

const COMPARE_STATUSES = new Set(['ahead', 'behind', 'identical', 'diverged']);

/**
 * What a comparison (`GET /repos/{owner}/{repo}/compare/{base}...{head}`) says, as a digest keeps it: its status, how
 * many commits and files, whether GitHub cut the file list, the areas touched (each with how many files and up to 10
 * of their names), the parameters that changed (up to 50, sorted, with how many in all; `extraNames` adds those read
 * from the files GitHub gave no patch for) and the distinct commit messages (up to 20, in order). Throws a
 * `DigestError` for an answer not shaped as GitHub's.
 * `complete` says the file list is whole, from `treeDiff`, rather than GitHub's, which stops at 300.
 */
export function summarizeCompare(json, extraNames = [], { complete = false } = {}) {
  if (!json || typeof json !== 'object') throw new DigestError('GitHub’s comparison is not an object.');
  const { status, total_commits: commits, files = [], commits: list = [] } = json;
  if (!COMPARE_STATUSES.has(status)) throw new DigestError(`GitHub’s comparison has an unknown status: ${status}.`);
  if (!Number.isInteger(commits) || commits < 0) throw new DigestError('GitHub’s comparison has no commit count.');
  if (!Array.isArray(files) || !Array.isArray(list)) throw new DigestError('GitHub’s comparison has no file list.');
  const byArea = new Map();
  const parameters = new Set(extraNames.map((name) => cleanText(name)));
  for (const file of files) {
    const path = cleanText(file?.filename);
    if (!path) throw new DigestError('GitHub’s comparison lists a file with no name.');
    const area = areaOf(path);
    const entry = byArea.get(area) ?? { area, files: 0, paths: [] };
    entry.files += 1;
    entry.paths.push(path);
    byArea.set(area, entry);
    // Only parameter files, and feature switches wherever they are declared: elsewhere a constant isn't a parameter.
    if (area === 'parameters' || /param!\(/.test(String(file?.patch ?? '')))
      for (const name of parameterNames(file)) parameters.add(cleanText(name));
  }
  const areas = AREAS.filter((area) => byArea.has(area)).map((area) => {
    const entry = byArea.get(area);
    return { area, files: entry.files, paths: [...new Set(entry.paths)].sort().slice(0, LIMITS.paths) };
  });
  const names = [...parameters].filter((name) => PARAMETER_NAME.test(name)).sort();
  const messages = [];
  for (const commit of list) {
    const message = cleanText(commit?.commit?.message);
    if (message && !messages.includes(message)) messages.push(message);
    if (messages.length === LIMITS.messages) break;
  }
  return {
    status,
    commits,
    files: files.length,
    filesCapped: !complete && files.length >= COMPARE_FILE_CAP,
    areas,
    parameters: names.slice(0, LIMITS.parameters),
    parameterCount: names.length,
    messages,
  };
}

/** At most this many parameter files are read whole when GitHub gives no patch for them, two requests each. */
export const MAX_FILES_READ = 20;

/**
 * The parameter files of a comparison that GitHub listed without a patch (a large comparison leaves patches out), up to
 * `MAX_FILES_READ`: each `{ path, before, after }`, the path to read at the base commit (its old name when renamed;
 * null when added) and at the head (null when removed). Their names are then read from both versions.
 */
export function unpatchedParameterFiles(json) {
  const files = Array.isArray(json?.files) ? json.files : [];
  return files
    .filter((file) => typeof file?.filename === 'string' && typeof file.patch !== 'string')
    .filter((file) => areaOf(file.filename) === 'parameters')
    .slice(0, MAX_FILES_READ)
    .map((file) => ({
      path: file.filename,
      before: file.status === 'added' ? null : (file.previous_filename ?? file.filename),
      after: file.status === 'removed' ? null : file.filename,
    }));
}

/**
 * Each parameter a file's text defines, by name, with the text that defines it: a JSON file's top-level keys and their
 * values; otherwise each `param!` (its quoted name, else its Rust name, with the whole macro), each JSON-style key,
 * constant, and YAML or TOML key with its line. Text that isn't valid JSON in a `.json` file defines nothing.
 */
export function definitions(text, filename) {
  const found = new Map();
  if (/\.json$/i.test(filename)) {
    try {
      const json = JSON.parse(text);
      if (json && typeof json === 'object' && !Array.isArray(json))
        for (const [key, value] of Object.entries(json)) found.set(key, JSON.stringify(value));
    } catch {
      // Not JSON: no parameter can be named from it.
    }
    return found;
  }
  const config = /\.(ya?ml|toml)$/i.test(filename);
  let block = null;
  for (const line of text.split('\n')) {
    if (block || /param!\(/.test(line)) {
      block ??= { names: [], lines: [] };
      block.lines.push(line.trim());
      const macro = PARAM_MACRO.exec(line);
      if (macro?.[2]) block.names.unshift(macro[2]);
      else if (macro?.[1]) block.names.push(macro[1]);
      const quoted = QUOTED_LINE.exec(line)?.[1];
      if (quoted) block.names.unshift(quoted);
      if (/\)\s*;?\s*$/.test(line)) {
        if (block.names[0]) found.set(block.names[0], block.lines.join(' '));
        block = null;
      }
      continue;
    }
    const name = JSON_KEY.exec(line)?.[1] ?? CONSTANT.exec(line)?.[1] ?? (config ? CONFIG_KEY.exec(line)?.[1] : null);
    if (name) found.set(name, line.trim());
  }
  return found;
}

/** The names a file defines differently in `before` and `after` (either may be null: the file is new or gone). */
export function changedParameters(before, after, filename) {
  const a = before == null ? new Map() : definitions(before, filename);
  const b = after == null ? new Map() : definitions(after, filename);
  return [...new Set([...a.keys(), ...b.keys()])].filter((name) => a.get(name) !== b.get(name)).sort();
}

/**
 * Every file that differs between two trees of the repository (`GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`),
 * as a comparison lists files: `{ filename, status }`, added, removed or modified, sorted by path, with no patch. Used
 * when GitHub's comparison stops at 300 files, so a digest names every area the range touched. Null when either tree
 * is cut short by GitHub (`truncated`) or isn't shaped as one: the comparison's own list is kept then.
 */
export function treeDiff(before, after) {
  const blobs = (tree) => {
    if (!tree || tree.truncated !== false || !Array.isArray(tree.tree)) return null;
    const map = new Map();
    for (const entry of tree.tree) {
      if (entry?.type !== 'blob') continue;
      if (typeof entry.path !== 'string' || typeof entry.sha !== 'string') return null;
      map.set(entry.path, entry.sha);
    }
    return map;
  };
  const a = blobs(before);
  const b = blobs(after);
  if (!a || !b) return null;
  const files = [];
  for (const [path, sha] of b) {
    if (!a.has(path)) files.push({ filename: path, status: 'added' });
    else if (a.get(path) !== sha) files.push({ filename: path, status: 'modified' });
  }
  for (const path of a.keys()) if (!b.has(path)) files.push({ filename: path, status: 'removed' });
  return files.sort((x, y) => (x.filename < y.filename ? -1 : 1));
}

/** A month as a digest names it: `yyyy-mm`. */
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** A full commit id, as a digest keeps it. */
export const COMMIT = /^[0-9a-f]{40}$/;
/** A day, `yyyy-mm-dd`. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The month of `date` in UTC, `yyyy-mm`: the month a scheduled run drafts. */
export function monthOf(date) {
  return date.toISOString().slice(0, 7);
}

/**
 * A draft digest of the range `from`…`to` for `month`, from a comparison's summary (`summarizeCompare`): no summary
 * yet, and `status: "draft"`, so the website shows nothing until a maintainer writes the summary and publishes it.
 */
export function draftDigest({ month, from, to, toDate, compare }) {
  return {
    version: DIGEST_VERSION,
    month,
    repo: DIGEST_REPO,
    from,
    to,
    toDate,
    status: 'draft',
    summary: '',
    commits: compare.commits,
    files: compare.files,
    filesCapped: compare.filesCapped,
    areas: compare.areas,
    parameters: compare.parameters,
    parameterCount: compare.parameterCount,
    messages: compare.messages,
  };
}

/** Every field of a digest, in the order its file lists them. No other field is allowed. */
export const DIGEST_FIELDS = Object.freeze(Object.keys(draftDigest({ compare: {} })));

const isCount = (value, min = 0) => Number.isInteger(value) && value >= min;
const isText = (value, max = LIMITS.text) =>
  typeof value === 'string' && value !== '' && cleanText(value, max) === value;

/**
 * What is wrong with a digest, as a list of problems (empty when nothing is): the website's `parseDigest` checks the
 * same shape. Exactly the fields of `DIGEST_FIELDS`; a month, two different full commit ids and a day; `draft` or
 * `published`, with a summary of at most 2,000 characters that a published digest must have; counts; known areas,
 * each once, with clean file names; clean parameter names and commit messages, within their limits.
 */
export function checkDigest(digest) {
  if (!digest || typeof digest !== 'object' || Array.isArray(digest)) return ['the digest is not an object'];
  const problems = [];
  const keys = Object.keys(digest);
  for (const key of keys) if (!DIGEST_FIELDS.includes(key)) problems.push(`unknown field "${key}"`);
  for (const key of DIGEST_FIELDS) if (!keys.includes(key)) problems.push(`missing field "${key}"`);
  const d = digest;
  if (d.version !== DIGEST_VERSION) problems.push(`version is not ${DIGEST_VERSION}`);
  if (!MONTH.test(String(d.month))) problems.push('month is not yyyy-mm');
  if (d.repo !== DIGEST_REPO) problems.push(`repo is not ${DIGEST_REPO}`);
  if (!COMMIT.test(String(d.from)) || !COMMIT.test(String(d.to))) problems.push('from and to are not full commit ids');
  else if (d.from === d.to) problems.push('from and to are the same commit');
  if (!DAY.test(String(d.toDate))) problems.push('toDate is not yyyy-mm-dd');
  if (d.status !== 'draft' && d.status !== 'published') problems.push('status is neither draft nor published');
  if (typeof d.summary !== 'string' || Array.from(d.summary).length > LIMITS.summary)
    problems.push(`summary is not text of at most ${LIMITS.summary} characters`);
  else if (d.status === 'published' && !d.summary.trim()) problems.push('a published digest has no summary');
  if (!isCount(d.commits, 1)) problems.push('commits is not a count of at least 1');
  if (!isCount(d.files)) problems.push('files is not a count');
  if (typeof d.filesCapped !== 'boolean') problems.push('filesCapped is not true or false');
  if (!Array.isArray(d.areas)) problems.push('areas is not a list');
  else {
    const seen = new Set();
    for (const entry of d.areas) {
      const fields = entry && typeof entry === 'object' ? Object.keys(entry).sort().join() : '';
      if (fields !== 'area,files,paths' || !AREAS.includes(entry.area) || seen.has(entry.area)) {
        problems.push('an area is unknown, repeated or not { area, files, paths }');
        continue;
      }
      seen.add(entry.area);
      if (!isCount(entry.files, 1)) problems.push(`${entry.area}: files is not a count of at least 1`);
      if (!Array.isArray(entry.paths) || entry.paths.length > LIMITS.paths || !entry.paths.every((p) => isText(p)))
        problems.push(`${entry.area}: paths are not up to ${LIMITS.paths} clean file names`);
    }
  }
  if (
    !Array.isArray(d.parameters) ||
    d.parameters.length > LIMITS.parameters ||
    !d.parameters.every((name) => typeof name === 'string' && PARAMETER_NAME.test(name))
  )
    problems.push(`parameters are not up to ${LIMITS.parameters} names`);
  else if (!isCount(d.parameterCount, d.parameters.length)) problems.push('parameterCount is less than the names');
  if (!Array.isArray(d.messages) || d.messages.length > LIMITS.messages || !d.messages.every((m) => isText(m)))
    problems.push(`messages are not up to ${LIMITS.messages} clean lines`);
  return problems;
}

/** Prettier's line width in this repository (`.prettierrc.json`): a list that fits stays on one line. */
const WIDTH = 120;

/**
 * A digest as Prettier would write it, so `npm run format:check` passes on a file the workflow wrote without running
 * any dependency: objects one key per line, a list of plain values on one line when it fits in 120 columns, else one
 * value per line. Ends without a newline.
 */
export function formatJson(value, indent = '', prefix = 0, last = true) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((item) => item === null || typeof item !== 'object')) {
      const flat = `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
      if (prefix + flat.length + (last ? 0 : 1) <= WIDTH) return flat;
    }
    const items = value.map((item, i) => `${inner}${formatJson(item, inner, inner.length, i === value.length - 1)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  const lines = entries.map(([key, item], i) => {
    const head = `${inner}${JSON.stringify(key)}: `;
    return `${head}${formatJson(item, inner, head.length, i === entries.length - 1)}`;
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/** The name `data/index.ts` imports a month's file under: `digest202611` for `2026-11`. */
const importName = (month) => `digest${month.replace('-', '')}`;

/**
 * The source of `data/index.ts` for the digest files of `months`, oldest first: one import per file and the list of
 * them, written as Prettier writes it. The website checks each with `parseDigest` before showing any.
 */
export function indexSource(months) {
  const sorted = [...months].sort();
  const imports = sorted.map((month) => `import ${importName(month)} from './${month}.json';\n`).join('');
  const head = 'export const DIGEST_FILES: readonly unknown[] = ';
  const flat = `[${sorted.map(importName).join(', ')}];`;
  const list =
    head.length + flat.length <= WIDTH ? flat : `[\n${sorted.map((month) => `  ${importName(month)},\n`).join('')}];`;
  return [
    '// Written by `node tooling/algorithm-digest.mjs` from the digest files beside it (ADR-0046): don’t edit it by hand.',
    '// Each file is untrusted until the module’s `parseDigest` has checked it.',
    ...(imports ? [imports.trimEnd(), ''] : []),
    '/** Every digest file in this folder, oldest month first, as read from disk and not yet checked. */',
    `${head}${list}`,
    '',
  ].join('\n');
}

/**
 * The newest digest among `files` (each `{ name, text }`, the folder's `<yyyy-mm>.json` files), as `{ month, to }`:
 * where the next comparison starts. Null when there is none. Throws a `DigestError` for a file that isn't a digest, so
 * a broken file never moves the range silently.
 */
export function latestDigest(files) {
  const digests = files
    .filter(({ name }) => /^\d{4}-\d{2}\.json$/.test(name))
    .map(({ name, text }) => {
      let digest;
      try {
        digest = JSON.parse(text);
      } catch {
        throw new DigestError(`${name} is not JSON.`);
      }
      const problems = checkDigest(digest);
      if (problems.length) throw new DigestError(`${name} is not a digest: ${problems.join('; ')}.`);
      if (`${digest.month}.json` !== name) throw new DigestError(`${name} holds the digest of ${digest.month}.`);
      return digest;
    })
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  const newest = digests.at(-1);
  return newest ? { month: newest.month, to: newest.to } : null;
}

/**
 * The command line's options: `--month yyyy-mm`, `--from <commit>`, `--to <commit>` and `--body-file <path>`, each
 * optional; an empty value counts as not given, as a workflow passes an input left blank. Returns them, or a problem.
 */
export function parseArgs(argv) {
  const options = { month: '', from: '', to: '', bodyFile: '' };
  const flags = { '--month': 'month', '--from': 'from', '--to': 'to', '--body-file': 'bodyFile' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = flags[argv[i]];
    if (!key || i + 1 >= argv.length) return { problem: `Unknown or incomplete option: ${argv[i]}` };
    options[key] = String(argv[i + 1]).trim();
  }
  if (options.month && !MONTH.test(options.month)) return { problem: `--month is not yyyy-mm: ${options.month}` };
  for (const key of ['from', 'to'])
    if (options[key] && !COMMIT.test(options[key])) return { problem: `--${key} is not a full commit id (40 hex).` };
  return { options };
}

/** The headers of every request: GitHub's JSON, its API version, a name, and the workflow's token when there is one. */
function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'xomoni-algorithm-digest',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** What to say for a status GitHub answered with instead of 200. */
function failure(status, path) {
  const why =
    status === 403 || status === 429
      ? 'refused or rate-limited'
      : status === 404
        ? 'not found: the repository or a commit may be gone or private'
        : 'failed';
  return new DigestError(`GitHub answered ${status} for ${path}: ${why}. Nothing was written.`);
}

/**
 * Asks GitHub's API for `path` under `xai-org/x-algorithm` and returns its JSON. Only `https://api.github.com/repos/
 * xai-org/x-algorithm/…` is ever asked, with no redirect followed. Throws a `DigestError` for any other status than
 * 200 (a 404 is null with `missingOk`), a network failure or an answer that isn't JSON.
 */
export async function askGitHub(fetchFn, token, path, { missingOk = false } = {}) {
  const url = `${GITHUB_API}/repos/${DIGEST_REPO}/${path}`;
  let response;
  try {
    response = await fetchFn(url, { headers: headers(token), redirect: 'error' });
  } catch (error) {
    throw new DigestError(`Couldn't reach GitHub for ${path}: ${cleanText(String(error?.message ?? error))}`);
  }
  if (missingOk && response.status === 404) return null;
  if (response.status !== 200) throw failure(response.status, path);
  try {
    return await response.json();
  } catch {
    throw new DigestError(`GitHub's answer for ${path} is not JSON.`);
  }
}

/** The commit `ref` names (the default branch when empty), as `{ sha, day }`, from GitHub's list of commits. */
async function commitOf(fetchFn, token, ref) {
  const list = await askGitHub(fetchFn, token, `commits?per_page=1${ref ? `&sha=${ref}` : ''}`);
  const commit = Array.isArray(list) ? list[0] : null;
  const sha = commit?.sha;
  const day = String(commit?.commit?.committer?.date ?? commit?.commit?.author?.date ?? '').slice(0, 10);
  if (!COMMIT.test(String(sha)) || !DAY.test(day)) throw new DigestError('GitHub’s newest commit has no id or date.');
  if (ref && sha !== ref) throw new DigestError(`GitHub answered ${sha} for ${ref}.`);
  return { sha, day };
}

/**
 * The text of the file at `path` in commit `ref`, from GitHub's contents API, or null when the file isn't there or is
 * too large for the API to send. Each part of the path is encoded, and a path that climbs (`..`) is refused.
 */
export async function readFileAt(fetchFn, token, path, ref) {
  const parts = String(path).split('/');
  if (!COMMIT.test(String(ref)) || parts.some((part) => !part || part === '.' || part === '..'))
    throw new DigestError(`Refused to read ${cleanText(String(path))}: not a plain path in the repository.`);
  const json = await askGitHub(fetchFn, token, `contents/${parts.map(encodeURIComponent).join('/')}?ref=${ref}`, {
    missingOk: true,
  });
  if (json?.encoding !== 'base64' || typeof json.content !== 'string') return null;
  return Buffer.from(json.content, 'base64').toString('utf8');
}

/**
 * Drafts this month's digest, or says there is nothing to draft. `store` is the data folder: `list()` its file names,
 * `read(name)` and `write(name, text)`. With no new commit since the last digest it writes nothing; for a month that
 * has a digest already, or any error from GitHub, it throws a `DigestError` before writing anything. Otherwise it
 * writes `<month>.json` and `index.ts`, and returns the draft.
 */
export async function draft({ options, token, fetch: fetchFn, store, now }) {
  const month = options.month || monthOf(now);
  const names = store.list();
  if (names.includes(`${month}.json`))
    throw new DigestError(`${DATA_DIR}/${month}.json exists already. Pass another --month, or remove its draft first.`);
  const latest = latestDigest(names.map((name) => ({ name, text: name.endsWith('.json') ? store.read(name) : '' })));
  const from = options.from || latest?.to;
  if (!from) throw new DigestError('There is no digest yet to start from: pass --from <commit>.');
  const head = await commitOf(fetchFn, token, options.to);
  if (head.sha === from) return { changed: false, reason: `No new commit in ${DIGEST_REPO} since ${from}.` };
  let json = await askGitHub(fetchFn, token, `compare/${from}...${head.sha}`);
  // GitHub lists 300 files at most, alphabetically, which can leave whole areas out: the two trees name them all.
  let complete = false;
  if (Array.isArray(json?.files) && json.files.length >= COMPARE_FILE_CAP) {
    const before = await askGitHub(fetchFn, token, `git/trees/${from}?recursive=1`);
    const after = await askGitHub(fetchFn, token, `git/trees/${head.sha}?recursive=1`);
    const files = treeDiff(before, after);
    if (files) {
      json = { ...json, files };
      complete = true;
    }
  }
  const extra = [];
  for (const file of unpatchedParameterFiles(json)) {
    const before = file.before ? await readFileAt(fetchFn, token, file.before, from) : null;
    const after = file.after ? await readFileAt(fetchFn, token, file.after, head.sha) : null;
    extra.push(...changedParameters(before, after, file.path));
  }
  const compare = summarizeCompare(json, extra, { complete });
  if (compare.status === 'identical' || compare.commits === 0)
    return { changed: false, reason: `No new commit in ${DIGEST_REPO} since ${from}.` };
  if (compare.status !== 'ahead')
    throw new DigestError(`${head.sha} is ${compare.status} of ${from}: the history changed. Pass --from <commit>.`);
  const digest = draftDigest({ month, from, to: head.sha, toDate: head.day, compare });
  const problems = checkDigest(digest);
  if (problems.length) throw new DigestError(`The draft is not a digest: ${problems.join('; ')}.`);
  const months = [...names.filter((name) => MONTH.test(name.replace(/\.json$/, ''))), `${month}.json`];
  store.write(`${month}.json`, `${formatJson(digest)}\n`);
  store.write('index.ts', indexSource(months.map((name) => name.replace(/\.json$/, ''))));
  return { changed: true, month, digest };
}

/** The issue the digest is built under, which each draft's pull request names. */
export const DIGEST_ISSUE = 430;

/**
 * The description of a draft's pull request: what changed, what the maintainer does before merging, and the reasons
 * pr-policy asks for with the `no-changelog` and `no-scenarios` labels. Only cleaned text from the draft goes in.
 */
export function pullRequestBody(digest) {
  const range = `https://github.com/${DIGEST_REPO}/compare/${digest.from}...${digest.to}`;
  const areas = digest.areas.map(({ area, files }) => `\`${area}\` (${files})`).join(', ') || 'none';
  return [
    '## What and why',
    '',
    `The draft of the algorithm digest for ${digest.month}, written by the monthly workflow from X's public repository ` +
      `\`${DIGEST_REPO}\` only (ADR-0046): ${digest.commits} commits and ${digest.files} files` +
      `${digest.filesCapped ? ' (GitHub lists 300 at most)' : ''}, up to ${digest.toDate}.`,
    '',
    `- Range: ${range}`,
    `- Areas: ${areas}`,
    `- Parameters that changed: ${digest.parameterCount}`,
    '',
    `Part of #${DIGEST_ISSUE}`,
    '',
    '- No changelog: a content update of xomoni.com/algorithm, no behavior changes.',
    '- No scenarios: a content update; the page’s scenarios cover every digest.',
    '',
    '## Before merging (maintainer)',
    '',
    '- [ ] Read the range on GitHub and check each area against the files it lists.',
    '- [ ] Write `summary` in plain English: what changed in the structure, never the weights, which aren’t public. ' +
      'Every claim names a file of the range. See `docs/guides/ALGORITHM-DIGEST.md`.',
    '- [ ] Set `status` to `"published"`, push, and merge when every check is green.',
    '',
    'A pull request opened by GitHub Actions starts no checks: pushing the summary starts them.',
    '',
  ].join('\n');
}

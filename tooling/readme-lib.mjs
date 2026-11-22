// The README's feature list and status, written from one registry (#337, ADR-0039). `docs/features.json` holds every
// feature Xomoni ships, in English and Persian; `npm run readme` writes the generated blocks of README.md and
// README.fa.md from it, and `npm run readme:check` (part of `npm run verify`) fails when they differ, when the registry
// is invalid, or when CHANGELOG.md names an issue under *Added* that no feature claims. The command line is
// tooling/readme.mjs; tooling/readme.test.mjs tests these helpers. Pure functions only: the caller reads the files.

/** Where each area's features are listed, in this order: what runs in the browser first. */
export const FEATURE_AREAS = ['extension', 'both', 'website'];

/** `shipped`: people can use it. `preview`: built, and waiting on something outside the code, such as a store. */
export const FEATURE_STATUSES = ['shipped', 'preview'];

/** The README each language is written into. */
export const README_FILES = { en: 'README.md', fa: 'README.fa.md' };

/**
 * Features that shipped before the scenarios gate (ADR-0038, #338) and have no scenarios file yet: only these may
 * have `"scenarios": null`. This list may only shrink. #345 writes their scenarios one feature at a time, and each
 * leaves the list when its file lands (the check fails while a feature with a file is still listed). A new feature
 * never joins it: it names its `docs/scenarios/<issue>-<slug>.md` from the start.
 */
export const LEGACY_FEATURES = Object.freeze([
  'preview-before-acting',
  'beyond-profile-limit',
  'verified-actions',
  'login-handoff',
  'resumable-jobs',
  'keeps-going',
  'x-archive',
  'library',
  'archive-date-range',
  'watch',
  'dashboard',
  'daily-numbers',
  'move-your-data',
  'private-by-design',
  'live-job-status',
  'website-actions',
  'website-cleanup-plan',
  'website-library',
  'website-settings',
  'comments',
  'numbers-on-website',
  'store-install',
  'welcome',
  'website-dashboard',
  'website-analytics',
  'reports',
  'send-to-computer',
  'phone-menu',
  // Grandfathered once: #335 was opened before the scenarios cut-over of 2026-11-22 (ADR-0038) and merged as this
  // registry landed. It gets its file in #345 like the others.
  'two-step-verification',
]);

const REGISTRY = 'docs/features.json';
const RELEASE_URL = 'https://github.com/pirdehi/xomoni/releases/tag/v';
const VERSION = /^\d+\.\d+\.\d+$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCENARIOS = /^docs\/scenarios\/(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const FEATURE_KEYS = ['id', 'area', 'status', 'since', 'issues', 'scenarios', 'en', 'fa'];
const TOP_KEYS = new Set(['$comment', 'features', 'notFeatures']);
// `#123`, but not `&#123;` or the end of a link such as `RELEASING.md#key-302`.
const ISSUE = /(?<![\w&])#(\d+)\b/g;

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isIssue = (value) => Number.isInteger(value) && value > 0;
const persianDigits = (text) => String(text).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * Orders two versions from CHANGELOG.md or `since`: negative when `a` came first. `unreleased` comes after every
 * version, since it is what the next release will be.
 */
export function compareVersions(a, b) {
  const parts = (v) => (v === 'unreleased' ? [Infinity] : v.split('.').map(Number));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The `## [...]` sections of a Keep a Changelog file, top to bottom: `name` is `unreleased` or the version, `date` the
 * one after it (or null), and `lines` what the section holds.
 */
export function changelogSections(changelog) {
  const sections = [];
  for (const line of changelog.split('\n')) {
    const heading = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (heading) {
      const name = heading[1].toLowerCase() === 'unreleased' ? 'unreleased' : heading[1];
      sections.push({ name, date: heading[2] ?? null, lines: [] });
    } else if (line.startsWith('## ')) sections.push({ name: line.slice(3).trim(), date: null, lines: [] });
    else sections.at(-1)?.lines.push(line);
  }
  return sections;
}

/** The newest released version in CHANGELOG.md and its date (`{ version, date }`), or null when it has none. */
export function latestRelease(changelog) {
  const section = changelogSections(changelog).find(({ name }) => VERSION.test(name));
  return section ? { version: section.name, date: section.date } : null;
}

/**
 * Every issue number written under a `### Added` heading, mapped to the sections that name it (`unreleased` or a
 * version), top to bottom. Every number counts, cross-references included: each must belong to a feature or be exempt.
 */
export function changelogAddedIssues(changelog) {
  const issues = new Map();
  for (const { name, lines } of changelogSections(changelog)) {
    let added = false;
    for (const line of lines) {
      if (line.startsWith('### ')) added = /^### Added\s*$/.test(line);
      else if (added)
        for (const [, number] of line.matchAll(ISSUE)) {
          const sections = issues.get(Number(number)) ?? [];
          if (!sections.includes(name)) sections.push(name);
          issues.set(Number(number), sections);
        }
    }
  }
  return issues;
}

/** The problems with one `{ title, summary }` text of a feature, as `field: what` strings. */
function textProblems(text, lang) {
  if (!isObject(text)) return [`"${lang}" must be an object with "title" and "summary"`];
  const problems = Object.keys(text)
    .filter((key) => key !== 'title' && key !== 'summary')
    .map((key) => `"${lang}" has an unknown field "${key}"`);
  for (const key of ['title', 'summary']) {
    const value = text[key];
    if (typeof value !== 'string' || !value.trim()) problems.push(`"${lang}.${key}" must be non-empty text`);
    else if (/[\n\r]|<!--/.test(value) || value !== value.trim())
      problems.push(`"${lang}.${key}" must be one line, without surrounding spaces or HTML comments`);
  }
  if (typeof text.title === 'string' && /[:.]$/.test(text.title))
    problems.push(`"${lang}.title" must not end with ":" or "." (the README adds the colon)`);
  return problems;
}

/**
 * Everything wrong with the registry, as lines that name `docs/features.json` and the feature. Checks each feature's
 * fields; unique ids; `scenarios` (an existing `docs/scenarios/<issue>-<slug>.md` of one of its issues, or null for a
 * legacy feature only); and, against CHANGELOG.md, that every issue under *Added* belongs to a feature or to an
 * exemption in `notFeatures`, that no exemption is stale, and that `since` names a version the changelog has, no later
 * than the first one whose *Added* names the feature's issues. `exists(path)` says whether a repository file exists;
 * `legacy` is LEGACY_FEATURES unless a test gives its own.
 */
export function registryProblems(registry, { changelog, exists, legacy = LEGACY_FEATURES }) {
  const problems = [];
  const fail = (message) => problems.push(`${REGISTRY}: ${message}`);
  if (!isObject(registry) || !Array.isArray(registry.features)) {
    fail('must be an object with a "features" list');
    return problems;
  }
  for (const key of Object.keys(registry)) if (!TOP_KEYS.has(key)) fail(`unknown top-level field "${key}"`);

  const sections = changelogSections(changelog);
  const versions = new Set(sections.map(({ name }) => name));
  const added = changelogAddedIssues(changelog);
  const ids = new Set();
  const owners = new Map();

  registry.features.forEach((feature, index) => {
    const name = isObject(feature) && typeof feature.id === 'string' ? `"${feature.id}"` : `#${index + 1}`;
    const bad = (message) => fail(`feature ${name}: ${message}`);
    if (!isObject(feature)) return bad('must be an object');
    for (const key of FEATURE_KEYS) if (!(key in feature)) bad(`missing "${key}"`);
    for (const key of Object.keys(feature)) if (!FEATURE_KEYS.includes(key)) bad(`unknown field "${key}"`);

    const { id, area, status, since, issues, scenarios } = feature;
    if (typeof id !== 'string' || !ID.test(id)) bad('"id" must be a kebab-case slug, such as "keep-rules"');
    else if (ids.has(id)) bad('"id" is used by another feature');
    else ids.add(id);
    if (!FEATURE_AREAS.includes(area)) bad(`"area" must be one of ${FEATURE_AREAS.join(', ')}`);
    if (!FEATURE_STATUSES.includes(status)) bad(`"status" must be one of ${FEATURE_STATUSES.join(', ')}`);

    const validIssues = Array.isArray(issues) && issues.every(isIssue);
    if (!validIssues) bad('"issues" must be a list of issue numbers (positive whole numbers)');
    else {
      if (new Set(issues).size !== issues.length) bad('"issues" lists a number twice');
      for (const issue of issues) if (!owners.has(issue)) owners.set(issue, id);
    }

    if (since !== 'unreleased' && !(typeof since === 'string' && VERSION.test(since)))
      bad('"since" must be a version such as "0.4.0", or "unreleased"');
    else if (!versions.has(since))
      bad(`"since" is ${since}, but CHANGELOG.md has no [${since === 'unreleased' ? 'Unreleased' : since}] section`);
    else if (validIssues) {
      const first = issues
        .flatMap((issue) => (added.get(issue) ?? []).map((version) => ({ issue, version })))
        .sort((a, b) => compareVersions(a.version, b.version))[0];
      if (first && compareVersions(since, first.version) > 0)
        bad(
          `"since" is ${since}, but CHANGELOG.md names #${first.issue} under ### Added in [${first.version}]: set "since" to ${first.version}`,
        );
    }

    const isLegacy = legacy.includes(id);
    if (scenarios === null) {
      if (!isLegacy) bad(`"scenarios" must name its file, docs/scenarios/<issue>-<slug>.md (ADR-0038)`);
    } else if (typeof scenarios !== 'string' || !SCENARIOS.test(scenarios)) {
      bad('"scenarios" must be docs/scenarios/<issue>-<slug>.md, or null for a legacy feature');
    } else {
      const issue = Number(SCENARIOS.exec(scenarios)[1]);
      if (validIssues && !issues.includes(issue)) bad(`"scenarios" names #${issue}, which is not in its "issues"`);
      if (!exists(scenarios)) bad(`"scenarios" names ${scenarios}, which doesn't exist`);
      if (isLegacy)
        bad(
          'has a scenarios file now: remove it from LEGACY_FEATURES in tooling/readme-lib.mjs (that list only shrinks)',
        );
    }
    if (!isLegacy && validIssues && issues.length === 0) bad('"issues" must name the issue that built it');

    textProblems(feature.en, 'en').forEach(bad);
    textProblems(feature.fa, 'fa').forEach(bad);
  });

  for (const id of legacy)
    if (!ids.has(id))
      problems.push(`tooling/readme-lib.mjs: LEGACY_FEATURES lists "${id}", which ${REGISTRY} doesn't have: remove it`);

  const exempt = new Set();
  const notFeatures = registry.notFeatures ?? [];
  if (!Array.isArray(notFeatures)) fail('"notFeatures" must be a list of { "issue", "reason" }');
  else
    notFeatures.forEach((entry, index) => {
      const bad = (message) => fail(`notFeatures #${index + 1}: ${message}`);
      if (!isObject(entry)) return bad('must be { "issue", "reason" }');
      for (const key of Object.keys(entry)) if (key !== 'issue' && key !== 'reason') bad(`unknown field "${key}"`);
      if (typeof entry.reason !== 'string' || !entry.reason.trim()) bad('"reason" must say why it is not a feature');
      if (!isIssue(entry.issue)) return bad('"issue" must be an issue number (a positive whole number)');
      if (exempt.has(entry.issue)) bad(`exempts #${entry.issue} twice`);
      exempt.add(entry.issue);
      if (owners.has(entry.issue))
        bad(`exempts #${entry.issue}, which feature "${owners.get(entry.issue)}" lists: keep one of them`);
      if (!added.has(entry.issue))
        bad(`exempts #${entry.issue}, which no ### Added section of CHANGELOG.md names: remove the stale exemption`);
    });

  for (const [issue, where] of added)
    if (!owners.has(issue) && !exempt.has(issue))
      problems.push(
        `CHANGELOG.md names #${issue} under ### Added in [${where[0]}], but no feature in ${REGISTRY} lists it: add it to a feature's "issues", or to "notFeatures" with a reason`,
      );
  return problems;
}

/** What each language's generated text says: area headings, the tags after a title, and their legend. */
const WORDS = {
  en: {
    areas: { extension: 'In the extension', both: 'The extension with xomoni.com', website: 'On xomoni.com' },
    next: 'next release',
    preview: 'preview',
    nextLegend: "on `main`, and in Xomoni's next release; xomoni.com has its part already.",
    previewLegend: 'built, and waiting on something outside the code, such as the stores listing Xomoni.',
    separator: ', ',
  },
  fa: {
    areas: { extension: 'در افزونه', both: 'افزونه همراه با xomoni.com', website: 'در xomoni.com' },
    next: 'نسخه‌ی بعد',
    preview: 'پیش‌نمایش',
    nextLegend: 'روی `main` است و با نسخه‌ی بعدی به Xomoni می‌رسد؛ بخش مربوط به xomoni.com از همین حالا روی سایت است.',
    previewLegend: 'ساخته شده، ولی منتظر چیزی بیرون از کد است؛ مثلاً منتشر شدن Xomoni در فروشگاه‌ها.',
    separator: '، ',
  },
};

/**
 * The tags after a feature's title: *next release* while the extension still has to ship it (xomoni.com deploys
 * every merge, so a website-only feature never waits for a release), and *preview*.
 */
function tagsOf(feature) {
  const tags = [];
  if (feature.since === 'unreleased' && feature.area !== 'website') tags.push('next');
  if (feature.status === 'preview') tags.push('preview');
  return tags;
}

/**
 * The feature list of one README (`lang` is `en` or `fa`): a heading per area, each feature as
 * `- **Title:** summary` in the registry's order, and a legend for the tags used. Takes a valid registry.
 */
export function renderFeatures(registry, lang) {
  const words = WORDS[lang];
  const out = [];
  const used = new Set();
  for (const area of FEATURE_AREAS) {
    const features = registry.features.filter((feature) => feature.area === area);
    if (!features.length) continue;
    if (out.length) out.push('');
    out.push(`### ${words.areas[area]}`, '');
    for (const feature of features) {
      const { title, summary } = feature[lang];
      const tags = tagsOf(feature);
      tags.forEach((tag) => used.add(tag));
      out.push(
        tags.length
          ? `- **${title}** *(${tags.map((tag) => words[tag]).join(words.separator)})*: ${summary}`
          : `- **${title}:** ${summary}`,
      );
    }
  }
  const legend = ['next', 'preview']
    .filter((tag) => used.has(tag))
    .map((tag) => `*(${words[tag]})*: ${words[`${tag}Legend`]}`);
  if (legend.length) out.push('', legend.join(' '));
  return out.join('\n');
}

/**
 * The status of one README: the newest release in CHANGELOG.md, with its date and a link to it, and how many features
 * Xomoni has, and how many came after that release. Throws when the changelog has no dated release.
 */
export function renderStatus(registry, changelog, lang) {
  const latest = latestRelease(changelog);
  if (!latest) throw new Error('CHANGELOG.md has no released version (## [X.Y.Z] - YYYY-MM-DD)');
  if (!latest.date) throw new Error(`CHANGELOG.md's [${latest.version}] has no date (## [X.Y.Z] - YYYY-MM-DD)`);
  const { version, date } = latest;
  const link = `[${version}](${RELEASE_URL}${version})`;
  const total = registry.features.length;
  const newer = registry.features.filter((feature) => feature.since === 'unreleased').length;
  if (lang === 'fa') {
    const head = `**آخرین نسخه: ${link}، ${persianDigits(date)}.**`;
    return newer
      ? `${head} Xomoni در مجموع ${persianDigits(total)} قابلیت دارد (فهرستشان بالاتر آمده) که ${persianDigits(newer)} تا از آن‌ها بعد از ${version} اضافه شده‌اند. سایت xomoni.com هر تغییر را به محض merge شدن دارد و افزونه آن را با نسخه‌ی بعدی می‌گیرد.`
      : `${head} Xomoni در مجموع ${persianDigits(total)} قابلیت دارد (فهرستشان بالاتر آمده) که همه منتشر شده‌اند.`;
  }
  const head = `**Latest release: ${link}, ${date}.**`;
  return newer
    ? `${head} Xomoni has ${total} [features](#features), ${newer} of them added since ${version}. xomoni.com gets a change as soon as it is merged; the extension, with the next release.`
    : `${head} Xomoni has ${total} [features](#features), all of them released.`;
}

const begin = (name) => `<!-- BEGIN GENERATED: ${name} (npm run readme) -->`;
const end = (name) => `<!-- END GENERATED: ${name} -->`;

/** The text between a generated block's markers, without the blank lines around it; null when the block is missing. */
export function blockContent(text, name) {
  const from = text.indexOf(begin(name));
  const to = text.indexOf(end(name));
  if (from < 0 || to < from) return null;
  return text.slice(from + begin(name).length, to).trim();
}

/**
 * `text` with the generated block `name` holding `content`, and everything outside its markers untouched. Throws
 * when a marker is missing, repeated or out of order, so nothing is written into the wrong place.
 */
export function replaceBlock(text, name, content) {
  const [open, close] = [begin(name), end(name)];
  const from = text.indexOf(open);
  const to = text.indexOf(close);
  if (from < 0) throw new Error(`has no ${open} marker`);
  if (to < 0) throw new Error(`has no ${close} marker`);
  if (text.indexOf(open, from + 1) >= 0 || text.indexOf(close, to + 1) >= 0)
    throw new Error(`has the "${name}" markers more than once`);
  if (to < from) throw new Error(`has ${close} before ${open}`);
  return `${text.slice(0, from + open.length)}\n\n${content}\n\n${text.slice(to)}`;
}

/** One README (`lang` is `en` or `fa`) with its features and status blocks written. Throws as `replaceBlock` does. */
export function generateReadme(text, registry, changelog, lang) {
  const withFeatures = replaceBlock(text, 'features', renderFeatures(registry, lang));
  return replaceBlock(withFeatures, 'status', renderStatus(registry, changelog, lang));
}

/** The version a README's status block names, from its release link; null when there is no block or no link. */
export function statusVersion(readme) {
  const status = blockContent(readme, 'status');
  const match = status && /releases\/tag\/v(\d+\.\d+\.\d+)/.exec(status);
  return match ? match[1] : null;
}

/**
 * What `npm run readme` would write, and what is wrong. `readmes` maps each file in README_FILES to its text, and the
 * rest is as for `registryProblems`.
 * `problems` holds the registry's problems (then nothing is generated) or each README's missing markers;
 * `expected` maps each README that could be generated to its new text, and `stale` lists those that differ from it.
 */
export function readmeReport({ registry, changelog, readmes, exists, legacy = LEGACY_FEATURES }) {
  const problems = registryProblems(registry, { changelog, exists, legacy });
  const expected = {};
  const stale = [];
  if (problems.length) return { problems, expected, stale };
  for (const [lang, file] of Object.entries(README_FILES)) {
    const text = readmes[file];
    if (typeof text !== 'string') {
      problems.push(`${file}: missing`);
      continue;
    }
    try {
      expected[file] = generateReadme(text, registry, changelog, lang);
      if (expected[file] !== text) stale.push(file);
    } catch (error) {
      problems.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { problems, expected, stale };
}

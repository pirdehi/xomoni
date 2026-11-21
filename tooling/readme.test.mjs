// Tests for tooling/readme-lib.mjs (#337, ADR-0039), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`:
// the generated blocks of README.md and README.fa.md, and every way the registry can be wrong or fall out of step
// with CHANGELOG.md. The last suite checks the repository's own registry and READMEs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_FEATURES,
  README_FILES,
  blockContent,
  changelogAddedIssues,
  changelogSections,
  compareVersions,
  generateReadme,
  latestRelease,
  readmeReport,
  registryProblems,
  renderFeatures,
  renderStatus,
  replaceBlock,
  statusVersion,
} from './readme-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- **Reports** (#257), with a link to [releasing](docs/RELEASING.md#the-fixed-id-key-302) and an entity &#38;.

### Fixed

- A crash (#999).

## [0.2.0] - 2026-11-14

### Added

- Pairing (#151, after #44).
- security.txt (#150).

### Changed

- The look (#207).

## [0.1.0] - 2026-10-30

- First version (#1).
`;

/** The legacy features of these tests: they may have no scenarios file. */
const LEGACY = ['cleanup-by-date', 'update-notice'];

/** A valid feature; `overrides` replace its fields. A legacy id, so it may have no scenarios file. */
const feature = (overrides = {}) => ({
  id: 'cleanup-by-date',
  area: 'extension',
  status: 'shipped',
  since: '0.1.0',
  issues: [],
  scenarios: null,
  en: { title: 'Bulk cleanup by date', summary: 'delete what is older than a date.' },
  fa: { title: 'پاک‌سازی گروهی', summary: 'حذف موارد قدیمی‌تر از یک تاریخ.' },
  ...overrides,
});

/** A registry whose features claim every issue CHANGELOG names under Added, so it is valid as it is. */
const registry = (overrides = {}) => ({
  features: [
    feature(),
    feature({ id: 'update-notice', area: 'both', since: '0.2.0', issues: [151, 44] }),
    feature({
      id: 'monthly-report',
      area: 'website',
      since: 'unreleased',
      issues: [257],
      scenarios: 'docs/scenarios/257-reports.md',
      en: { title: 'Reports', summary: 'weekly and monthly.' },
      fa: { title: 'گزارش‌ها', summary: 'هفتگی و ماهانه.' },
    }),
  ],
  notFeatures: [{ issue: 150, reason: 'how vulnerabilities are reported, not a feature' }],
  ...overrides,
});

const allExist = () => true;
const problemsOf = (value, exists = allExist, changelog = CHANGELOG) =>
  registryProblems(value, { changelog, exists, legacy: LEGACY });

const README = `# Xomoni

## Features

<!-- BEGIN GENERATED: features (npm run readme) -->
old list
<!-- END GENERATED: features -->

| Screenshots stay outside |

## Project status

<!-- BEGIN GENERATED: status (npm run readme) -->
Xomoni is an early release (v0.1).
<!-- END GENERATED: status -->

X changes its web app often.
`;

describe('the changelog (#337)', () => {
  it('reads its sections, with dates', () => {
    assert.deepEqual(
      changelogSections(CHANGELOG).map(({ name, date }) => [name, date]),
      [
        ['unreleased', null],
        ['0.2.0', '2026-11-14'],
        ['0.1.0', '2026-10-30'],
      ],
    );
    assert.deepEqual(latestRelease(CHANGELOG), { version: '0.2.0', date: '2026-11-14' });
    assert.equal(latestRelease('# Changelog\n\n## [Unreleased]\n'), null);
  });

  it('collects every issue under ### Added, and nothing under other headings, link anchors or entities', () => {
    const added = changelogAddedIssues(CHANGELOG);
    assert.deepEqual(
      [...added.keys()].sort((a, b) => a - b),
      [44, 150, 151, 257],
    );
    assert.deepEqual(added.get(257), ['unreleased']);
    assert.deepEqual(added.get(151), ['0.2.0']);
  });

  it('lists each section once for an issue named in several', () => {
    const twice =
      '## [Unreleased]\n\n### Added\n\n- A (#5), again #5.\n\n## [0.1.0] - 2026-01-01\n\n### Added\n\n- B (#5).\n';
    assert.deepEqual(changelogAddedIssues(twice).get(5), ['unreleased', '0.1.0']);
  });

  it('orders versions, with unreleased last', () => {
    assert.ok(compareVersions('0.2.0', '0.10.0') < 0);
    assert.ok(compareVersions('1.0.0', '0.9.9') > 0);
    assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
    assert.ok(compareVersions('unreleased', '99.0.0') > 0);
  });
});

describe('a valid registry (#337)', () => {
  it('has no problems', () => {
    assert.deepEqual(problemsOf(registry()), []);
  });

  it('needs no notFeatures when every Added issue is a feature', () => {
    const { notFeatures: _unused, ...rest } = registry();
    assert.deepEqual(problemsOf(rest, allExist, CHANGELOG.replace('- security.txt (#150).\n', '')), []);
  });
});

describe('an invalid registry is refused, naming the file and the feature (#337)', () => {
  const only = (value) => problemsOf(value).filter((problem) => !problem.startsWith('tooling/'));

  it('refuses anything but an object with a features list', () => {
    for (const bad of [null, [], {}, { features: {} }])
      assert.deepEqual(problemsOf(bad), ['docs/features.json: must be an object with a "features" list']);
    assert.match(problemsOf(registry({ extra: 1 })).join('\n'), /unknown top-level field "extra"/);
  });

  it('names each missing or unknown field', () => {
    const { since: _since, ...withoutSince } = feature();
    const problems = only(registry({ features: [withoutSince, feature({ id: 'update-notice', color: 'blue' })] }));
    assert.ok(problems.some((p) => /feature "cleanup-by-date": missing "since"/.test(p)));
    assert.ok(problems.some((p) => /feature "update-notice": unknown field "color"/.test(p)));
    assert.ok(problems.every((p) => p.startsWith('docs/features.json: ') || p.startsWith('CHANGELOG.md')));
  });

  it('refuses a feature that is not an object', () => {
    assert.match(problemsOf(registry({ features: ['x'] })).join('\n'), /feature #1: must be an object/);
  });

  it('wants unique kebab-case ids', () => {
    const base = registry();
    assert.match(
      problemsOf({ ...base, features: [...base.features, feature()] }).join('\n'),
      /feature "cleanup-by-date": "id" is used by another feature/,
    );
    assert.match(
      problemsOf(registry({ features: [feature({ id: 'Bulk Cleanup' })] })).join('\n'),
      /"id" must be a kebab-case slug/,
    );
  });

  it('wants a known area and status', () => {
    const text = problemsOf(registry({ features: [feature({ area: 'mobile', status: 'beta' })] })).join('\n');
    assert.match(text, /"area" must be one of extension, both, website/);
    assert.match(text, /"status" must be one of shipped, preview/);
  });

  it('wants since to be a version the changelog has, or unreleased', () => {
    for (const since of ['v0.2.0', '0.2', 'next', 2])
      assert.match(problemsOf(registry({ features: [feature({ since })] })).join('\n'), /"since" must be a version/);
    assert.match(
      problemsOf(registry({ features: [feature({ since: '0.3.0' })] })).join('\n'),
      /"since" is 0\.3\.0, but CHANGELOG.md has no \[0\.3\.0\] section/,
    );
    assert.match(
      problemsOf(
        registry({ features: [feature({ since: 'unreleased' })] }),
        allExist,
        '## [0.1.0] - 2026-01-01\n',
      ).join('\n'),
      /CHANGELOG.md has no \[Unreleased\] section/,
    );
  });

  it('wants since no later than the first release whose Added names its issues', () => {
    const base = registry();
    base.features[1] = { ...base.features[1], since: 'unreleased' };
    assert.match(
      problemsOf(base).join('\n'),
      /feature "update-notice": "since" is unreleased, but CHANGELOG.md names #\d+ under ### Added in \[0\.2\.0\]: set "since" to 0\.2\.0/,
    );
    base.features[1] = { ...base.features[1], since: '0.1.0' };
    assert.deepEqual(problemsOf(base), [], 'an earlier since is fine: the feature grew later');
  });

  it('wants issues to be positive whole numbers, once each', () => {
    for (const issues of [[0], [-3], [1.5], ['12'], 12, null])
      assert.match(
        problemsOf(registry({ features: [feature({ issues })] })).join('\n'),
        /"issues" must be a list of issue numbers/,
      );
    assert.match(
      problemsOf(registry({ features: [feature({ issues: [7, 7] })] })).join('\n'),
      /"issues" lists a number twice/,
    );
  });

  it('wants both languages, each with a one-line title and summary', () => {
    const text = problemsOf(
      registry({
        features: [
          feature({ fa: undefined }),
          feature({ id: 'keep-rules', en: { title: '', summary: 'x' } }),
          feature({ id: 'watch', en: { title: 'Watch', summary: 'two\nlines' } }),
          feature({ id: 'library', en: { title: 'Library:', summary: 'x', note: 'y' } }),
          feature({ id: 'dashboard', en: { title: 'Dash', summary: 'x <!-- END GENERATED: features -->' } }),
        ],
      }),
    ).join('\n');
    assert.match(text, /"cleanup-by-date": "fa" must be an object with "title" and "summary"/);
    assert.match(text, /"keep-rules": "en.title" must be non-empty text/);
    assert.match(text, /"watch": "en.summary" must be one line/);
    assert.match(text, /"library": "en.title" must not end with ":"/);
    assert.match(text, /"library": "en" has an unknown field "note"/);
    assert.match(text, /"dashboard": "en.summary" must be one line, without surrounding spaces or HTML comments/);
  });
});

describe('scenarios files (#337, ADR-0038)', () => {
  const NEW = { id: 'monthly-report', since: 'unreleased', issues: [257] };

  it('must exist when named', () => {
    const exists = (path) => path !== 'docs/scenarios/257-reports.md';
    assert.match(
      problemsOf(registry(), exists).join('\n'),
      /feature "monthly-report": "scenarios" names docs\/scenarios\/257-reports.md, which doesn't exist/,
    );
  });

  it('must be docs/scenarios/<issue>-<slug>.md, for one of its own issues', () => {
    for (const scenarios of ['docs/scenarios/reports.md', 'scenarios/257-reports.md', 'docs/scenarios/257-Reports.md'])
      assert.match(
        problemsOf(registry({ features: [feature({ ...NEW, scenarios })] })).join('\n'),
        /"scenarios" must be docs\/scenarios\/<issue>-<slug>.md/,
      );
    assert.match(
      problemsOf(registry({ features: [feature({ ...NEW, scenarios: 'docs/scenarios/258-reports.md' })] })).join('\n'),
      /"scenarios" names #258, which is not in its "issues"/,
    );
  });

  it('may be null only for a legacy feature', () => {
    assert.ok(LEGACY_FEATURES.includes('keep-rules'));
    assert.ok(!LEGACY_FEATURES.includes('brand-new'));
    assert.match(
      registryProblems(registry(), { changelog: CHANGELOG, exists: allExist, legacy: ['cleanup-by-date'] }).join('\n'),
      /feature "update-notice": "scenarios" must name its file/,
    );
    const base = registry();
    base.features.push(feature({ id: 'brand-new', since: 'unreleased', issues: [400] }));
    assert.match(problemsOf(base).join('\n'), /feature "brand-new": "scenarios" must name its file/);
  });

  it('a new feature names the issue that built it', () => {
    const base = registry();
    base.features.push(feature({ id: 'brand-new', since: 'unreleased', scenarios: 'docs/scenarios/400-x.md' }));
    const text = problemsOf(base).join('\n');
    assert.match(text, /feature "brand-new": "scenarios" names #400, which is not in its "issues"/);
    assert.match(text, /feature "brand-new": "issues" must name the issue that built it/);
  });

  it('takes a legacy feature off the list once it has its file: the list only shrinks', () => {
    const base = registry();
    base.features[0] = { ...base.features[0], issues: [12], scenarios: 'docs/scenarios/12-cleanup.md' };
    assert.match(
      problemsOf(base).join('\n'),
      /feature "cleanup-by-date": has a scenarios file now: remove it from LEGACY_FEATURES/,
    );
  });

  it('names a legacy id that is no longer in the registry', () => {
    assert.match(
      problemsOf({ features: [feature()] }).join('\n'),
      /tooling\/readme-lib.mjs: LEGACY_FEATURES lists "update-notice", which docs\/features.json doesn't have: remove it/,
    );
  });
});

describe('the registry against CHANGELOG.md (#337)', () => {
  it('fails for an issue under Added that no feature lists', () => {
    const base = registry();
    base.features[2] = { ...base.features[2], issues: [256], scenarios: 'docs/scenarios/256-reports.md' };
    assert.match(
      problemsOf(base).join('\n'),
      /CHANGELOG.md names #257 under ### Added in \[unreleased\], but no feature in docs\/features.json lists it: add it to a feature's "issues", or to "notFeatures" with a reason/,
    );
  });

  it('takes an exemption with a reason instead', () => {
    const base = registry();
    base.features[2] = { ...base.features[2], issues: [256], scenarios: 'docs/scenarios/256-reports.md' };
    base.notFeatures.push({ issue: 257, reason: 'not something people use' });
    assert.deepEqual(problemsOf(base), []);
  });

  it('ignores issues under other headings and in a section without Added', () => {
    const text = problemsOf(registry()).join('\n');
    for (const number of [999, 207, 1]) assert.doesNotMatch(text, new RegExp(`#${number}\\b`));
  });

  it('fails for a stale exemption', () => {
    assert.match(
      problemsOf(registry({ notFeatures: [{ issue: 999, reason: 'a fix, not a feature' }] })).join('\n'),
      /notFeatures #1: exempts #999, which no ### Added section of CHANGELOG.md names: remove the stale exemption/,
    );
  });

  it('fails for an exemption without a reason, twice, or of an issue a feature lists', () => {
    const changelog = CHANGELOG.replace('(#257)', '(#257, #302)');
    const text = registryProblems(
      registry({
        notFeatures: [
          { issue: 302, reason: '' },
          { issue: 302, reason: 'again' },
          { issue: 151, reason: 'also a feature' },
          { issue: 'x', reason: 'not a number' },
          { issue: 5, reason: 'r', why: 'extra' },
          'nope',
        ],
      }),
      { changelog, exists: allExist },
    ).join('\n');
    assert.match(text, /notFeatures #1: "reason" must say why it is not a feature/);
    assert.match(text, /notFeatures #2: exempts #302 twice/);
    assert.match(text, /notFeatures #3: exempts #151, which feature "update-notice" lists: keep one of them/);
    assert.match(text, /notFeatures #4: "issue" must be an issue number/);
    assert.match(text, /notFeatures #5: unknown field "why"/);
    assert.match(text, /notFeatures #6: must be \{ "issue", "reason" \}/);
    assert.match(problemsOf(registry({ notFeatures: {} })).join('\n'), /"notFeatures" must be a list/);
  });
});

describe('the generated blocks (#337)', () => {
  it('lists features by area, in the registry order, with tags and their legend', () => {
    const value = registry();
    value.features.push(
      feature({ id: 'store', area: 'both', status: 'preview', since: 'unreleased', issues: [304] }),
      feature({ id: 'move', since: 'unreleased', en: { title: 'Move', summary: 'one file.' } }),
    );
    assert.equal(
      renderFeatures(value, 'en'),
      [
        '### In the extension',
        '',
        '- **Bulk cleanup by date:** delete what is older than a date.',
        '- **Move** *(next release)*: one file.',
        '',
        '### The extension with xomoni.com',
        '',
        '- **Bulk cleanup by date:** delete what is older than a date.',
        '- **Bulk cleanup by date** *(next release, preview)*: delete what is older than a date.',
        '',
        '### On xomoni.com',
        '',
        '- **Reports:** weekly and monthly.',
        '',
        "*(next release)*: on `main`, and in Xomoni's next release; xomoni.com has its part already. *(preview)*: built, and waiting on something outside the code, such as the stores listing Xomoni.",
      ].join('\n'),
    );
    const fa = renderFeatures(value, 'fa');
    assert.match(fa, /^### در افزونه\n\n- \*\*پاک‌سازی گروهی:\*\* حذف موارد/);
    assert.match(fa, /\*\(نسخه‌ی بعد، پیش‌نمایش\)\*: /);
    assert.match(fa, /### در xomoni.com\n\n- \*\*گزارش‌ها:\*\* هفتگی و ماهانه\./);
  });

  it('leaves out empty areas and the legend when no tag is used', () => {
    assert.equal(
      renderFeatures({ features: [feature()] }, 'en'),
      '### In the extension\n\n- **Bulk cleanup by date:** delete what is older than a date.',
    );
  });

  it('writes the status from the newest release, with a link and the counts', () => {
    assert.equal(
      renderStatus(registry(), CHANGELOG, 'en'),
      '**Latest release: [0.2.0](https://github.com/pirdehi/xomoni/releases/tag/v0.2.0), 2026-11-14.** Xomoni has 3 [features](#features), 1 of them added since 0.2.0. xomoni.com gets a change as soon as it is merged; the extension, with the next release.',
    );
    const fa = renderStatus(registry(), CHANGELOG, 'fa');
    assert.match(
      fa,
      /^\*\*آخرین نسخه: \[0\.2\.0\]\(https:\/\/github.com\/pirdehi\/xomoni\/releases\/tag\/v0\.2\.0\)، ۲۰۲۶-۱۱-۱۴\.\*\*/,
    );
    assert.match(fa, /در مجموع ۳ قابلیت دارد .* که ۱ تا از آن‌ها بعد از 0\.2\.0 اضافه شده‌اند/);
  });

  it('says when every feature is released', () => {
    const released = { features: [feature()] };
    assert.match(
      renderStatus(released, CHANGELOG, 'en'),
      /Xomoni has 1 \[features\]\(#features\), all of them released\.$/,
    );
    assert.match(renderStatus(released, CHANGELOG, 'fa'), /که همه منتشر شده‌اند\.$/);
  });

  it('refuses a changelog without a dated release', () => {
    assert.throws(() => renderStatus(registry(), '## [Unreleased]\n', 'en'), /has no released version/);
    assert.throws(() => renderStatus(registry(), '## [0.1.0]\n', 'en'), /\[0\.1\.0\] has no date/);
  });

  it('rewrites only what is between the markers, and the same way twice', () => {
    const once = generateReadme(README, registry(), CHANGELOG, 'en');
    assert.ok(
      once.startsWith('# Xomoni\n\n## Features\n\n<!-- BEGIN GENERATED: features (npm run readme) -->\n\n### '),
    );
    assert.ok(
      once.includes('<!-- END GENERATED: features -->\n\n| Screenshots stay outside |\n\n## Project status\n\n'),
    );
    assert.ok(once.endsWith('<!-- END GENERATED: status -->\n\nX changes its web app often.\n'));
    assert.doesNotMatch(once, /old list|early release/);
    assert.equal(generateReadme(once, registry(), CHANGELOG, 'en'), once);
    assert.equal(blockContent(once, 'features'), renderFeatures(registry(), 'en'));
    assert.equal(statusVersion(once), '0.2.0');
  });

  it('refuses a README with a missing, repeated or misplaced marker', () => {
    const begin = '<!-- BEGIN GENERATED: features (npm run readme) -->';
    const end = '<!-- END GENERATED: features -->';
    assert.throws(
      () => replaceBlock(README.replace(begin, ''), 'features', 'x'),
      /has no <!-- BEGIN GENERATED: features/,
    );
    assert.throws(() => replaceBlock(README.replace(end, ''), 'features', 'x'), /has no <!-- END GENERATED: features/);
    assert.throws(() => replaceBlock(`${README}\n${begin}\n`, 'features', 'x'), /"features" markers more than once/);
    assert.throws(
      () => replaceBlock(README.replace(begin, 'TMP').replace(end, begin).replace('TMP', end), 'features', 'x'),
      /has <!-- END GENERATED: features --> before/,
    );
    assert.equal(blockContent('no markers', 'status'), null);
    assert.equal(statusVersion('no markers'), null);
  });
});

describe('the check that npm run readme:check runs (#337)', () => {
  const readmes = (text = README) => ({ [README_FILES.en]: text, [README_FILES.fa]: text });
  const report = (overrides = {}) =>
    readmeReport({
      registry: registry(),
      changelog: CHANGELOG,
      readmes: readmes(),
      exists: allExist,
      legacy: LEGACY,
      ...overrides,
    });

  it('finds both READMEs stale until they are written, then up to date', () => {
    const first = report();
    assert.deepEqual(first.problems, []);
    assert.deepEqual(first.stale, ['README.md', 'README.fa.md']);
    const written = report({
      readmes: { 'README.md': first.expected['README.md'], 'README.fa.md': first.expected['README.fa.md'] },
    });
    assert.deepEqual(written.stale, []);
    assert.match(first.expected['README.fa.md'], /### در افزونه/);
  });

  it('finds a hand edit inside a block as drift', () => {
    const written = report().expected['README.md'];
    const edited = written.replace('weekly and monthly.', 'weekly, monthly and daily.');
    assert.deepEqual(
      report({ readmes: { 'README.md': edited, 'README.fa.md': report().expected['README.fa.md'] } }).stale,
      ['README.md'],
    );
  });

  it('names the README that lacks a marker, or is missing', () => {
    const { problems } = report({
      readmes: { 'README.md': README.replace('<!-- END GENERATED: status -->', '') },
    });
    assert.deepEqual(problems, ['README.md: has no <!-- END GENERATED: status --> marker', 'README.fa.md: missing']);
  });

  it('generates nothing from an invalid registry', () => {
    const result = report({ registry: registry({ features: [feature({ area: 'mobile' })] }) });
    assert.ok(result.problems.some((p) => /"area" must be one of/.test(p)));
    assert.deepEqual(result.expected, {});
  });
});

describe("the repository's own registry and READMEs (#337)", () => {
  const read = (path) => readFileSync(join(ROOT, path), 'utf8');
  const own = JSON.parse(read('docs/features.json'));

  it('is valid, matches CHANGELOG.md, and both READMEs are up to date', () => {
    const readmes = Object.fromEntries(Object.values(README_FILES).map((file) => [file, read(file)]));
    const { problems, stale } = readmeReport({
      registry: own,
      changelog: read('CHANGELOG.md'),
      readmes,
      exists: (path) => existsSync(join(ROOT, path)),
    });
    assert.deepEqual(problems, []);
    assert.deepEqual(stale, [], 'run npm run readme');
  });

  it('starts with cleanup on X, the most important feature', () => {
    assert.equal(own.features[0].id, 'cleanup-by-date');
  });

  it('only shrinks its legacy list: no feature joins it (#345)', () => {
    assert.ok(LEGACY_FEATURES.length <= 37, 'LEGACY_FEATURES may only shrink (ADR-0038, #345)');
    assert.ok(Object.isFrozen(LEGACY_FEATURES));
  });
});

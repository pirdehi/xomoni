// Tests for the pull request policy (#339): tooling/pr-policy-lib.mjs, and tooling/check-pr.mjs run as the job runs it,
// on a throwaway git repository. Run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXEMPTIONS,
  SCENARIOS_FROM,
  USER_FACING,
  annotation,
  checkPullRequest,
  exemptionReason,
  formatReport,
  isUserFacing,
  parseNameStatus,
  readPullRequest,
  visibleText,
} from './pr-policy-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'tooling/check-pr.mjs');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/** A pull request as readPullRequest returns it: linked, unlabelled, opened after the cut-over. */
const pr = (overrides = {}) => ({
  body: 'What and why.\n\nCloses #339',
  labels: [],
  author: 'pirdehi',
  createdAt: '2026-11-23T10:00:00Z',
  base: SHA_A,
  head: SHA_B,
  ...overrides,
});
const modified = (...paths) => paths.map((path) => ({ status: 'M', path }));
const added = (...paths) => paths.map((path) => ({ status: 'A', path }));
const deleted = (...paths) => paths.map((path) => ({ status: 'D', path }));
const rules = (result) => result.violations.map((violation) => violation.rule);

const PAGE = 'apps/web/src/app/install/page.tsx';
const CHANGELOG = 'CHANGELOG.md';
const SCENARIOS = 'docs/scenarios/339-pr-policy.md';

describe('user-facing paths (#339)', () => {
  it("counts the website's pages, components and images, and the extension's dashboard, X-page scripts and manifest", () => {
    for (const path of [
      'apps/web/src/app/page.tsx',
      'apps/web/src/app/layout.tsx',
      'apps/web/src/app/globals.css',
      'apps/web/src/app/dashboard/[section]/page.tsx',
      'apps/web/src/app/dashboard/screen.tsx',
      'apps/web/src/modules/auth/ui/login-form.tsx',
      'apps/web/src/modules/landing/ui/hero.tsx',
      'apps/web/src/shared/ui/site-chrome.tsx',
      'apps/web/public/screens/overview.png',
      'apps/extension/dashboard.html',
      'apps/extension/src/ui/App.tsx',
      'apps/extension/src/ui/pages/Cleanup.tsx',
      'apps/extension/src/ui/components/JobCard.tsx',
      'apps/extension/src/ui/styles.css',
      'apps/extension/src/content/content.ts',
      'apps/extension/src/inject/interceptor.ts',
      'apps/extension/public/manifest.json',
      'apps/extension/public/icons/icon128.png',
    ])
      assert.ok(isUserFacing(path), path);
  });

  it('leaves out tests, docs, route handlers, domain and application code, tooling and workflows', () => {
    for (const path of [
      'apps/web/src/app/privacy/page.test.tsx',
      'apps/web/src/shared/ui/links.test.tsx',
      'apps/extension/src/ui/App.test.tsx',
      'apps/extension/src/ui/README.md',
      'apps/web/src/modules/auth/ui/README.md',
      'apps/web/src/app/auth/callback/route.ts',
      'apps/web/src/app/api/csp-report/route.ts',
      'apps/web/src/app/robots.ts',
      'apps/web/src/app/sitemap.ts',
      'apps/web/public/.well-known/security.txt',
      'apps/web/src/modules/auth/domain/password.ts',
      'apps/web/src/modules/dashboard/application/load.ts',
      'apps/web/src/modules/dashboard/infrastructure/supabase.ts',
      'apps/web/src/shared/supabase/server.ts',
      'apps/web/src/proxy.ts',
      'apps/web/e2e/auth.spec.ts',
      'apps/extension/src/engine/runner.ts',
      'apps/extension/src/shared/settings.ts',
      'apps/extension/src/background/sw.ts',
      'apps/extension/tests/support/fixtures.ts',
      'apps/extension/package.json',
      'package-lock.json',
      'tooling/check-pr.mjs',
      '.github/workflows/ci.yml',
      'docs/ROADMAP.md',
      'CHANGELOG.md',
      'supabase/migrations/20261101000000_init.sql',
      // Only whole folder names count.
      'apps/web/src/application/page.tsx',
      'apps/extension/src/uix/App.tsx',
    ])
      assert.ok(!isUserFacing(path), path);
  });

  it('names folders that exist, each still holding user-facing files', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
    for (const glob of USER_FACING.include) {
      const fixed = glob.split('*')[0].replace(/\/$/, '');
      assert.ok(existsSync(join(ROOT, fixed)), `${glob}: ${fixed} doesn't exist`);
      const prefix = glob.split('*')[0];
      assert.ok(
        tracked.some((path) => path.startsWith(prefix) && isUserFacing(path)),
        `${glob}: no tracked file matches it`,
      );
    }
  });
});

describe('P1 · the task link (#339)', () => {
  it("passes with GitHub's closing keywords or Part of, in any case", () => {
    for (const body of [
      'Closes #339',
      'closes #339',
      'Fixes #12',
      'FIXES #12',
      'Resolves #7',
      'Part of #346',
      'part of #346',
      'Close #1',
      'Closed #1',
      'Fix #1',
      'Fixed #1',
      'Resolve #1',
      'Resolved #1',
      'Closes: #339',
      'What and why.\n\nThis is Part of #346, step 3.',
    ])
      assert.deepEqual(rules(checkPullRequest(pr({ body }), modified('docs/ROADMAP.md'))), [], body);
  });

  it('fails without one, naming the forms that count', () => {
    for (const body of [
      '',
      'What and why.',
      'See #339',
      'Related to #339',
      'Closes #N',
      'Closes 339',
      'Prefixes #3',
      'Closes#339',
    ]) {
      const result = checkPullRequest(pr({ body }), modified('docs/ROADMAP.md'));
      assert.deepEqual(rules(result), ['P1'], body);
      assert.match(result.violations[0].fix, /Closes #N.*Part of #N/);
    }
  });

  it("doesn't count a link inside an HTML comment, like the template's own example", () => {
    const template = '## What and why\n\n<!-- What changes, and why. Link the issue: "Closes #123". -->\n';
    assert.deepEqual(rules(checkPullRequest(pr({ body: template }), [])), ['P1']);
    assert.deepEqual(rules(checkPullRequest(pr({ body: 'Text <!-- unclosed\nCloses #5' }), [])), ['P1']);
    assert.deepEqual(rules(checkPullRequest(pr({ body: `${template}\nCloses #339` }), [])), []);
  });

  it("exempts Dependabot, and only Dependabot's own account", () => {
    const update = modified('package.json', 'package-lock.json');
    const result = checkPullRequest(pr({ body: 'Bumps x from 1 to 2.', author: 'dependabot[bot]' }), update);
    assert.deepEqual(rules(result), []);
    assert.match(result.notes.join('\n'), /P1 doesn't apply: dependabot\[bot\]/);
    for (const author of ['dependabot', 'renovate[bot]', 'github-actions[bot]', 'Dependabot[bot]'])
      assert.deepEqual(rules(checkPullRequest(pr({ body: 'Bumps x.', author }), update)), ['P1'], author);
  });

  it('still holds Dependabot to the other rules if it ever touches what people see', () => {
    const result = checkPullRequest(pr({ body: '', author: 'dependabot[bot]' }), modified(PAGE));
    assert.deepEqual(rules(result), ['P2', 'P3']);
  });
});

describe('P2 · the changelog (#339)', () => {
  it('fails a user-facing change without a CHANGELOG.md line, and passes with one', () => {
    const result = checkPullRequest(pr(), modified(PAGE, SCENARIOS));
    assert.deepEqual(rules(result), ['P2']);
    assert.match(result.violations[0].problem, /1 user-facing file\(s\) changed, but CHANGELOG\.md didn't/);
    assert.match(result.violations[0].fix, /## \[Unreleased\].*no-changelog.*No changelog: <why>/);
    assert.deepEqual(rules(checkPullRequest(pr(), modified(PAGE, CHANGELOG, SCENARIOS))), []);
  });

  it("doesn't count deleting the changelog", () => {
    assert.deepEqual(rules(checkPullRequest(pr(), [...modified(PAGE, SCENARIOS), ...deleted(CHANGELOG)])), ['P2']);
  });

  it('counts deleting a user-facing file as a user-facing change', () => {
    assert.deepEqual(rules(checkPullRequest(pr(), deleted('apps/extension/src/ui/pages/Watch.tsx'))), ['P2', 'P3']);
  });

  it('needs nothing for a docs-only, tooling or workflow pull request', () => {
    const changes = modified('docs/ROADMAP.md', 'README.md', 'tooling/check-pr.mjs', '.github/workflows/pr-policy.yml');
    const result = checkPullRequest(pr(), changes);
    assert.deepEqual(result, { userFacing: [], violations: [], notes: [] });
    assert.match(formatReport(result), /No user-facing file changed/);
  });

  it('accepts the no-changelog label with its reason, and says so', () => {
    const body = 'Closes #339\n\nNo changelog: a refactor of the install page, nothing a person sees changes';
    const result = checkPullRequest(pr({ body, labels: ['no-changelog'] }), modified(PAGE, SCENARIOS));
    assert.deepEqual(rules(result), []);
    assert.match(result.notes.join('\n'), /P2 is exempt \(no-changelog\): a refactor of the install page/);
  });
});

describe('P3 · the scenarios (#339)', () => {
  it('fails a user-facing change without a scenarios file, and passes with one added or changed', () => {
    const result = checkPullRequest(pr(), modified(PAGE, CHANGELOG));
    assert.deepEqual(rules(result), ['P3']);
    assert.match(result.violations[0].fix, /docs\/scenarios\/<issue>-<slug>\.md.*no-scenarios.*No scenarios: <why>/);
    assert.deepEqual(rules(checkPullRequest(pr(), [...modified(PAGE, CHANGELOG), ...added(SCENARIOS)])), []);
    assert.deepEqual(rules(checkPullRequest(pr(), modified(PAGE, CHANGELOG, SCENARIOS))), []);
  });

  it("doesn't count the folder's README, a deleted file, or a file elsewhere", () => {
    for (const other of [
      modified('docs/scenarios/README.md'),
      deleted(SCENARIOS),
      modified('docs/scenarios/old/12-x.md'),
      modified('docs/339-pr-policy.md'),
      modified('docs/scenarios/339-pr-policy.txt'),
    ])
      assert.deepEqual(rules(checkPullRequest(pr(), [...modified(PAGE, CHANGELOG), ...other])), ['P3'], other[0].path);
  });

  it('applies from the cut-over on, to the second, and not to pull requests opened before it', () => {
    const changes = modified(PAGE, CHANGELOG);
    assert.equal(SCENARIOS_FROM, '2026-11-22T00:00:00Z');
    assert.deepEqual(rules(checkPullRequest(pr({ createdAt: '2026-11-22T00:00:00Z' }), changes)), ['P3']);
    const before = checkPullRequest(pr({ createdAt: '2026-11-21T23:59:59Z' }), changes);
    assert.deepEqual(rules(before), []);
    assert.match(before.notes.join('\n'), /P3 doesn't apply: the pull request was opened before 2026-11-22/);
    // GitHub sends UTC, but an offset is read as the instant it names.
    assert.deepEqual(rules(checkPullRequest(pr({ createdAt: '2026-11-22T01:00:00+02:00' }), changes)), []);
    assert.deepEqual(rules(checkPullRequest(pr({ createdAt: '2026-11-22T01:00:00-01:00' }), changes)), ['P3']);
  });

  it('still needs the changelog from pull requests opened before the cut-over', () => {
    assert.deepEqual(rules(checkPullRequest(pr({ createdAt: '2026-11-01T00:00:00Z' }), modified(PAGE))), ['P2']);
  });

  it('accepts the no-scenarios label with its reason', () => {
    const body = 'Closes #339\n- No scenarios: fixes a typo in a label, no behavior changes';
    assert.deepEqual(rules(checkPullRequest(pr({ body, labels: ['no-scenarios'] }), modified(PAGE, CHANGELOG))), []);
  });
});

describe('P4 · a reason for every exemption (#339)', () => {
  const labels = Object.keys(EXEMPTIONS);

  it('fails a label without its reason line, and still exempts the rule it names', () => {
    for (const label of labels) {
      const result = checkPullRequest(pr({ labels: [label] }), modified(PAGE, CHANGELOG, SCENARIOS));
      assert.deepEqual(rules(result), ['P4'], label);
      assert.match(
        result.violations[0].problem,
        new RegExp(`The ${label} label is set, but the description gives no reason`),
      );
      assert.match(result.violations[0].fix, new RegExp(`starts with "${EXEMPTIONS[label].line}"`));
    }
  });

  it('needs the reason even when the pull request changes nothing user-facing', () => {
    assert.deepEqual(rules(checkPullRequest(pr({ labels: ['no-changelog'] }), modified('docs/ROADMAP.md'))), ['P4']);
  });

  it('fails a reason that is empty, a placeholder, hidden in a comment, or not at the start of a line', () => {
    for (const line of [
      'No changelog:',
      'No changelog:   ',
      'No changelog: <why>',
      'No changelog: -',
      '<!-- No changelog: a refactor -->',
      'Note. No changelog: a refactor',
      'No changelog a refactor',
    ]) {
      const result = checkPullRequest(pr({ body: `Closes #339\n${line}`, labels: ['no-changelog'] }), []);
      assert.deepEqual(rules(result), ['P4'], line);
    }
  });

  it('accepts the reason in a list, in bold, or in another case', () => {
    for (const line of [
      'No changelog: a refactor',
      '- No changelog: a refactor',
      '* No changelog: a refactor',
      '  No changelog: a refactor',
      '**No changelog:** a refactor',
      'no changelog: a refactor',
      'No changelog: نوشتن دوباره',
    ])
      assert.ok(exemptionReason(`Closes #339\n${line}\n`, 'No changelog:'), line);
    assert.equal(exemptionReason('No changelog: a refactor  \n', 'No changelog:'), 'a refactor');
  });

  it('wants each label its own reason', () => {
    const body = 'Closes #339\nNo changelog: a refactor';
    const result = checkPullRequest(pr({ body, labels: ['no-changelog', 'no-scenarios'] }), modified(PAGE));
    assert.deepEqual(rules(result), ['P4']);
    assert.match(result.violations[0].problem, /no-scenarios/);
  });

  it('reports every violation at once, in rule order', () => {
    const result = checkPullRequest(pr({ body: '', labels: ['no-scenarios'] }), modified(PAGE));
    assert.deepEqual(rules(result), ['P1', 'P2', 'P4']);
    const report = formatReport(result);
    assert.match(report, /Pull request policy failed \(3\):/);
    for (const { rule, problem, fix } of result.violations) {
      assert.ok(report.includes(`${rule} · `) && report.includes(problem) && report.includes(`How to fix: ${fix}`));
    }
    assert.match(report, /User-facing files changed \(1\):\n {2}apps\/web\/src\/app\/install\/page\.tsx/);
  });
});

describe('reading the event and the diff (#339)', () => {
  const event = (fields = {}) => ({
    action: 'opened',
    pull_request: {
      body: 'Closes #339',
      labels: [{ name: 'no-changelog' }],
      user: { login: 'pirdehi' },
      created_at: '2026-11-22T08:00:00Z',
      base: { sha: SHA_A },
      head: { sha: SHA_B },
      ...fields,
    },
  });

  it('reads the fields the policy needs', () => {
    assert.deepEqual(readPullRequest(event()), {
      body: 'Closes #339',
      labels: ['no-changelog'],
      author: 'pirdehi',
      createdAt: '2026-11-22T08:00:00Z',
      base: SHA_A,
      head: SHA_B,
    });
    assert.equal(readPullRequest(event({ body: null })).body, '', 'GitHub sends null for an empty description');
  });

  it('refuses an event that is not a pull request', () => {
    for (const value of [null, 'text', [], {}, { pull_request: null }, { pull_request: [] }, { issue: {} }])
      assert.throws(() => readPullRequest(value), /no "pull_request"/, JSON.stringify(value));
  });

  it('refuses a malformed pull request, naming every field that is wrong', () => {
    assert.throws(
      () => readPullRequest(event({ labels: 'no-changelog', user: {}, created_at: 'yesterday', body: 3 })),
      /malformed: "body" is not text; "labels" is not a list of names; "user.login" is missing; "created_at" is not a date/,
    );
    assert.throws(() => readPullRequest(event({ labels: [{}] })), /"labels" is not a list of names/);
    assert.throws(() => readPullRequest(event({ head: {} })), /"head\.sha" is not a commit/);
  });

  it('accepts only full commit SHAs, so nothing else reaches git as an argument', () => {
    for (const sha of [
      '--output=/tmp/x',
      'main',
      'HEAD~1',
      SHA_A.slice(0, 7),
      `${SHA_A} ${SHA_B}`,
      SHA_A.toUpperCase(),
    ])
      assert.throws(() => readPullRequest(event({ base: { sha } })), /"base\.sha" is not a commit/, sha);
    assert.equal(readPullRequest(event({ base: { sha: 'c'.repeat(64) } })).base, 'c'.repeat(64), 'SHA-256');
  });

  it("reads git's -z output, without renames, including names with spaces and tabs", () => {
    assert.deepEqual(parseNameStatus(''), []);
    assert.deepEqual(parseNameStatus('M\0CHANGELOG.md\0A\0docs/scenarios/a b.md\0D\0odd\tname.tsx\0'), [
      { status: 'M', path: 'CHANGELOG.md' },
      { status: 'A', path: 'docs/scenarios/a b.md' },
      { status: 'D', path: 'odd\tname.tsx' },
    ]);
  });

  it("hides what GitHub doesn't show", () => {
    assert.equal(visibleText('a <!-- b --> c <!-- d\ne --> f'), 'a  c  f');
    assert.equal(visibleText('a <!-- never closed\nCloses #1'), 'a ');
  });

  it('quotes a file name with a line break, so it cannot start a workflow command', () => {
    const path = 'apps/web/src/app/x\n::error::fake.tsx';
    const report = formatReport(checkPullRequest(pr(), modified(path, CHANGELOG, SCENARIOS)));
    assert.ok(report.includes('  "apps/web/src/app/x\\n::error::fake.tsx"'), report);
    assert.doesNotMatch(report, /^::/m);
  });

  it('writes an annotation that a description cannot break out of', () => {
    assert.equal(annotation('P1 task link', 'one\ntwo 100%'), '::error title=P1 task link::one%0Atwo 100%25');
    assert.equal(annotation('a:b,c', 'x\r\n::warning::y'), '::error title=a%3Ab%2Cc::x%0D%0A::warning::y');
  });
});

/** Runs git in `dir` with a throwaway identity, no signing and no hooks, whatever the computer's own settings. */
function gitIn(dir) {
  const settings = [
    'user.name=Test',
    'user.email=test@example.com',
    'commit.gpgsign=false',
    'core.hooksPath=/dev/null',
  ];
  return (...args) =>
    execFileSync('git', [...settings.flatMap((setting) => ['-c', setting]), ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
}

/** A git repository with a base commit and a head commit that changes `files`, and the event of its pull request. */
function repository(files, pullRequest = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'xomoni-pr-'));
  const git = gitIn(dir);
  git('init', '-q');
  writeFileSync(join(dir, 'README.md'), '# test\n');
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git('add', '.');
  git('commit', '-q', '-m', 'head');
  const head = git('rev-parse', 'HEAD');
  const event = {
    pull_request: {
      body: 'Closes #339',
      labels: [],
      user: { login: 'pirdehi' },
      created_at: '2026-11-23T10:00:00Z',
      base: { sha: base },
      head: { sha: head },
      ...pullRequest,
    },
  };
  return { dir, git, base, head, event, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Runs the command line as the job does, in `dir`, with `event` written to the event file (or `raw` as it is). */
function run(dir, { event, raw, env = {} }) {
  const path = join(dir, '.event.json');
  if (raw !== undefined || event) writeFileSync(path, raw ?? JSON.stringify(event));
  const result = spawnSync(process.execPath, [CLI], {
    cwd: dir,
    env: { PATH: process.env.PATH, GITHUB_EVENT_PATH: path, ...env },
    encoding: 'utf8',
  });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

describe('tooling/check-pr.mjs (#339)', () => {
  it('passes a pull request that meets every rule', () => {
    const repo = repository({ [PAGE]: 'page', [CHANGELOG]: 'line', [SCENARIOS]: 'scenarios' });
    try {
      const result = run(repo.dir, { event: repo.event });
      assert.equal(result.status, 0, result.out + result.err);
      assert.match(result.out, /User-facing files changed \(1\):\n {2}apps\/web\/src\/app\/install\/page\.tsx/);
      assert.match(result.out, /Pull request policy passed\./);
    } finally {
      repo.cleanup();
    }
  });

  it('passes a docs-only pull request', () => {
    const repo = repository({ 'docs/ROADMAP.md': 'roadmap' });
    try {
      const result = run(repo.dir, { event: repo.event });
      assert.equal(result.status, 0, result.out + result.err);
      assert.match(result.out, /No user-facing file changed/);
    } finally {
      repo.cleanup();
    }
  });

  it('fails with every violation and its fix, and annotates them in GitHub Actions', () => {
    const repo = repository({ 'apps/extension/src/ui/App.tsx': 'app' }, { body: 'No link <!-- Closes #1 -->' });
    try {
      const plain = run(repo.dir, { event: repo.event });
      assert.equal(plain.status, 1);
      assert.match(plain.out, /P1 · task link: The description links no task\./);
      assert.match(plain.out, /P2 · changelog:/);
      assert.match(plain.out, /P3 · scenarios:/);
      assert.equal((plain.out.match(/How to fix:/g) ?? []).length, 3);
      assert.doesNotMatch(plain.out, /::error/, 'no workflow commands outside GitHub Actions');
      const actions = run(repo.dir, { event: repo.event, env: { GITHUB_ACTIONS: 'true' } });
      assert.equal(actions.status, 1);
      assert.match(actions.out, /^::error title=P1 task link::The description links no task\./m);
      assert.match(actions.out, /^::error title=P3 scenarios::/m);
    } finally {
      repo.cleanup();
    }
  });

  it('counts a file the pull request deleted, and nothing the base changed after it', () => {
    const repo = repository({ 'docs/ROADMAP.md': 'roadmap' });
    try {
      const { git } = repo;
      // The base moves on with a page; the pull request's own change is docs only.
      git('checkout', '-q', '-b', 'later', repo.base);
      mkdirSync(join(repo.dir, 'apps/web/src/app'), { recursive: true });
      writeFileSync(join(repo.dir, 'apps/web/src/app/page.tsx'), 'page');
      git('add', '.');
      git('commit', '-q', '-m', 'main moves on');
      const later = git('rev-parse', 'HEAD');
      const event = { pull_request: { ...repo.event.pull_request, base: { sha: later } } };
      const result = run(repo.dir, { event });
      assert.equal(result.status, 0, result.out + result.err);
      // Deleting the page in a pull request is user-facing.
      git('rm', '-q', 'apps/web/src/app/page.tsx');
      git('commit', '-q', '-m', 'remove the page');
      const removal = { pull_request: { ...event.pull_request, head: { sha: git('rev-parse', 'HEAD') } } };
      const failed = run(repo.dir, { event: removal });
      assert.equal(failed.status, 1, failed.out);
      assert.match(failed.out, /apps\/web\/src\/app\/page\.tsx/);
    } finally {
      repo.cleanup();
    }
  });

  it("stops with status 2 when it can't read the pull request", () => {
    const repo = repository({ 'docs/ROADMAP.md': 'roadmap' });
    try {
      const cases = [
        { raw: '{ not json', error: /Can't check this pull request: .*\.event\.json: .*JSON/ },
        { raw: '{"action":"push"}', error: /no "pull_request"/ },
        {
          event: { pull_request: { ...repo.event.pull_request, head: { sha: '--output=/tmp/x' } } },
          error: /"head\.sha" is not a commit/,
        },
        {
          event: { pull_request: { ...repo.event.pull_request, head: { sha: 'f'.repeat(40) } } },
          error: /git can't compare .*fetch-depth: 0/,
        },
      ];
      for (const { error, ...input } of cases) {
        const result = run(repo.dir, input);
        assert.equal(result.status, 2, result.out + result.err);
        assert.match(result.err, error);
        assert.doesNotMatch(result.out, /policy passed/);
      }
      const missing = spawnSync(process.execPath, [CLI], {
        cwd: repo.dir,
        env: { PATH: process.env.PATH },
        encoding: 'utf8',
      });
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /GITHUB_EVENT_PATH is not set/);
      const actions = run(repo.dir, { raw: '[]', env: { GITHUB_ACTIONS: 'true' } });
      assert.match(actions.err, /^::error title=pr-policy::Can't check this pull request/m);
    } finally {
      repo.cleanup();
    }
  });
});

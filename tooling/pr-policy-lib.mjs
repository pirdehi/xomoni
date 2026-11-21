// The pull request policy (#339): what every pull request to main must meet before it merges, beside CI. The
// `pr-policy` job of .github/workflows/pr-policy.yml runs it through tooling/check-pr.mjs, which reads the event and
// asks git for the changed files; everything here is pure, so tooling/pr-policy.test.mjs can test each rule.
// Node's built-ins only: the job runs without `npm ci`, so no dependency's code runs next to the description.
//
//   P1  The description links its task: `Closes #N`, `Fixes #N`, `Resolves #N` or `Part of #N`.
//   P2  A user-facing change adds a line to CHANGELOG.md, unless labelled `no-changelog`.
//   P3  A user-facing change adds or updates a scenarios file in docs/scenarios/, unless labelled `no-scenarios`.
//   P4  Each exemption label comes with its reason in the description: `No changelog: …`, `No scenarios: …`.

/**
 * The first moment, in UTC, at which a user-facing pull request needs a scenarios file (P3). Pull requests opened
 * before it keep the rules they were opened under, so work already in flight isn't blocked by a rule that didn't exist
 * when it started. Never move it later: that would let new pull requests skip the rule.
 */
export const SCENARIOS_FROM = '2026-11-22T00:00:00Z';

/**
 * The files that change what a person sees or does, on xomoni.com or in the extension. A pull request that changes,
 * adds or deletes one is user-facing: it needs a changelog line (P2) and scenarios (P3). A path is user-facing when it
 * matches a glob in `include` and none in `exclude`. Globs are relative to the repository's root: `*` matches within
 * one folder, `**` across folders. tooling/pr-policy.test.mjs checks that every `include` still matches real files, so
 * a folder that moves fails the tests instead of silently leaving the rule.
 */
export const USER_FACING = {
  include: [
    // xomoni.com: its pages and layouts (Next.js's App Router), each module's components, the components the modules
    // share, and the images it serves as they are.
    'apps/web/src/app/**',
    'apps/web/src/modules/*/ui/**',
    'apps/web/src/shared/ui/**',
    'apps/web/public/**',
    // The extension: its dashboard (the page and its components), what runs in the X page (the content script, and
    // the interceptor it injects into the page's own world), and the manifest and icons the browser shows.
    'apps/extension/dashboard.html',
    'apps/extension/src/ui/**',
    'apps/extension/src/content/**',
    'apps/extension/src/inject/**',
    'apps/extension/public/**',
  ],
  exclude: [
    // Tests and docs, even when they sit beside the code they are about.
    '**/*.test.*',
    '**/*.spec.*',
    '**/*.md',
    // Route handlers answer requests, not people: the sign-in callback, sign-out, reports. So do robots.txt and the
    // sitemap, which are for crawlers.
    'apps/web/src/app/**/route.*',
    'apps/web/src/app/robots.*',
    'apps/web/src/app/sitemap.*',
    // security.txt, for security researchers.
    'apps/web/public/.well-known/**',
  ],
};

/** Where scenarios files live (ADR-0038): one per user-facing task, beside a README that isn't one. */
const SCENARIOS = /^docs\/scenarios\/(?!README\.md$)[^/]+\.md$/;

/**
 * The labels that exempt a pull request from a rule, each with the line its description must then start with (P4),
 * and an example of a reason for the error message.
 */
export const EXEMPTIONS = {
  'no-changelog': { rule: 'P2', line: 'No changelog:', example: 'a refactor, nothing a person sees changes' },
  'no-scenarios': { rule: 'P3', line: 'No scenarios:', example: 'fixes a typo in a label, no behavior changes' },
};

/** The one author who needs no task link: Dependabot's updates come from its own schedule, not from an issue. */
export const NO_TASK_LINK = new Set(['dependabot[bot]']);

// GitHub's closing keywords (close, closes, closed, fix, …, resolved), and `Part of` for a pull request that doesn't
// finish its task, each followed by `#N`, with a space or a colon between.
const TASK_LINK = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|part\s+of)(?:\s*:\s*|\s+)#\d+\b/i;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A glob from USER_FACING as a regular expression for a whole path. */
function globToRegExp(glob) {
  const source = glob
    .split(/(\*\*\/|\/\*\*$|\*\*|\*)/)
    .map((part) => {
      if (part === '**/') return '(?:[^/]+/)*';
      if (part === '/**') return '/.+';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      return escapeRegExp(part);
    })
    .join('');
  // `s`: a name with a line break in it still matches.
  return new RegExp(`^${source}$`, 's');
}

const INCLUDE = USER_FACING.include.map(globToRegExp);
const EXCLUDE = USER_FACING.exclude.map(globToRegExp);

/** Whether a change to `path` (relative to the repository's root, with `/`) changes what a person sees or does. */
export function isUserFacing(path) {
  return INCLUDE.some((glob) => glob.test(path)) && !EXCLUDE.some((glob) => glob.test(path));
}

/**
 * The description as GitHub shows it: without HTML comments, which the pull request template is full of (its own
 * comment says "Closes #123"). An unclosed comment hides the rest, as it does on GitHub.
 */
export const visibleText = (body) => body.replace(/<!--[\s\S]*?(?:-->|$)/g, '');

/**
 * The reason written after `line` (such as `No changelog:`) at the start of a line of `body`, or null when there is
 * none. A list marker or bold before it is fine. A placeholder (`<why>`) or a reason without a letter doesn't count.
 */
export function exemptionReason(body, line) {
  const pattern = new RegExp(`^[ \\t]*(?:[-*+][ \\t]+)?(?:\\*\\*)?${escapeRegExp(line)}(?:\\*\\*)?(.*)$`, 'gim');
  for (const [, rest] of visibleText(body).matchAll(pattern)) {
    const reason = rest.trim();
    if (/\p{L}/u.test(reason) && !/^<[^>]*>$/.test(reason)) return reason;
  }
  return null;
}

/** The field at `path` of `value` (`['user', 'login']`), or undefined anywhere along the way. */
function field(value, path) {
  return path.reduce((at, key) => (at !== null && typeof at === 'object' ? at[key] : undefined), value);
}

/**
 * The parts of a `pull_request` event (`$GITHUB_EVENT_PATH`, parsed) the policy reads. Throws, saying every field that
 * is missing or malformed, rather than check a pull request it can't see. The commits must be full SHAs: they go to git
 * as arguments, and anything else (an option like `--output=…`) is refused.
 */
export function readPullRequest(event) {
  const pr = field(event, ['pull_request']);
  if (pr === null || typeof pr !== 'object' || Array.isArray(pr))
    throw new Error('the event has no "pull_request": run this on a pull_request event');
  const problems = [];
  const body = pr.body ?? '';
  if (typeof body !== 'string') problems.push('"body" is not text');
  const labels = Array.isArray(pr.labels) ? pr.labels.map((label) => field(label, ['name'])) : null;
  if (!labels || labels.some((name) => typeof name !== 'string')) problems.push('"labels" is not a list of names');
  const author = field(pr, ['user', 'login']);
  if (typeof author !== 'string' || !author) problems.push('"user.login" is missing');
  const createdAt = pr.created_at;
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) problems.push('"created_at" is not a date');
  const base = field(pr, ['base', 'sha']);
  const head = field(pr, ['head', 'sha']);
  for (const [name, sha] of Object.entries({ 'base.sha': base, 'head.sha': head }))
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha))
      problems.push(`"${name}" is not a commit`);
  if (problems.length) throw new Error(`the pull request in the event is malformed: ${problems.join('; ')}`);
  return { body, labels, author, createdAt, base, head };
}

/**
 * The changed files from `git diff --name-status --no-renames -z`, as `{ status, path }`. `status` is git's letter:
 * A added, M modified, D deleted, T type changed. Without renames, a moved file is a delete and an add, so both of its
 * paths count.
 */
export function parseNameStatus(output) {
  const fields = output.split('\0');
  const changes = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i].trim();
    const path = fields[i + 1];
    if (status && path) changes.push({ status: status[0], path });
  }
  return changes;
}

const kept = (change) => change.status !== 'D';

/**
 * Checks one pull request (from readPullRequest) and its changed files (from parseNameStatus) against the policy. The
 * result lists the user-facing files it found, every violation with the problem and how to fix it, and notes for the
 * reader: exemptions and their reasons, and rules that didn't apply.
 */
export function checkPullRequest(pr, changes) {
  const violations = [];
  const notes = [];
  const labels = new Set(pr.labels);
  const userFacing = [...new Set(changes.map((change) => change.path).filter(isUserFacing))].sort();

  // P1 · the task link
  if (NO_TASK_LINK.has(pr.author)) notes.push(`P1 doesn't apply: ${pr.author} needs no task link.`);
  else if (!TASK_LINK.test(visibleText(pr.body)))
    violations.push({
      rule: 'P1',
      title: 'task link',
      problem: 'The description links no task.',
      fix: 'Add a line "Closes #N" (or "Fixes #N", "Resolves #N") with the issue it finishes, or "Part of #N" when it is one step of a larger task. A link inside an HTML comment (<!-- -->) doesn\'t count.',
    });

  // P2 · the changelog
  if (userFacing.length && !labels.has('no-changelog')) {
    if (!changes.some((change) => change.path === 'CHANGELOG.md' && kept(change)))
      violations.push({
        rule: 'P2',
        title: 'changelog',
        problem: `${userFacing.length} user-facing file(s) changed, but CHANGELOG.md didn't.`,
        fix: 'Add a line under "## [Unreleased]" in CHANGELOG.md that says what changes for people. For a change no one would notice (a refactor, a typo), add the no-changelog label and a line "No changelog: <why>" to the description instead.',
      });
  }

  // P3 · the scenarios
  if (userFacing.length && !labels.has('no-scenarios')) {
    if (Date.parse(pr.createdAt) < Date.parse(SCENARIOS_FROM))
      notes.push(
        `P3 doesn't apply: the pull request was opened before ${SCENARIOS_FROM}, when scenarios became a rule.`,
      );
    else if (!changes.some((change) => SCENARIOS.test(change.path) && kept(change)))
      violations.push({
        rule: 'P3',
        title: 'scenarios',
        problem: `${userFacing.length} user-facing file(s) changed, but no scenarios file in docs/scenarios/ was added or changed.`,
        fix: 'Add the task\'s scenarios to docs/scenarios/<issue>-<slug>.md (ADR-0038), or the scenario a fix adds to its feature\'s file. For a change to no behavior a person can see, add the no-scenarios label and a line "No scenarios: <why>" to the description instead.',
      });
  }

  // P4 · a reason for every exemption
  for (const [label, { rule, line, example }] of Object.entries(EXEMPTIONS)) {
    if (!labels.has(label)) continue;
    const reason = exemptionReason(pr.body, line);
    if (reason) notes.push(`${rule} is exempt (${label}): ${reason}`);
    else
      violations.push({
        rule: 'P4',
        title: 'exemption reason',
        problem: `The ${label} label is set, but the description gives no reason.`,
        fix: `Add a line to the description that starts with "${line}" followed by why, such as "${line} ${example}". Or remove the label.`,
      });
  }

  return { userFacing, violations, notes };
}

// A path git allows can hold a line break; quoted, it can't start a line of its own, where the runner would read a
// workflow command.
const printable = (path) => (/\p{Cc}/u.test(path) ? JSON.stringify(path) : path);

/** The result of checkPullRequest as the job's log shows it: what was found, then each problem with its fix. */
export function formatReport({ userFacing, violations, notes }) {
  const lines = [];
  if (userFacing.length) {
    lines.push(`User-facing files changed (${userFacing.length}):`);
    for (const path of userFacing) lines.push(`  ${printable(path)}`);
  } else lines.push("No user-facing file changed: the changelog and scenarios rules (P2, P3) don't apply.");
  for (const note of notes) lines.push(`Note: ${note}`);
  lines.push('');
  if (!violations.length) {
    lines.push('Pull request policy passed.');
    return lines.join('\n');
  }
  lines.push(`Pull request policy failed (${violations.length}):`);
  for (const { rule, title, problem, fix } of violations) {
    lines.push('', `  ${rule} · ${title}: ${problem}`, `    How to fix: ${fix}`);
  }
  lines.push(
    '',
    'The check runs again when you push, edit the description or change the labels. The rules: CONTRIBUTING.md, "Making a change".',
  );
  return lines.join('\n');
}

/**
 * A GitHub Actions workflow command that shows `message` as an error on the run's summary page. `%`, `\r` and `\n`
 * are encoded as the runner expects, so a message can't end the command early or start another one.
 */
export function annotation(title, message) {
  const encode = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::error title=${encode(title).replace(/:/g, '%3A').replace(/,/g, '%2C')}::${encode(message)}`;
}

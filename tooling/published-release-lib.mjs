// The check after each release (#343, R18 of docs/QUALITY-GATES.md): what .github/workflows/release-check.yml makes of
// a published release, downloaded as people get it. Kept apart from the command line in
// tooling/check-published-release.mjs, with no I/O, so tooling/published-release.test.mjs can test it.
import { compareVersions } from './readme-lib.mjs';
import { RELEASE_LABEL, TRUSTED_AUTHORS, releaseIssueTitle } from './release-issue-lib.mjs';
import { versionOfTag } from './release-lib.mjs';

/** The checksums file every release attaches beside its zips. */
export const SUMS = 'SHA256SUMS';

/** The account that GitHub Actions' token acts as. Only a workflow of this repository can open an issue as it. */
export const ACTIONS_BOT = 'github-actions[bot]';

/** How long a check's description, or its detail, may be in the report the check job hands to the report job. */
const MAX_WHAT = 200;
const MAX_DETAIL = 2000;

/**
 * The checksums in a `SHA256SUMS` file, by file name, as `sha256sum` writes them: 64 hex digits, a space, then a space
 * (text) or `*` (binary), then the name. Lines that aren't shaped so are `problems`, by line number; blank lines don't
 * count. A name listed twice is a problem too, since `sha256sum --check` would read both.
 */
export function parseSums(text) {
  const sums = new Map();
  const problems = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (!line.trim()) return;
      const match = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(line);
      if (!match) return problems.push(`line ${i + 1} is not "<sha256>  <file>"`);
      const [, hash, name] = match;
      if (sums.has(name)) return problems.push(`${name} is listed twice`);
      sums.set(name, hash.toLowerCase());
    });
  return { sums, problems };
}

/**
 * The newest published release's tag among `releases`, as GitHub's REST API lists them
 * (`GET /repos/{owner}/{repo}/releases`): the highest `vX.Y.Z` that is neither a draft nor a prerelease. This is the
 * one `releases/latest` should serve. Null when there is none.
 */
export function newestRelease(releases) {
  const tags = releases
    .filter((release) => release && release.draft !== true && release.prerelease !== true)
    .map((release) => release.tag_name)
    .filter((tag) => versionOfTag(tag) != null);
  if (!tags.length) return null;
  return tags.reduce((newest, tag) => (compareVersions(versionOfTag(tag), versionOfTag(newest)) > 0 ? tag : newest));
}

/**
 * Where an issue stands as the version's record, lower first: the issue the release workflow closed as completed,
 * then an open one, then one closed for another reason, such as a duplicate.
 */
function recordRank(issue) {
  const state = String(issue.state).toLowerCase();
  if (state === 'closed' && String(issue.state_reason).toLowerCase() === 'completed') return 0;
  return state === 'open' ? 1 : 2;
}

/**
 * The release issue of `tag` among `issues` (as `GET /repos/{owner}/{repo}/issues?state=all` lists them), open or
 * closed: an issue, not a pull request, labelled `release` and titled exactly `Release vX.Y.Z`, opened by someone who
 * can push to the repository, or by this check when the version had none. Anyone can open an issue from the Release
 * template, which labels it `release`, so an outsider's copy never counts. When several match, one opened by a person
 * comes first, then the one closed as completed (what the release workflow does), then the newest. Null when none.
 */
export function releaseIssueFor(issues, tag) {
  const title = releaseIssueTitle(tag);
  const byPerson = (issue) => (TRUSTED_AUTHORS.includes(issue.author_association) ? 0 : 1);
  const candidates = issues.filter(
    (issue) =>
      issue.pull_request == null &&
      Number.isInteger(issue.number) &&
      issue.number > 0 &&
      issue.title === title &&
      (issue.labels ?? []).some((label) => (typeof label === 'string' ? label : label?.name) === RELEASE_LABEL) &&
      (TRUSTED_AUTHORS.includes(issue.author_association) || issue.user?.login === ACTIONS_BOT),
  );
  candidates.sort((a, b) => byPerson(a) - byPerson(b) || recordRank(a) - recordRank(b) || b.number - a.number);
  return candidates[0] ?? null;
}

/**
 * Reads the report the check job hands to the report job: JSON with the `tag` it checked and its `checks`, each with
 * `what` was checked, whether it is `ok`, and a `detail`. Returns a problem when it is missing, isn't for `tag`, or
 * isn't shaped so: the report then says that the check didn't finish, rather than trust it.
 */
export function parseReport(text, tag) {
  if (!String(text ?? '').trim()) return { report: null, problem: 'The check job handed over no report.' };
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return { report: null, problem: 'The check job handed over a report that is not JSON.' };
  }
  if (report?.tag !== tag) return { report: null, problem: `The report is not about ${tag}.` };
  const { checks } = report;
  const valid =
    Array.isArray(checks) &&
    checks.length > 0 &&
    checks.length <= 20 &&
    checks.every(
      (check) =>
        typeof check?.what === 'string' &&
        check.what.length > 0 &&
        check.what.length <= MAX_WHAT &&
        typeof check.ok === 'boolean' &&
        typeof check.detail === 'string' &&
        check.detail.length <= MAX_DETAIL,
    );
  if (!valid) return { report: null, problem: 'The report has no checks, or a check that is not shaped as expected.' };
  return { report: { tag, checks: checks.map(({ what, ok, detail }) => ({ what, ok, detail })) }, problem: null };
}

/** `text` on one line, cut to `max` characters, for a table cell. */
function oneLine(text, max) {
  const line = String(text).replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * `text` for a table cell: backslashes escaped first, then pipes, so that no `\` in the text can turn the pipe after it
 * back into a column break.
 */
const cell = (text) => text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

/**
 * `text` as a code span in a table cell. What a tool printed, such as an error from GitHub, could otherwise mention
 * someone or format the comment: inside a code span it is only text.
 */
const code = (text) => `\`${cell(oneLine(text, 300).replace(/`/g, "'"))}\``;

/** Whether the check passed: its job succeeded, its report is valid, and every check in it is ok. */
export const passed = (result, report) => result === 'success' && report != null && report.checks.every((c) => c.ok);

/**
 * The comment, or the start of a new issue, that reports the check of `tag`: passed or failed, a table of the checks
 * from `report` (null when the check didn't finish, which `problem` explains), the run, and what to do on a failure.
 * `result` is the check job's result; `run` is from `runFromEnv`, with `server` and `repo`.
 */
export function reportBody({ tag, result, report, problem, run }) {
  const ok = passed(result, report);
  const release = `${run.server}/${run.repo}/releases/tag/${tag}`;
  const lines = [
    `### The check after the release: ${ok ? 'passed' : 'failed'}`,
    '',
    `${tag}, downloaded as people get it: from [the release](${release}) and from \`releases/latest\` (#343).`,
    '',
  ];
  if (report) {
    lines.push('| | Check | Detail |', '| --- | --- | --- |');
    for (const check of report.checks)
      lines.push(`| ${check.ok ? '✓' : '✗'} | ${cell(oneLine(check.what, MAX_WHAT))} | ${code(check.detail)} |`);
  } else {
    lines.push(`The check didn't finish (its job ended as \`${result || 'unknown'}\`): ${problem ?? 'no report'}`);
  }
  lines.push('', `Run: ${run.url}`, '');
  if (!ok)
    lines.push(
      `What to do: [when the check after the release fails](${run.server}/${run.repo}/blob/main/docs/RELEASING.md#when-the-check-after-the-release-fails).`,
      '',
    );
  return lines.join('\n');
}

/** The body of a new release issue, opened when `tag` has none (versions released before #340 have none). */
export function newIssueBody(args) {
  return [
    `No issue titled "${releaseIssueTitle(args.tag)}" was found, so this one keeps the check after the release, as ` +
      `the version's record ([quality gates](${args.run.server}/${args.run.repo}/blob/main/docs/QUALITY-GATES.md), R18). ` +
      'It is closed when the check passes, and stays open while it fails.',
    '',
    reportBody(args),
  ].join('\n');
}

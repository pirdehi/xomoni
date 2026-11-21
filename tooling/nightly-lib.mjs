// The nightly run's issue (#343, R18 of docs/QUALITY-GATES.md): what the `report` job of .github/workflows/nightly.yml
// does with a night's results. One open issue, labelled `nightly` and titled "Nightly run failing", says that main is
// red: a failing night opens it or comments on it, and the first green night closes it. Kept apart from the command
// line in tooling/nightly-report.mjs, with no I/O, so tooling/nightly.test.mjs can test it.

/** The label of the nightly run's issue. The report creates it the first time a night fails; nothing else needs it. */
export const NIGHTLY_LABEL = 'nightly';

/** The title of the one issue that says the nightly run on main is failing. Only an exact match counts. */
export const NIGHTLY_TITLE = 'Nightly run failing';

/** The only branch the nightly run reports on. A run by hand from another branch leaves the issue alone. */
export const NIGHTLY_REF = 'refs/heads/main';

/** What GitHub can put in `needs.<job>.result`. */
const RESULTS = new Set(['success', 'failure', 'cancelled', 'skipped']);

/** A job's id as the workflow names it, such as `ci` or `audit`. */
const JOB = /^[a-z][a-z0-9_-]{0,39}$/;

/**
 * Reads the report's arguments, one `job=result` each, such as `ci=failure`. Returns the jobs in order, or a problem
 * when there is no argument, an argument isn't `job=result`, a job comes twice, or a result isn't one GitHub gives.
 */
export function parseResults(args) {
  if (!args.length) return { jobs: [], problem: 'No job results: pass one job=result per job, such as ci=success.' };
  const jobs = [];
  for (const arg of args) {
    const match = /^([^=]*)=(.*)$/s.exec(String(arg));
    if (!match || !JOB.test(match[1])) return { jobs: [], problem: `"${arg}" is not job=result.` };
    const [, job, result] = match;
    if (jobs.some((seen) => seen.job === job)) return { jobs: [], problem: `${job} is given twice.` };
    // An empty result: the workflow passed a job that doesn't exist in `needs`.
    if (!RESULTS.has(result)) return { jobs: [], problem: `${job}: "${result}" is not a job result GitHub gives.` };
    jobs.push({ job, result });
  }
  return { jobs, problem: null };
}

/**
 * The night's verdict from its jobs: `red` when any failed or was cancelled, `green` when every one succeeded, and null
 * otherwise, when a job was skipped and the night proves nothing. A cancelled job counts as red: GitHub cancels a job
 * that runs out of time, and the report doesn't run at all when a person cancels the whole run.
 */
export function verdict(jobs) {
  if (jobs.some(({ result }) => result === 'failure' || result === 'cancelled')) return 'red';
  if (jobs.length && jobs.every(({ result }) => result === 'success')) return 'green';
  return null;
}

/**
 * The open nightly issues among `issues`, as GitHub's REST API lists them (`GET /repos/{owner}/{repo}/issues`), oldest
 * first: not pull requests, open, labelled `nightly` and titled exactly "Nightly run failing". The label is the proof
 * of origin: only the workflow and people with triage access can label an issue, so an issue someone else opens with
 * the same title never counts.
 */
export function openNightlyIssues(issues) {
  return issues
    .filter(
      (issue) =>
        issue.pull_request == null &&
        Number.isInteger(issue.number) &&
        issue.number > 0 &&
        issue.title === NIGHTLY_TITLE &&
        String(issue.state).toLowerCase() === 'open' &&
        (issue.labels ?? []).some((label) => (typeof label === 'string' ? label : label?.name) === NIGHTLY_LABEL),
    )
    .sort((a, b) => a.number - b.number);
}

/**
 * What the report does, from the night's `verdict` and the open nightly issues (`open`, oldest first):
 * - `open`: red, and no issue is open: open one.
 * - `comment`: red, and one is: comment on the oldest, `issue`. Any others are `extra`, left for a person to close.
 * - `close`: green: close every open one, `issues`.
 * - `none`: green with nothing open, or no verdict.
 */
export function plan(night, open) {
  if (night === 'red' && open.length === 0) return { action: 'open' };
  if (night === 'red') return { action: 'comment', issue: open[0], extra: open.slice(1) };
  if (night === 'green' && open.length) return { action: 'close', issues: open };
  return { action: 'none' };
}

/**
 * The run a report is about, from the variables GitHub sets in every job: the server and repository, the run's
 * address, the commit and the ref. Returns a problem when one is missing or not shaped as GitHub writes it, so nothing
 * odd reaches an issue. The check after each release uses it too (tooling/check-published-release.mjs).
 */
export function runFromEnv(env) {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id, GITHUB_SHA: sha } = env;
  const ref = env.GITHUB_REF ?? '';
  if (!/^https:\/\/[\w.-]+$/.test(server ?? '')) return { problem: 'GITHUB_SERVER_URL is not an https address.' };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) return { problem: 'GITHUB_REPOSITORY is not owner/repo.' };
  if (!/^[1-9][0-9]*$/.test(id ?? '')) return { problem: 'GITHUB_RUN_ID is not a run number.' };
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) return { problem: 'GITHUB_SHA is not a commit.' };
  return {
    problem: null,
    run: {
      server,
      repo,
      url: `${server}/${repo}/actions/runs/${id}`,
      commit: `${server}/${repo}/commit/${sha}`,
      sha,
      ref,
    },
  };
}

/** A day as the report writes it, `YYYY-MM-DD`, in UTC like the schedule. */
const day = (date) => date.toISOString().slice(0, 10);

/** The commit as a short link. */
const commitLink = (run) => `[${run.sha.slice(0, 7)}](${run.commit})`;

/** Each job and its result, as a Markdown table. */
function jobsTable(jobs) {
  return ['| Job | Result |', '| --- | --- |', ...jobs.map(({ job, result }) => `| \`${job}\` | ${result} |`)].join(
    '\n',
  );
}

/** The body of a new nightly issue, for a red night: when, which commit, each job's result and the run. */
export function issueBody({ jobs, run, date }) {
  return [
    `The nightly run of the whole suite on \`main\` failed on ${day(date)} (UTC), at ${commitLink(run)}.`,
    '',
    jobsTable(jobs),
    '',
    `Run: ${run.url}`,
    '',
    'Fix `main` first: every pull request and the next release will meet the same failure. Each red night comments ' +
      'here, and the first green night closes this issue. ' +
      `([Quality gates](${run.server}/${run.repo}/blob/main/docs/QUALITY-GATES.md), R18; #343.)`,
    '',
  ].join('\n');
}

/** The comment for another red night on an issue that is already open. */
export function stillFailingComment({ jobs, run, date }) {
  return [
    `Still failing on ${day(date)} (UTC), at ${commitLink(run)}.`,
    '',
    jobsTable(jobs),
    '',
    `Run: ${run.url}`,
    '',
  ].join('\n');
}

/** The comment that closes the issue on a green night. */
export function greenComment({ run, date }) {
  return [
    `Green again on ${day(date)} (UTC), at ${commitLink(run)}: every job of the nightly run passed. Closing.`,
    '',
    `Run: ${run.url}`,
    '',
  ].join('\n');
}

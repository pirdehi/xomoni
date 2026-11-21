// The nightly run's report (#343, R18 of docs/QUALITY-GATES.md), run by the `report` job of
// .github/workflows/nightly.yml once the night's jobs have ended; anyone can run it with GitHub's variables set.
//
//   node tooling/nightly-report.mjs ci=<result> audit=<result>
//
// A red night, where a job failed or was cancelled, opens the issue "Nightly run failing", labelled `nightly`, or
// comments on it when it is already open. A green night closes it with a comment. Only for main: a run by hand from
// another branch leaves the issue alone. The first time it opens the issue, it creates the `nightly` label.
//
// `gh` reads its token from GH_TOKEN and the repository from GH_REPO, both from the environment: neither is ever put on
// a command line or printed. The run's address comes from GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID and
// GITHUB_SHA. Node's built-ins only, so the job that runs it installs nothing and runs no dependency's code.
import { execFileSync } from 'node:child_process';
import {
  NIGHTLY_LABEL,
  NIGHTLY_REF,
  NIGHTLY_TITLE,
  greenComment,
  issueBody,
  openNightlyIssues,
  parseResults,
  plan,
  runFromEnv,
  stillFailingComment,
  verdict,
} from './nightly-lib.mjs';

/** Runs `gh` with `args`, never through a shell, and returns what it printed. Throws when it fails. */
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
}

/** The first line of what a failed `gh` said, for an annotation. */
function why(error) {
  return String(error.stderr || error.message || error)
    .trim()
    .split('\n')[0];
}

/** Stops with `message` as an error annotation on the run. */
function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

const { jobs, problem } = parseResults(process.argv.slice(2));
if (problem) {
  console.error('Usage: node tooling/nightly-report.mjs ci=<result> [<job>=<result> ...]');
  fail(problem);
}
const { run, problem: badRun } = runFromEnv(process.env);
if (badRun) fail(badRun);
const results = jobs.map(({ job, result }) => `${job}: ${result}`).join(', ');
if (run.ref !== NIGHTLY_REF) {
  console.log(
    `::notice::This run is on ${run.ref || 'no ref'}, not main (${results}). The nightly issue is left as it is.`,
  );
  process.exit(0);
}
const night = verdict(jobs);
if (!night) fail(`A skipped job proves nothing (${results}). The nightly issue is left as it is.`);

let issues;
try {
  const endpoint = `repos/{owner}/{repo}/issues?labels=${NIGHTLY_LABEL}&state=open&per_page=100`;
  issues = JSON.parse(gh(['api', endpoint]));
  if (!Array.isArray(issues)) throw new Error('GitHub did not answer with a list of issues');
} catch (error) {
  fail(`Couldn't read the nightly issues with gh: ${why(error)}`);
}

const date = new Date();
const next = plan(night, openNightlyIssues(issues));
try {
  if (next.action === 'open') {
    // Created here, once, so no one has to set it up by hand. An existing label is left as it is.
    try {
      gh([
        'label',
        'create',
        NIGHTLY_LABEL,
        '--color',
        'B60205',
        '--description',
        'The nightly run on main is failing',
      ]);
    } catch (error) {
      if (!/already exists/i.test(why(error))) console.error(`::warning::Couldn't create the label: ${why(error)}`);
    }
    const url = gh([
      'issue',
      'create',
      '--title',
      NIGHTLY_TITLE,
      '--label',
      NIGHTLY_LABEL,
      '--body',
      issueBody({ jobs, run, date }),
    ]);
    console.log(`Red night (${results}): opened ${url.trim()}`);
  } else if (next.action === 'comment') {
    gh(['issue', 'comment', String(next.issue.number), '--body', stillFailingComment({ jobs, run, date })]);
    console.log(`Red night (${results}): commented on #${next.issue.number}, ${next.issue.html_url ?? ''}`.trimEnd());
    if (next.extra.length) {
      const others = next.extra.map((issue) => `#${issue.number}`).join(', ');
      console.error(`::warning::More than one nightly issue is open: ${others} too. Keep #${next.issue.number}.`);
    }
  } else if (next.action === 'close') {
    for (const issue of next.issues) {
      const number = String(issue.number);
      gh(['issue', 'close', number, '--reason', 'completed', '--comment', greenComment({ run, date })]);
      console.log(`Green night: closed #${number}`);
    }
  } else {
    console.log(`Green night (${results}): no nightly issue is open.`);
  }
} catch (error) {
  fail(`Couldn't update the nightly issue with gh: ${why(error)}`);
}

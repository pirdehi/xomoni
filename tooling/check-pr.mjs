// The pull request policy (#339), run by the `pr-policy` job of .github/workflows/pr-policy.yml on every pull request,
// and again whenever its description, labels or commits change. It reads the pull request from the event file GitHub
// writes ($GITHUB_EVENT_PATH), never from an expression in the workflow, and its changed files from git. The rules are
// in tooling/pr-policy-lib.mjs. Node's built-ins only, so the job needs no `npm ci`.
//
//   GITHUB_EVENT_PATH=event.json node tooling/check-pr.mjs
//
// Prints what it found and every violation with how to fix it. Exits 1 on a violation, and 2 when it can't read the
// pull request or compare its commits.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { annotation, checkPullRequest, formatReport, parseNameStatus, readPullRequest } from './pr-policy-lib.mjs';

const inActions = process.env.GITHUB_ACTIONS === 'true';

/** Says the pull request couldn't be checked, and why, then stops with status 2. */
function cannotCheck(message) {
  console.error(`Can't check this pull request: ${message}`);
  if (inActions) console.error(annotation('pr-policy', `Can't check this pull request: ${message}`));
  process.exit(2);
}

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) cannotCheck('GITHUB_EVENT_PATH is not set. GitHub sets it in a workflow; locally, point it at a file.');

let pr;
try {
  pr = readPullRequest(JSON.parse(readFileSync(eventPath, 'utf8')));
} catch (error) {
  cannotCheck(`${eventPath}: ${error instanceof Error ? error.message : String(error)}`);
}

let changes;
try {
  // Three dots: what the pull request changes since it left its base, whatever landed on the base since.
  const diff = execFileSync('git', ['diff', '--name-status', '--no-renames', '-z', `${pr.base}...${pr.head}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  changes = parseNameStatus(diff);
} catch (error) {
  const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : String(error);
  cannotCheck(
    `git can't compare ${pr.base}...${pr.head} (${detail}). The checkout needs the whole history: fetch-depth: 0.`,
  );
}

const result = checkPullRequest(pr, changes);
console.log(formatReport(result));
if (result.violations.length) {
  if (inActions)
    for (const { rule, title, problem, fix } of result.violations)
      console.log(annotation(`${rule} ${title}`, `${problem} ${fix}`));
  process.exit(1);
}

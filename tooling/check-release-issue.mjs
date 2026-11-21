// The release's readiness check (#340, ADR-0037), run by the release workflow's `readiness` job; anyone can run it.
//
//   node tooling/check-release-issue.mjs vX.Y.Z
//
// Finds the open issue labelled `release` and titled exactly `Release vX.Y.Z`, opened by someone who can push to the
// repository, and fails unless every box under its `## Before the tag` section is ticked. It prints every problem and
// each unticked box. With the one issue found, it writes `issue=<number>` to $GITHUB_OUTPUT, for the publish job to
// comment the release there and close it.
//
// `gh` reads its token from GH_TOKEN and the repository from GH_REPO, both from the environment: neither is ever put
// on a command line or printed. Without GH_REPO, `gh` takes the repository of the folder it runs in.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { BEFORE_THE_TAG, RELEASE_LABEL, releaseIssueReadiness, tagProblem } from './release-issue-lib.mjs';

const tag = process.argv[2];
if (!tag) {
  console.error('Usage: node tooling/check-release-issue.mjs vX.Y.Z');
  process.exit(1);
}
const badTag = tagProblem(tag);
if (badTag) {
  console.error(`::error::${badTag}`);
  process.exit(1);
}

let issues;
try {
  // The REST API, for each issue's author_association. A hundred open release issues would be ninety-nine too many.
  const endpoint = `repos/{owner}/{repo}/issues?labels=${RELEASE_LABEL}&state=open&per_page=100`;
  const json = execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
  issues = JSON.parse(json);
  if (!Array.isArray(issues)) throw new Error('GitHub did not answer with a list of issues');
} catch (error) {
  const detail = String(error.stderr || error.message || error)
    .trim()
    .split('\n')[0];
  console.error(`::error::Couldn't read the release issues with gh: ${detail}`);
  process.exit(1);
}

const { problems, issue, unticked, ticked } = releaseIssueReadiness(issues, tag);
if (issue && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `issue=${issue.number}\n`);

if (problems.length) {
  // `::error::` makes each one an annotation on the release's run in GitHub Actions.
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(`\nNot ready to release ${tag}${issue ? `: ${issue.url}` : '.'}`);
  if (unticked.length) {
    console.error(`Unticked under "${BEFORE_THE_TAG}" (${unticked.length}):`);
    for (const text of unticked) console.error(`  - [ ] ${text}`);
    console.error('Tick each one once it is checked, with its proof, then re-run the failed jobs.');
  }
  process.exit(1);
}
console.log(
  `Release issue #${issue.number} is complete: ${ticked} boxes ticked under "${BEFORE_THE_TAG}". ${issue.url}`,
);

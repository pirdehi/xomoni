// The check after each release (#343, R18 of docs/QUALITY-GATES.md), run by .github/workflows/release-check.yml; anyone
// can run it with GitHub's variables set. Two commands, one per job:
//
//   node tooling/check-published-release.mjs check vX.Y.Z    # reads only
//   node tooling/check-published-release.mjs report vX.Y.Z   # comments on the release issue
//
// `check` downloads the release as people get it and checks, without stopping at the first failure:
// - the release has xomoni-extension.zip, xomoni-extension-X.Y.Z.zip and SHA256SUMS;
// - both zips match SHA256SUMS (`sha256sum --check`), and are the same file;
// - each zip was built by release.yml from the tag (`gh attestation verify`);
// - `releases/latest` is the newest release, and the zip the install page links, releases/latest/download/
//   xomoni-extension.zip, matches that release's SHA256SUMS.
// It prints each result, writes them as `report=<JSON>` to $GITHUB_OUTPUT, and fails when one failed.
//
// `report` reads that JSON from REPORT and the check job's result from RESULT, then comments both on the version's
// release issue, open or closed. A version without one gets a new issue: closed when the check passed, left open when
// it failed, until a later check passes.
//
// `gh` reads its token from GH_TOKEN and the repository from GH_REPO, both from the environment: neither is ever put on
// a command line or printed. Node's built-ins only, so neither job installs anything or runs a dependency's code. The
// zips are only hashed and verified, never opened.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFromEnv } from './nightly-lib.mjs';
import {
  ACTIONS_BOT,
  SUMS,
  newIssueBody,
  newestRelease,
  parseReport,
  parseSums,
  passed,
  releaseIssueFor,
  reportBody,
} from './published-release-lib.mjs';
import { RELEASE_LABEL, releaseIssueTitle, tagProblem } from './release-issue-lib.mjs';
import { releaseZips, versionOfTag } from './release-lib.mjs';

/** Runs `gh` with `args`, never through a shell, and returns what it printed. Throws when it fails. */
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
}

/** The first line of what a failed command said. */
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

/**
 * Checks `names` in `dir` against the SHA256SUMS there with `sha256sum --check`: each must be listed, and match.
 * `--ignore-missing` skips what the file lists but `dir` doesn't hold, such as the store build; since it then passes
 * when nothing was checked, every name is first looked up. Returns whether all match, and what was found.
 */
function checkSums(dir, names) {
  const { sums, problems } = parseSums(readFileSync(join(dir, SUMS), 'utf8'));
  const unlisted = names.filter((name) => !sums.has(name));
  if (problems.length || unlisted.length) {
    const listed = unlisted.length ? [`${SUMS} doesn't list ${unlisted.join(', ')}`] : [];
    return { ok: false, sums, detail: [...listed, ...problems.map((p) => `${SUMS}: ${p}`)].join('; ') };
  }
  const result = spawnSync('sha256sum', ['--check', '--strict', '--ignore-missing', SUMS], {
    cwd: dir,
    encoding: 'utf8',
  });
  const said = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').filter(Boolean).join('; ');
  return { ok: result.status === 0, sums, detail: said || `sha256sum ended with ${result.status ?? result.error}` };
}

/** Runs every check of the release `tag`, as described at the top, and returns them in order. */
function checkRelease(tag, run, dir) {
  const version = versionOfTag(tag);
  const { latest, versioned } = releaseZips(version);
  const zips = [latest, versioned];
  const checks = [];
  const add = (what, ok, detail) => checks.push({ what, ok, detail });

  const files = join(dir, 'release');
  const has = `The release has ${latest}, ${versioned} and ${SUMS}`;
  let downloaded = false;
  try {
    gh(['release', 'download', tag, '--dir', files, ...[...zips, SUMS].flatMap((name) => ['--pattern', name])]);
    const missing = [...zips, SUMS].filter((name) => !existsSync(join(files, name)));
    downloaded = missing.length === 0;
    add(has, downloaded, downloaded ? 'Downloaded.' : `Missing: ${missing.join(', ')}.`);
  } catch (error) {
    add(has, false, `gh release download: ${why(error)}`);
  }

  const matching = `Both zips match ${SUMS} (sha256sum --check), and are the same file`;
  if (downloaded) {
    const { ok, sums, detail } = checkSums(files, zips);
    const differ = sums.has(latest) && sums.has(versioned) && sums.get(latest) !== sums.get(versioned);
    add(matching, ok && !differ, differ ? `${detail}; the two zips differ, but are one build under two names` : detail);
  } else add(matching, false, 'Not checked: the files are missing.');

  for (const zip of zips) {
    const what = `${zip} was built by release.yml from ${tag} (gh attestation verify)`;
    if (!downloaded) {
      add(what, false, 'Not checked: the files are missing.');
      continue;
    }
    try {
      gh([
        'attestation',
        'verify',
        join(files, zip),
        '--repo',
        run.repo,
        '--signer-workflow',
        `${run.repo}/.github/workflows/release.yml`,
        '--source-ref',
        `refs/tags/${tag}`,
        '--deny-self-hosted-runners',
      ]);
      add(what, true, 'Verified.');
    } catch (error) {
      add(what, false, why(error));
    }
  }

  const serves = "releases/latest serves the newest release, and its zip matches that release's SHA256SUMS";
  let newest;
  let current;
  try {
    const releases = JSON.parse(gh(['api', 'repos/{owner}/{repo}/releases?per_page=100']));
    if (!Array.isArray(releases)) throw new Error('GitHub did not answer with a list of releases');
    newest = newestRelease(releases);
    current = JSON.parse(gh(['api', 'repos/{owner}/{repo}/releases/latest']))?.tag_name;
  } catch (error) {
    add(serves, false, `Couldn't read the releases: ${why(error)}`);
    return checks;
  }
  if (!newest) {
    add(serves, false, 'No published vX.Y.Z release.');
    return checks;
  }
  if (current !== newest) {
    add(serves, false, `releases/latest is ${String(current)}, but the newest release is ${newest}.`);
    return checks;
  }
  const at = join(dir, 'latest');
  mkdirSync(at);
  try {
    // The address the install page links, as a person's browser follows it.
    const url = `${run.server}/${run.repo}/releases/latest/download/${latest}`;
    execFileSync(
      'curl',
      ['--fail', '--silent', '--show-error', '--location', '--retry', '3', '--output', join(at, latest), url],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    if (newest === tag && downloaded) copyFileSync(join(files, SUMS), join(at, SUMS));
    else gh(['release', 'download', newest, '--dir', at, '--pattern', SUMS]);
  } catch (error) {
    add(serves, false, `Couldn't download releases/latest: ${why(error)}`);
    return checks;
  }
  const { ok, detail } = checkSums(at, [latest]);
  const note = newest === tag ? '' : ` ${tag} is not the newest release.`;
  add(serves, ok, ok ? `releases/latest is ${newest}; ${detail}.${note}` : `releases/latest is ${newest}; ${detail}`);
  return checks;
}

/** The `check` command: runs the checks, prints them, hands them to the report job, and fails if one failed. */
function check(tag, run) {
  const dir = mkdtempSync(join(tmpdir(), 'xomoni-release-check-'));
  let checks;
  try {
    checks = checkRelease(tag, run, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `report=${JSON.stringify({ tag, checks })}\n`);
  for (const { what, ok, detail } of checks) {
    if (ok) console.log(`✓ ${what}: ${detail}`);
    else console.error(`::error::${what}: ${detail}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  if (failed) {
    console.error(
      `\n${failed} of ${checks.length} checks of ${tag} failed. See "When the check after the release fails" in docs/RELEASING.md.`,
    );
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} checks of ${tag} passed.`);
}

/** The `report` command: comments the check's result on the release issue, or opens one. */
function report(tag, run) {
  const result = process.env.RESULT ?? '';
  if (!['success', 'failure', 'cancelled', 'skipped'].includes(result))
    fail(`RESULT is "${result}", not a job result GitHub gives. Nothing was reported.`);
  const { report: parsed, problem } = parseReport(process.env.REPORT, tag);
  const ok = passed(result, parsed);
  const args = { tag, result, report: parsed, problem, run };

  let issues;
  try {
    // Newest first: past a hundred release issues, the oldest drop out.
    const endpoint = `repos/{owner}/{repo}/issues?labels=${RELEASE_LABEL}&state=all&sort=created&direction=desc&per_page=100`;
    issues = JSON.parse(gh(['api', endpoint]));
    if (!Array.isArray(issues)) throw new Error('GitHub did not answer with a list of issues');
  } catch (error) {
    fail(`Couldn't read the release issues with gh: ${why(error)}`);
  }
  const issue = releaseIssueFor(issues, tag);
  try {
    if (issue) {
      gh(['issue', 'comment', String(issue.number), '--body', reportBody(args)]);
      console.log(
        `The check ${ok ? 'passed' : 'failed'}: commented on #${issue.number}, ${issue.html_url ?? ''}`.trimEnd(),
      );
      // An issue this check opened while the check failed is closed once it passes, as its body says. A person's
      // release issue is the release workflow's to close, and stays as it is.
      if (ok && issue.user?.login === ACTIONS_BOT && String(issue.state).toLowerCase() === 'open') {
        gh(['issue', 'close', String(issue.number), '--reason', 'completed']);
        console.log(`Closed #${issue.number}, which this check opened.`);
      }
      return;
    }
    const title = releaseIssueTitle(tag);
    const url = gh([
      'issue',
      'create',
      '--title',
      title,
      '--label',
      RELEASE_LABEL,
      '--body',
      newIssueBody(args),
    ]).trim();
    if (ok) gh(['issue', 'close', url, '--reason', 'completed']);
    console.log(
      `The check ${ok ? 'passed' : 'failed'}: no issue was titled "${title}", so opened ${url}${ok ? ', then closed it' : ''}.`,
    );
  } catch (error) {
    fail(`Couldn't report on the release issue with gh: ${why(error)}`);
  }
}

const [command, tag] = process.argv.slice(2);
if (!['check', 'report'].includes(command) || !tag) {
  console.error('Usage: node tooling/check-published-release.mjs check|report vX.Y.Z');
  process.exit(1);
}
const badTag = tagProblem(tag);
if (badTag) fail(badTag);
const { run, problem: badRun } = runFromEnv(process.env);
if (badRun) fail(badRun);
if (command === 'check') check(tag, run);
else report(tag, run);

// Tests for the nightly run's report (#343): the rules in tooling/nightly-lib.mjs, and tooling/nightly-report.mjs run
// as the workflow's `report` job runs it, against a fake `gh`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  NIGHTLY_LABEL,
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
import { fakeCommands } from './test-fakes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(40);
/** The variables GitHub sets in the nightly's report job. */
const GITHUB = {
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'pirdehi/xomoni',
  GITHUB_RUN_ID: '777',
  GITHUB_SHA: SHA,
  GITHUB_REF: 'refs/heads/main',
};
const RUN_URL = 'https://github.com/pirdehi/xomoni/actions/runs/777';

/** An issue as GitHub's REST API lists it, by default the open nightly issue. */
function issue(fields = {}) {
  const number = fields.number ?? 50;
  return {
    number,
    title: NIGHTLY_TITLE,
    state: 'open',
    labels: [{ name: NIGHTLY_LABEL }],
    html_url: `https://github.com/pirdehi/xomoni/issues/${number}`,
    ...fields,
  };
}

describe('the nightly report’s rules (#343)', () => {
  it('reads job=result arguments in order', () => {
    assert.deepEqual(parseResults(['ci=success', 'audit=failure']), {
      jobs: [
        { job: 'ci', result: 'success' },
        { job: 'audit', result: 'failure' },
      ],
      problem: null,
    });
    for (const result of ['success', 'failure', 'cancelled', 'skipped'])
      assert.equal(parseResults([`ci=${result}`]).problem, null, result);
  });

  it('refuses no argument, a bad argument, a job given twice, or a result GitHub never gives', () => {
    assert.match(parseResults([]).problem, /^No job results/);
    for (const arg of ['ci', '=success', 'CI=success', 'ci;rm=success', 'ci=ok', 'ci=', 'ci=success\nx'])
      assert.ok(parseResults([arg]).problem, JSON.stringify(arg));
    assert.equal(parseResults(['ci=success', 'ci=failure']).problem, 'ci is given twice.');
    assert.equal(parseResults(['ci=success', 'ci=failure']).jobs.length, 0);
  });

  it('calls a night red when a job failed or was cancelled, green only when every job succeeded', () => {
    const night = (...results) => verdict(results.map((result, i) => ({ job: `j${i}`, result })));
    assert.equal(night('success', 'success'), 'green');
    assert.equal(night('failure', 'success'), 'red');
    assert.equal(night('success', 'cancelled'), 'red');
    assert.equal(night('skipped', 'failure'), 'red');
    assert.equal(night('success', 'skipped'), null);
    assert.equal(night(), null);
  });

  it('counts only open issues labelled nightly and titled exactly, oldest first', () => {
    const others = [
      issue({ number: 1, title: 'Nightly run failing ' }),
      issue({ number: 2, title: 'nightly run failing' }),
      issue({ number: 3, labels: [] }),
      issue({ number: 4, labels: [{ name: 'release' }] }),
      issue({ number: 5, state: 'closed' }),
      issue({ number: 6, pull_request: { url: 'x' } }),
      issue({ number: '7' }),
      issue({ number: 0 }),
    ];
    assert.deepEqual(openNightlyIssues(others), []);
    const found = openNightlyIssues([issue({ number: 90 }), ...others, issue({ number: 12, labels: ['nightly'] })]);
    assert.deepEqual(
      found.map((i) => i.number),
      [12, 90],
    );
  });

  it('opens an issue on a red night, comments on the oldest open one, and closes all on a green night', () => {
    const [a, b] = [issue({ number: 3 }), issue({ number: 8 })];
    assert.deepEqual(plan('red', []), { action: 'open' });
    assert.deepEqual(plan('red', [a, b]), { action: 'comment', issue: a, extra: [b] });
    assert.deepEqual(plan('green', [a, b]), { action: 'close', issues: [a, b] });
    assert.deepEqual(plan('green', []), { action: 'none' });
    assert.deepEqual(plan(null, [a]), { action: 'none' });
  });

  it('builds the run’s address from GitHub’s variables, and refuses odd ones', () => {
    assert.deepEqual(runFromEnv(GITHUB), {
      problem: null,
      run: {
        server: 'https://github.com',
        repo: 'pirdehi/xomoni',
        url: RUN_URL,
        commit: `https://github.com/pirdehi/xomoni/commit/${SHA}`,
        sha: SHA,
        ref: 'refs/heads/main',
      },
    });
    for (const [name, value] of [
      ['GITHUB_SERVER_URL', 'http://github.com'],
      ['GITHUB_SERVER_URL', 'https://github.com/x y'],
      ['GITHUB_REPOSITORY', 'pirdehi'],
      ['GITHUB_REPOSITORY', 'pirdehi/xomoni/x'],
      ['GITHUB_RUN_ID', '12a'],
      ['GITHUB_RUN_ID', undefined],
      ['GITHUB_SHA', 'main'],
    ])
      assert.ok(runFromEnv({ ...GITHUB, [name]: value }).problem, `${name}=${value}`);
  });

  it('writes the day, the commit, each job and the run into the issue and its comments', () => {
    const { run } = runFromEnv(GITHUB);
    const date = new Date('2026-11-22T02:40:00Z');
    const jobs = [
      { job: 'ci', result: 'failure' },
      { job: 'audit', result: 'success' },
    ];
    const body = issueBody({ jobs, run, date });
    assert.ok(
      body.startsWith('The nightly run of the whole suite on `main` failed on 2026-11-22 (UTC), at [aaaaaaa]('),
    );
    assert.ok(body.includes('| `ci` | failure |\n| `audit` | success |'), body);
    assert.ok(body.includes(`Run: ${RUN_URL}`));
    assert.ok(body.includes('https://github.com/pirdehi/xomoni/blob/main/docs/QUALITY-GATES.md'));
    const again = stillFailingComment({ jobs, run, date });
    assert.ok(again.startsWith('Still failing on 2026-11-22 (UTC)'));
    assert.ok(again.includes('| `ci` | failure |') && again.includes(`Run: ${RUN_URL}`));
    const green = greenComment({ run, date });
    assert.ok(green.startsWith('Green again on 2026-11-22 (UTC)') && green.includes(`Run: ${RUN_URL}`));
  });
});

describe('nightly-report.mjs (#343)', () => {
  const SCRIPT = join(ROOT, 'tooling/nightly-report.mjs');
  const TOKEN = 'ghs_a-token-that-must-never-show';
  const LIST = ['api', 'repos/{owner}/{repo}/issues?labels=nightly&state=open&per_page=100'];

  /** Runs the report with `args` and a fake `gh` that lists `open` (or fails with `listError`) and follows `rules`. */
  function report({ args = ['ci=failure', 'audit=success'], open = [], listError, rules = [], env = {} } = {}) {
    const list = listError
      ? { args: LIST, stderr: listError, status: 1 }
      : { args: LIST, stdout: JSON.stringify(open) };
    const fakes = fakeCommands(['gh'], {
      gh: [
        list,
        ...rules,
        { args: ['label', 'create'] },
        { args: ['issue', 'create'], stdout: 'https://github.com/pirdehi/xomoni/issues/99\n' },
        { args: ['issue', 'comment'] },
        { args: ['issue', 'close'] },
      ],
    });
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: fakes.dir,
      env: { ...fakes.env, ...GITHUB, GH_TOKEN: TOKEN, GH_REPO: 'pirdehi/xomoni', ...env },
      encoding: 'utf8',
    });
    const calls = fakes.calls();
    fakes.cleanup();
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      calls,
      args: calls.map((c) => c.args),
    };
  }

  /** The value after `flag` in a call's arguments. */
  const flag = (args, name) => args[args.indexOf(name) + 1];

  it('opens the issue on the first red night, creating the label first', () => {
    const run = report();
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(
      run.args.map((args) => args.slice(0, 2)),
      [
        ['api', LIST[1]],
        ['label', 'create'],
        ['issue', 'create'],
      ],
    );
    assert.equal(run.args[1][2], 'nightly');
    const create = run.args[2];
    assert.equal(flag(create, '--title'), 'Nightly run failing');
    assert.equal(flag(create, '--label'), 'nightly');
    assert.match(flag(create, '--body'), /failed on \d{4}-\d{2}-\d{2} \(UTC\)/);
    assert.ok(flag(create, '--body').includes('| `ci` | failure |'));
    assert.ok(flag(create, '--body').includes(`Run: ${RUN_URL}`));
    assert.match(run.stdout, /opened https:\/\/github\.com\/pirdehi\/xomoni\/issues\/99/);
  });

  it('opens it when the label already exists, and still opens it with a warning when the label can’t be made', () => {
    const exists = report({
      rules: [
        { args: ['label', 'create'], status: 1, stderr: 'label with name "nightly" already exists; use `--force`' },
      ],
    });
    assert.equal(exists.status, 0, exists.stderr);
    assert.doesNotMatch(exists.stderr, /::warning::/);
    assert.deepEqual(exists.args.at(-1).slice(0, 2), ['issue', 'create']);
    const denied = report({
      rules: [{ args: ['label', 'create'], status: 1, stderr: 'HTTP 403: Resource not accessible' }],
    });
    assert.equal(denied.status, 0, denied.stderr);
    assert.match(denied.stderr, /::warning::Couldn't create the label: HTTP 403/);
    assert.deepEqual(denied.args.at(-1).slice(0, 2), ['issue', 'create']);
  });

  it('comments on the open issue on another red night, and opens no second one', () => {
    const run = report({ open: [issue({ number: 50 })], args: ['ci=success', 'audit=failure'] });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(
      run.args.map((args) => args.slice(0, 3)),
      [
        ['api', LIST[1]],
        ['issue', 'comment', '50'],
      ],
    );
    assert.match(flag(run.args[1], '--body'), /^Still failing on /);
    assert.ok(flag(run.args[1], '--body').includes('| `audit` | failure |'));
  });

  it('comments on the oldest when several are open, and names the others', () => {
    const run = report({ open: [issue({ number: 61 }), issue({ number: 50 })] });
    assert.deepEqual(run.args[1].slice(0, 3), ['issue', 'comment', '50']);
    assert.equal(run.args.length, 2);
    assert.match(run.stderr, /::warning::More than one nightly issue is open: #61 too\. Keep #50\./);
  });

  it('counts a cancelled job as red', () => {
    const run = report({ args: ['ci=cancelled', 'audit=success'] });
    assert.deepEqual(run.args.at(-1).slice(0, 2), ['issue', 'create']);
  });

  it('closes every open nightly issue with a comment on a green night', () => {
    const run = report({ args: ['ci=success', 'audit=success'], open: [issue({ number: 50 }), issue({ number: 61 })] });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(
      run.args.slice(1).map((args) => args.slice(0, 5)),
      [
        ['issue', 'close', '50', '--reason', 'completed'],
        ['issue', 'close', '61', '--reason', 'completed'],
      ],
    );
    assert.match(flag(run.args[1], '--comment'), /^Green again on .*every job of the nightly run passed\. Closing\./);
  });

  it('does nothing on a green night with no issue open, and never touches an issue that isn’t the nightly one', () => {
    const stranger = issue({ number: 70, title: 'Nightly run failing?' });
    const run = report({ args: ['ci=success', 'audit=success'], open: [stranger] });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.args, [LIST]);
    assert.match(run.stdout, /no nightly issue is open/);
  });

  it('leaves the issue alone for a run from another branch', () => {
    for (const ref of ['refs/heads/feat/x', 'refs/tags/v0.5.0', '']) {
      const run = report({ env: { GITHUB_REF: ref } });
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(run.calls, [], `${ref}: no gh call`);
      assert.match(run.stdout, /::notice::.*not main/);
    }
  });

  it('changes nothing when a job was skipped, and says so', () => {
    const run = report({ args: ['ci=success', 'audit=skipped'] });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /::error::A skipped job proves nothing/);
    assert.deepEqual(run.calls, []);
  });

  it('refuses bad arguments or variables before calling gh', () => {
    for (const args of [[], ['ci'], ['ci=passed'], ['ci=success', 'ci=success']]) {
      const run = report({ args });
      assert.equal(run.status, 1, JSON.stringify(args));
      assert.match(run.stderr, /^Usage: node tooling\/nightly-report\.mjs/m);
      assert.deepEqual(run.calls, []);
    }
    const odd = report({ env: { GITHUB_RUN_ID: '1; rm -rf /' } });
    assert.equal(odd.status, 1);
    assert.match(odd.stderr, /::error::GITHUB_RUN_ID is not a run number\./);
    assert.deepEqual(odd.calls, []);
  });

  it('fails, saying why, when gh can’t list or update the issues', () => {
    const list = report({ listError: 'HTTP 401: Bad credentials' });
    assert.equal(list.status, 1);
    assert.match(list.stderr, /::error::Couldn't read the nightly issues with gh: HTTP 401: Bad credentials/);
    const update = report({ open: [issue()], rules: [{ args: ['issue', 'comment'], status: 1, stderr: 'HTTP 502' }] });
    assert.equal(update.status, 1);
    assert.match(update.stderr, /::error::Couldn't update the nightly issue with gh: HTTP 502/);
    const odd = report({ open: { message: 'Not Found' } });
    assert.equal(odd.status, 1);
    assert.match(odd.stderr, /GitHub did not answer with a list of issues/);
  });

  it('gives gh the token and repository through its environment only, and never prints the token', () => {
    const run = report();
    for (const call of run.calls) {
      assert.equal(call.token, TOKEN);
      assert.equal(call.repo, 'pirdehi/xomoni');
      assert.ok(!call.args.some((arg) => arg.includes(TOKEN)), 'never on the command line');
    }
    assert.ok(!`${run.stdout}${run.stderr}`.includes(TOKEN), 'never printed');
  });
});

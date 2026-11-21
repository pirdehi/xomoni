// Tests for the check after each release (#343): the rules in tooling/published-release-lib.mjs, and
// tooling/check-published-release.mjs run as release-check.yml's jobs run it, against a fake `gh` and `curl` and the
// real `sha256sum`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
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
import { fakeCommands } from './test-fakes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = 'v0.5.0';
const ZIPS = ['xomoni-extension.zip', 'xomoni-extension-0.5.0.zip'];
const RUN = {
  server: 'https://github.com',
  repo: 'pirdehi/xomoni',
  url: 'https://github.com/pirdehi/xomoni/actions/runs/777',
};
// The check runs GNU's sha256sum on GitHub's runners; macOS has a compatible one.
const SHA256SUM = spawnSync('sha256sum', ['--version'], { encoding: 'utf8' }).status === 0;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** SHA256SUMS as the release writes it, for `files` (name → bytes). */
const sumsOf = (files) =>
  Object.entries(files)
    .map(([name, bytes]) => `${sha256(bytes)}  ${name}\n`)
    .join('');

/** An issue as GitHub's REST API lists it, by default the maintainer's release issue, closed by the release. */
function issue(fields = {}) {
  const number = fields.number ?? 354;
  return {
    number,
    title: `Release ${TAG}`,
    state: 'closed',
    state_reason: 'completed',
    labels: [{ name: 'release' }, { name: 'quality-gate' }],
    author_association: 'OWNER',
    user: { login: 'pirdehi' },
    html_url: `https://github.com/pirdehi/xomoni/issues/${number}`,
    ...fields,
  };
}

/** A release as GitHub's REST API lists it. */
const release = (tag, fields = {}) => ({ tag_name: tag, draft: false, prerelease: false, ...fields });

describe('the check after each release: its rules (#343)', () => {
  it('reads SHA256SUMS as sha256sum writes it, text or binary, and flags anything else', () => {
    const hash = 'ab'.repeat(32);
    const { sums, problems } = parseSums(`${hash}  a.zip\r\n\n${hash.toUpperCase()} *b c.zip\n`);
    assert.deepEqual(
      [...sums],
      [
        ['a.zip', hash],
        ['b c.zip', hash],
      ],
    );
    assert.deepEqual(problems, []);
    const bad = parseSums(`${hash} a.zip\nnot a line\n${hash}  b.zip\n${hash}  b.zip\n${hash.slice(1)}  c.zip\n`);
    assert.deepEqual(bad.problems, [
      'line 1 is not "<sha256>  <file>"',
      'line 2 is not "<sha256>  <file>"',
      'b.zip is listed twice',
      'line 5 is not "<sha256>  <file>"',
    ]);
    assert.deepEqual(parseSums(null).problems, []);
  });

  it('finds the newest published vX.Y.Z by version, not by date or list order', () => {
    const releases = [
      release('v0.9.0'),
      release('v0.10.0'),
      release('v0.11.0', { draft: true }),
      release('v0.12.0', { prerelease: true }),
      release('v1.0.0-rc.1'),
      release('nightly'),
      null,
    ];
    assert.equal(newestRelease(releases), 'v0.10.0');
    assert.equal(newestRelease([release('v0.2.1'), release('v0.2.0')]), 'v0.2.1');
    assert.equal(newestRelease([release('v0.3.0', { draft: true })]), null);
    assert.equal(newestRelease([]), null);
  });

  it('finds the version’s release issue even closed, only when opened by someone who can push or by the check', () => {
    assert.equal(releaseIssueFor([issue()], TAG).number, 354);
    assert.equal(releaseIssueFor([issue({ state: 'open', state_reason: null })], TAG).number, 354);
    for (const association of ['MEMBER', 'COLLABORATOR'])
      assert.equal(releaseIssueFor([issue({ author_association: association })], TAG).number, 354);
    const bot = issue({ number: 400, author_association: 'NONE', user: { login: ACTIONS_BOT, type: 'Bot' } });
    assert.equal(releaseIssueFor([bot], TAG).number, 400);
    const none = [
      issue({ author_association: 'NONE' }),
      issue({ author_association: 'CONTRIBUTOR', user: { login: 'github-actions' } }),
      issue({ title: 'Release v0.5.0 ' }),
      issue({ title: 'Release v0.4.0' }),
      issue({ labels: [] }),
      issue({ pull_request: { url: 'x' } }),
      issue({ number: '354' }),
    ];
    assert.equal(releaseIssueFor(none, TAG), null);
  });

  it('prefers a person’s issue, then the one closed as completed, then the newest', () => {
    const bot = issue({ number: 500, author_association: 'NONE', user: { login: ACTIONS_BOT } });
    const duplicate = issue({ number: 360, state_reason: 'duplicate' });
    const open = issue({ number: 370, state: 'open', state_reason: null });
    const done = issue({ number: 354 });
    assert.equal(releaseIssueFor([bot, duplicate, open, done], TAG).number, 354);
    assert.equal(releaseIssueFor([bot, duplicate, open], TAG).number, 370);
    assert.equal(releaseIssueFor([bot, duplicate], TAG).number, 360);
    assert.equal(releaseIssueFor([done, issue({ number: 380 })], TAG).number, 380);
  });

  it('takes the check job’s report only when it is about this tag and shaped as expected', () => {
    const checks = [{ what: 'A', ok: true, detail: 'fine', extra: 'dropped' }];
    assert.deepEqual(parseReport(JSON.stringify({ tag: TAG, checks }), TAG), {
      report: { tag: TAG, checks: [{ what: 'A', ok: true, detail: 'fine' }] },
      problem: null,
    });
    for (const [text, problem] of [
      ['', /handed over no report/],
      [undefined, /handed over no report/],
      ['{', /not JSON/],
      [JSON.stringify({ tag: 'v0.4.0', checks }), /not about v0\.5\.0/],
      [JSON.stringify({ tag: TAG, checks: [] }), /no checks/],
      [JSON.stringify({ tag: TAG, checks: [{ what: 'A', ok: 'yes', detail: '' }] }), /not shaped/],
      [JSON.stringify({ tag: TAG, checks: [{ what: '', ok: true, detail: '' }] }), /not shaped/],
      [JSON.stringify({ tag: TAG, checks: [{ what: 'A', ok: true, detail: 'x'.repeat(2001) }] }), /not shaped/],
      [JSON.stringify({ tag: TAG, checks: Array(21).fill({ what: 'A', ok: true, detail: '' }) }), /not shaped/],
    ]) {
      const result = parseReport(text, TAG);
      assert.equal(result.report, null, String(text));
      assert.match(result.problem, problem);
    }
  });

  it('passes only when the job succeeded and every check is ok', () => {
    const report = (...oks) => ({ tag: TAG, checks: oks.map((ok) => ({ what: 'A', ok, detail: '' })) });
    assert.equal(passed('success', report(true, true)), true);
    assert.equal(passed('success', report(true, false)), false);
    assert.equal(passed('failure', report(true, true)), false);
    assert.equal(passed('success', null), false);
  });

  it('reports each check in a table, with what a tool said kept as inert text', () => {
    const report = {
      tag: TAG,
      checks: [
        { what: 'The release has its files', ok: true, detail: 'Downloaded.' },
        { what: 'a | b', ok: false, detail: 'line one\nline two | @pirdehi `code` <b>x</b>' },
        { what: 'a \\| b', ok: false, detail: 'C:\\path\\| end' },
      ],
    };
    const body = reportBody({ tag: TAG, result: 'failure', report, problem: null, run: RUN });
    assert.ok(body.startsWith('### The check after the release: failed\n'), body);
    assert.ok(body.includes('[the release](https://github.com/pirdehi/xomoni/releases/tag/v0.5.0)'));
    assert.ok(body.includes('| ✓ | The release has its files | `Downloaded.` |'), body);
    assert.ok(body.includes("| ✗ | a \\| b | `line one line two \\| @pirdehi 'code' <b>x</b>` |"), body);
    // A backslash in the text can't escape the pipe that follows it: both are escaped.
    assert.ok(body.includes('| ✗ | a \\\\\\| b | `C:\\\\path\\\\\\| end` |'), body);
    for (const row of body.split('\n').filter((line) => line.startsWith('| ✗')))
      assert.equal(row.split(/(?<!\\)(?:\\\\)*\|/).length, 5, `four cells: ${row}`);
    assert.ok(body.includes(`Run: ${RUN.url}`));
    assert.ok(body.includes('docs/RELEASING.md#when-the-check-after-the-release-fails'));
    const ok = reportBody({ tag: TAG, result: 'success', report: { tag: TAG, checks: [report.checks[0]] }, run: RUN });
    assert.ok(ok.startsWith('### The check after the release: passed\n'));
    assert.doesNotMatch(ok, /What to do/);
  });

  it('says so when the check didn’t finish, and opens a new issue with why it is there', () => {
    const body = reportBody({ tag: TAG, result: 'failure', report: null, problem: 'No report.', run: RUN });
    assert.match(body, /: failed\n/);
    assert.ok(body.includes("The check didn't finish (its job ended as `failure`): No report."), body);
    const fresh = newIssueBody({ tag: TAG, result: 'failure', report: null, problem: 'No report.', run: RUN });
    assert.ok(fresh.startsWith('No issue titled "Release v0.5.0" was found'), fresh);
    assert.ok(fresh.includes('https://github.com/pirdehi/xomoni/blob/main/docs/QUALITY-GATES.md'));
    assert.ok(fresh.endsWith(body));
  });
});

describe('check-published-release.mjs (#343)', { skip: !SHA256SUM && 'needs sha256sum' }, () => {
  const SCRIPT = join(ROOT, 'tooling/check-published-release.mjs');
  const TOKEN = 'ghs_a-token-that-must-never-show';
  const ZIP = Buffer.from('PK\x03\x04 the release, as bytes');
  const GITHUB = {
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'pirdehi/xomoni',
    GITHUB_RUN_ID: '777',
    GITHUB_SHA: 'b'.repeat(40),
    GH_TOKEN: TOKEN,
    GH_REPO: 'pirdehi/xomoni',
  };
  const RELEASES = ['api', 'repos/{owner}/{repo}/releases?per_page=100'];
  const LATEST = ['api', 'repos/{owner}/{repo}/releases/latest'];
  const LATEST_URL = 'https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip';
  const ISSUES = [
    'api',
    'repos/{owner}/{repo}/issues?labels=release&state=all&sort=created&direction=desc&per_page=100',
  ];

  /** The files of v0.5.0's release, both zips the same build. */
  const FILES = { [ZIPS[0]]: ZIP, [ZIPS[1]]: ZIP };
  const asText = (files) =>
    Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('latin1')]));

  /**
   * Runs `command` for `tag` with a fake `gh` and `curl`: the release has `files` (and SHA256SUMS, `sums` or made from
   * `files`), GitHub lists `releases` and calls `latest` the latest, and releases/latest/download serves `served`.
   * `rules` come first. Returns the exit status, the output, $GITHUB_OUTPUT and the calls.
   */
  function run(
    command,
    { tag = TAG, files = FILES, sums, releases, latest = TAG, served = ZIP, rules = [], env = {} } = {},
  ) {
    const listed = sums ?? sumsOf(files);
    const fakes = fakeCommands(['gh', 'curl'], {
      gh: [
        ...rules,
        { args: ['release', 'download', tag], files: { ...asText(files), [SUMS]: listed } },
        { args: ['release', 'download', 'v0.5.0'], files: { [SUMS]: sumsOf(FILES) } },
        { args: ['attestation', 'verify'] },
        {
          args: RELEASES,
          stdout: JSON.stringify(releases ?? [release('v0.4.0'), release(TAG), release('v0.6.0', { draft: true })]),
        },
        { args: LATEST, stdout: JSON.stringify({ tag_name: latest }) },
        { args: ISSUES, stdout: JSON.stringify([issue()]) },
        { args: ['issue', 'comment'] },
        { args: ['issue', 'create'], stdout: 'https://github.com/pirdehi/xomoni/issues/401\n' },
        { args: ['issue', 'close'] },
      ],
      curl: [{ args: [], has: LATEST_URL, output: served.toString('latin1') }],
    });
    const output = join(fakes.dir, 'github-output');
    writeFileSync(output, '');
    const result = spawnSync(
      process.execPath,
      [SCRIPT, command, tag].filter((arg) => arg != null),
      {
        cwd: fakes.dir,
        env: { ...fakes.env, ...GITHUB, GITHUB_OUTPUT: output, ...env },
        encoding: 'utf8',
      },
    );
    const calls = fakes.calls();
    const written = readFileSync(output, 'utf8');
    fakes.cleanup();
    const report = /^report=(.*)$/m.exec(written)?.[1];
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: written,
      report: report ? JSON.parse(report) : null,
      calls,
      gh: calls.filter((c) => c.name === 'gh').map((c) => c.args),
    };
  }

  /** The checks of a report, as `ok` flags in order. */
  const oks = (result) => result.report.checks.map((check) => check.ok);
  /** The value after `flag` in a call's arguments. */
  const flag = (args, name) => args[args.indexOf(name) + 1];

  it('passes a release whose files, checksums, provenance and releases/latest are all right', () => {
    const result = run('check');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(oks(result), [true, true, true, true, true]);
    assert.deepEqual(
      result.report.checks.map((check) => check.what),
      [
        'The release has xomoni-extension.zip, xomoni-extension-0.5.0.zip and SHA256SUMS',
        'Both zips match SHA256SUMS (sha256sum --check), and are the same file',
        'xomoni-extension.zip was built by release.yml from v0.5.0 (gh attestation verify)',
        'xomoni-extension-0.5.0.zip was built by release.yml from v0.5.0 (gh attestation verify)',
        "releases/latest serves the newest release, and its zip matches that release's SHA256SUMS",
      ],
    );
    assert.match(result.report.checks[1].detail, /xomoni-extension\.zip: OK; xomoni-extension-0\.5\.0\.zip: OK/);
    assert.match(result.report.checks[4].detail, /^releases\/latest is v0\.5\.0; xomoni-extension\.zip: OK\.$/);
    assert.match(result.stdout, /All 5 checks of v0\.5\.0 passed\./);
    // One line, as $GITHUB_OUTPUT reads it.
    assert.equal(result.output.split('\n').filter(Boolean).length, 1);
  });

  it('downloads the three files and verifies each zip against the release workflow and the tag', () => {
    const result = run('check');
    const download = result.gh[0];
    assert.deepEqual(download.slice(0, 3), ['release', 'download', TAG]);
    assert.deepEqual(
      download.filter((_, i) => download[i - 1] === '--pattern'),
      [...ZIPS, SUMS],
    );
    const verify = result.gh.filter((args) => args[0] === 'attestation');
    assert.equal(verify.length, 2);
    for (const [i, args] of verify.entries()) {
      assert.ok(args[2].endsWith(`/release/${ZIPS[i]}`), args[2]);
      assert.equal(flag(args, '--repo'), 'pirdehi/xomoni');
      assert.equal(flag(args, '--signer-workflow'), 'pirdehi/xomoni/.github/workflows/release.yml');
      assert.equal(flag(args, '--source-ref'), 'refs/tags/v0.5.0');
      assert.ok(args.includes('--deny-self-hosted-runners'));
    }
    const curl = result.calls.find((c) => c.name === 'curl').args;
    assert.equal(curl.at(-1), LATEST_URL);
    for (const option of ['--fail', '--location']) assert.ok(curl.includes(option), option);
  });

  it('fails on a zip that doesn’t match SHA256SUMS, and still runs every other check', () => {
    const result = run('check', {
      files: { [ZIPS[0]]: Buffer.from('PK changed'), [ZIPS[1]]: ZIP },
      sums: sumsOf(FILES),
    });
    assert.equal(result.status, 1);
    assert.deepEqual(oks(result), [true, false, true, true, true]);
    assert.match(result.report.checks[1].detail, /xomoni-extension\.zip: FAILED/);
    assert.match(result.stderr, /::error::Both zips match SHA256SUMS.*FAILED/);
    assert.match(result.stderr, /1 of 5 checks of v0\.5\.0 failed\./);
  });

  it('fails when SHA256SUMS leaves a zip out, or the two zips are not the same build', () => {
    const unlisted = run('check', { sums: sumsOf({ [ZIPS[0]]: ZIP }) });
    assert.equal(unlisted.status, 1);
    assert.equal(unlisted.report.checks[1].ok, false);
    assert.equal(unlisted.report.checks[1].detail, "SHA256SUMS doesn't list xomoni-extension-0.5.0.zip");
    const other = Buffer.from('PK another build');
    const differ = run('check', { files: { [ZIPS[0]]: ZIP, [ZIPS[1]]: other } });
    assert.equal(differ.status, 1);
    assert.deepEqual(oks(differ), [true, false, true, true, true]);
    assert.match(differ.report.checks[1].detail, /the two zips differ, but are one build under two names$/);
    const garbled = run('check', { sums: `${sumsOf(FILES)}not a checksum\n` });
    assert.equal(garbled.report.checks[1].ok, false);
    assert.match(garbled.report.checks[1].detail, /SHA256SUMS: line 3 is not/);
  });

  it('fails when a file is missing, without checking what it can’t', () => {
    const result = run('check', { files: { [ZIPS[0]]: ZIP } });
    assert.equal(result.status, 1);
    assert.deepEqual(oks(result), [false, false, false, false, true]);
    assert.equal(result.report.checks[0].detail, 'Missing: xomoni-extension-0.5.0.zip.');
    for (const check of result.report.checks.slice(1, 4))
      assert.equal(check.detail, 'Not checked: the files are missing.');
    assert.equal(result.gh.filter((args) => args[0] === 'attestation').length, 0);
  });

  it('fails when the release can’t be downloaded at all, saying why', () => {
    const rules = [{ args: ['release', 'download', TAG], status: 1, stderr: 'release not found' }];
    const result = run('check', { rules });
    assert.equal(result.status, 1);
    assert.equal(result.report.checks[0].detail, 'gh release download: release not found');
    // releases/latest is this release, so its checksums can't be read either.
    assert.deepEqual(oks(result), [false, false, false, false, false]);
    assert.equal(result.report.checks[4].detail, "Couldn't download releases/latest: release not found");
  });

  it('fails a zip without the release workflow’s provenance, naming gh’s reason', () => {
    const rules = [
      {
        args: ['attestation', 'verify'],
        has: ZIPS[1],
        status: 1,
        stderr: '\nError: expected SourceRepositoryRef to be refs/tags/v0.5.0, got refs/heads/main\n',
      },
    ];
    const result = run('check', { rules });
    assert.equal(result.status, 1);
    assert.deepEqual(oks(result), [true, true, true, false, true]);
    assert.equal(
      result.report.checks[3].detail,
      'Error: expected SourceRepositoryRef to be refs/tags/v0.5.0, got refs/heads/main',
    );
  });

  it('fails when releases/latest is not the newest release, or serves another zip', () => {
    const behind = run('check', { latest: 'v0.4.0' });
    assert.equal(behind.status, 1);
    assert.deepEqual(oks(behind), [true, true, true, true, false]);
    assert.equal(behind.report.checks[4].detail, 'releases/latest is v0.4.0, but the newest release is v0.5.0.');
    assert.ok(!behind.calls.some((c) => c.name === 'curl'), 'nothing more to download');
    const stale = run('check', { served: Buffer.from('PK an older zip') });
    assert.equal(stale.status, 1);
    assert.deepEqual(oks(stale), [true, true, true, true, false]);
    assert.match(stale.report.checks[4].detail, /^releases\/latest is v0\.5\.0; .*xomoni-extension\.zip: FAILED/);
    const none = run('check', { releases: [release('v0.5.0', { draft: true })] });
    assert.equal(none.report.checks[4].detail, 'No published vX.Y.Z release.');
    const down = run('check', { rules: [{ args: LATEST, status: 1, stderr: 'HTTP 404: Not Found' }] });
    assert.equal(down.report.checks[4].detail, "Couldn't read the releases: HTTP 404: Not Found");
  });

  it('checks an older release too, against the newest release’s checksums for releases/latest', () => {
    const old = {
      'xomoni-extension.zip': Buffer.from('PK 0.4.0'),
      'xomoni-extension-0.4.0.zip': Buffer.from('PK 0.4.0'),
    };
    const result = run('check', { tag: 'v0.4.0', files: old });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(oks(result), [true, true, true, true, true]);
    assert.ok(
      result.gh.some((args) => args.join(' ').startsWith('release download v0.5.0 --dir ') && args.at(-1) === SUMS),
    );
    assert.match(
      result.report.checks[4].detail,
      /^releases\/latest is v0\.5\.0; .* v0\.4\.0 is not the newest release\.$/,
    );
  });

  it('refuses a tag that is not vX.Y.Z, or a missing command, before calling anything', () => {
    for (const tag of ['main', 'v0.5', 'v0.5.0; id', '$(id)']) {
      const result = run('check', { tag });
      assert.equal(result.status, 1, tag);
      assert.match(result.stderr, /::error::The tag .* is not v<major>\.<minor>\.<patch>\./);
      assert.deepEqual(result.calls, []);
      assert.equal(result.output, '');
    }
    for (const [command, tag] of [
      ['check', null],
      ['publish', TAG],
    ]) {
      const result = run(command, { tag });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^Usage: node tooling\/check-published-release\.mjs check\|report vX\.Y\.Z$/m);
      assert.deepEqual(result.calls, []);
    }
  });

  /** The report job, given the check job's `result` and `report` (a value, or text as the job hands it over). */
  function reportRun({ result = 'success', report, issues = [issue()], rules = [], env = {} } = {}) {
    const checks = [
      { what: 'The release has its files', ok: true, detail: 'Downloaded.' },
      { what: 'Both zips match SHA256SUMS', ok: result === 'success', detail: 'xomoni-extension.zip: OK' },
    ];
    const text = typeof report === 'string' ? report : JSON.stringify(report ?? { tag: TAG, checks });
    return run('report', {
      rules: [...rules, { args: ISSUES, stdout: JSON.stringify(issues) }],
      env: { RESULT: result, REPORT: text, ...env },
    });
  }

  it('comments a passed check on the release issue, even closed', () => {
    const result = reportRun();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.gh.map((args) => args.slice(0, 3)),
      [ISSUES, ['issue', 'comment', '354']],
    );
    const body = flag(result.gh[1], '--body');
    assert.ok(body.startsWith('### The check after the release: passed\n'), body);
    assert.ok(body.includes('| ✓ | The release has its files | `Downloaded.` |'));
    assert.ok(body.includes('Run: https://github.com/pirdehi/xomoni/actions/runs/777'));
    assert.match(result.stdout, /The check passed: commented on #354/);
  });

  it('comments a failed check with what to do, and a check that didn’t finish as failed', () => {
    const failed = reportRun({ result: 'failure' });
    assert.equal(failed.status, 0, failed.stderr);
    const body = flag(failed.gh[1], '--body');
    assert.match(body, /: failed\n/);
    assert.ok(body.includes('| ✗ | Both zips match SHA256SUMS |'));
    assert.ok(body.includes('#when-the-check-after-the-release-fails'));
    for (const report of ['', '{', JSON.stringify({ tag: 'v0.4.0', checks: [{ what: 'A', ok: true, detail: '' }] })]) {
      const unfinished = reportRun({ result: 'failure', report });
      const text = flag(unfinished.gh[1], '--body');
      assert.match(text, /The check didn't finish \(its job ended as `failure`\)/, report);
    }
    // A job that "succeeded" without a report proves nothing either.
    const empty = reportRun({ result: 'success', report: '' });
    assert.match(flag(empty.gh[1], '--body'), /: failed\n/);
  });

  it('opens the release issue when the version has none: closed if the check passed, open if it failed', () => {
    const outsider = issue({ number: 390, author_association: 'NONE', user: { login: 'someone' } });
    for (const [result, closed] of [
      ['success', true],
      ['failure', false],
    ]) {
      const outcome = reportRun({ result, issues: [outsider, issue({ title: 'Release v0.4.0' })] });
      assert.equal(outcome.status, 0, outcome.stderr);
      const create = outcome.gh[1];
      assert.deepEqual(create.slice(0, 2), ['issue', 'create']);
      assert.equal(flag(create, '--title'), 'Release v0.5.0');
      assert.equal(flag(create, '--label'), 'release');
      assert.match(flag(create, '--body'), /^No issue titled "Release v0\.5\.0" was found/);
      assert.deepEqual(
        outcome.gh.slice(2),
        closed ? [['issue', 'close', 'https://github.com/pirdehi/xomoni/issues/401', '--reason', 'completed']] : [],
      );
      assert.ok(!outcome.gh.some((args) => args.includes('390')), 'the outsider’s issue is left alone');
    }
  });

  it('comments on the issue it opened before, rather than opening another, and closes it once the check passes', () => {
    const mine = issue({ number: 401, author_association: 'NONE', user: { login: ACTIONS_BOT } });
    const closed = reportRun({ issues: [mine] });
    assert.deepEqual(
      closed.gh.slice(1).map((args) => args.slice(0, 3)),
      [['issue', 'comment', '401']],
    );
    const open = { ...mine, state: 'open', state_reason: null };
    const failing = reportRun({ result: 'failure', issues: [open] });
    assert.deepEqual(
      failing.gh.slice(1).map((args) => args.slice(0, 3)),
      [['issue', 'comment', '401']],
    );
    const passing = reportRun({ issues: [open] });
    assert.deepEqual(passing.gh.slice(1), [passing.gh[1], ['issue', 'close', '401', '--reason', 'completed']]);
    assert.deepEqual(passing.gh[1].slice(0, 3), ['issue', 'comment', '401']);
    // A person's open release issue is the release workflow's to close.
    const person = reportRun({ issues: [issue({ state: 'open', state_reason: null })] });
    assert.deepEqual(
      person.gh.slice(1).map((args) => args.slice(0, 3)),
      [['issue', 'comment', '354']],
    );
  });

  it('refuses a result GitHub never gives, and fails when gh does, saying why', () => {
    const odd = reportRun({ env: { RESULT: 'passed' } });
    assert.equal(odd.status, 1);
    assert.match(odd.stderr, /::error::RESULT is "passed", not a job result GitHub gives\./);
    assert.deepEqual(odd.calls, []);
    const list = reportRun({ rules: [{ args: ISSUES, status: 1, stderr: 'HTTP 401: Bad credentials' }] });
    assert.equal(list.status, 1);
    assert.match(list.stderr, /::error::Couldn't read the release issues with gh: HTTP 401/);
    const comment = reportRun({ rules: [{ args: ['issue', 'comment'], status: 1, stderr: 'HTTP 502' }] });
    assert.equal(comment.status, 1);
    assert.match(comment.stderr, /::error::Couldn't report on the release issue with gh: HTTP 502/);
  });

  it('gives gh the token and repository through its environment only, and never prints the token', () => {
    for (const result of [run('check'), reportRun()]) {
      for (const call of result.calls.filter((c) => c.name === 'gh')) {
        assert.equal(call.token, TOKEN);
        assert.equal(call.repo, 'pirdehi/xomoni');
        assert.ok(!call.args.some((arg) => arg.includes(TOKEN)), 'never on the command line');
      }
      assert.ok(!`${result.stdout}${result.stderr}${result.output}`.includes(TOKEN), 'never printed');
    }
  });
});

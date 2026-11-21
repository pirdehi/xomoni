// Tests for the release's readiness check (#340, ADR-0037): the parser in tooling/release-issue-lib.mjs, against
// issues shaped like .github/ISSUE_TEMPLATE/release.md, and tooling/check-release-issue.mjs, against a fake `gh`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  beforeTheTagBoxes,
  matchingReleaseIssues,
  releaseIssueReadiness,
  releaseIssueTitle,
  tagProblem,
} from './release-issue-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = 'v0.5.0';

/** The body of an issue opened from the Release template: the template without its front matter. */
const TEMPLATE = readFileSync(join(ROOT, '.github/ISSUE_TEMPLATE/release.md'), 'utf8').replace(
  /^---\n[\s\S]*?\n---\n+/,
  '',
);
/** The template's boxes, as a person reads them. */
const TEMPLATE_BOXES = [...TEMPLATE.matchAll(/^- \[ \] (.*)$/gm)].map((match) => match[1]);
/** The template with every box ticked. */
const TICKED = TEMPLATE.replace(/^- \[ \]/gm, '- [x]');

/** An issue as GitHub's REST API lists it, by default the maintainer's complete release issue for v0.5.0. */
function issue(fields = {}) {
  const number = fields.number ?? 12;
  return {
    number,
    title: releaseIssueTitle(TAG),
    state: 'open',
    labels: [{ name: 'release' }, { name: 'quality-gate' }],
    author_association: 'OWNER',
    body: TICKED,
    html_url: `https://github.com/pirdehi/xomoni/issues/${number}`,
    ...fields,
  };
}

describe('the Release template (#340)', () => {
  it('has the section the check reads, with every box unticked, and none elsewhere', () => {
    assert.ok(TEMPLATE_BOXES.length >= 10, `${TEMPLATE_BOXES.length} boxes`);
    assert.match(TEMPLATE, /^## Before the tag$/m);
    const boxes = beforeTheTagBoxes(TEMPLATE);
    assert.deepEqual(
      boxes.map((box) => box.text),
      TEMPLATE_BOXES,
    );
    assert.ok(boxes.every((box) => !box.ticked));
    assert.ok(TEMPLATE_BOXES.includes('Go: the maintainer approves this release'));
  });

  it('is titled and labelled as the check looks for it', () => {
    const front = readFileSync(join(ROOT, '.github/ISSUE_TEMPLATE/release.md'), 'utf8');
    assert.match(front, /^title: 'Release vX\.Y\.Z'$/m);
    assert.match(front, /^labels: release$/m);
  });
});

describe('releaseIssueReadiness (#340)', () => {
  it('is ready when every box under "Before the tag" is ticked, with x or X', () => {
    for (const body of [TICKED, TEMPLATE.replace(/^- \[ \]/gm, '- [X]')]) {
      const result = releaseIssueReadiness([issue({ body })], TAG);
      assert.deepEqual(result.problems, []);
      assert.deepEqual(result.issue, { number: 12, url: 'https://github.com/pirdehi/xomoni/issues/12' });
      assert.deepEqual(result.unticked, []);
      assert.equal(result.ticked, TEMPLATE_BOXES.length);
    }
  });

  it('lists every unticked box of an issue just opened from the template, and still names the issue', () => {
    const result = releaseIssueReadiness([issue({ body: TEMPLATE })], TAG);
    assert.deepEqual(result.unticked, TEMPLATE_BOXES);
    assert.equal(result.problems.length, TEMPLATE_BOXES.length);
    assert.equal(result.ticked, 0);
    assert.equal(result.issue.number, 12);
    for (const [i, text] of TEMPLATE_BOXES.entries())
      assert.equal(result.problems[i], `#12: unticked under "Before the tag": ${text}`);
  });

  it('fails on one unticked box among ticked ones, naming it', () => {
    const body = TICKED.replace('- [x] Go: the maintainer approves', '- [ ] Go: the maintainer approves');
    const result = releaseIssueReadiness([issue({ body })], TAG);
    assert.deepEqual(result.unticked, ['Go: the maintainer approves this release']);
    assert.deepEqual(result.problems, [
      '#12: unticked under "Before the tag": Go: the maintainer approves this release',
    ]);
    assert.equal(result.ticked, TEMPLATE_BOXES.length - 1);
  });

  it('ignores boxes in other sections, ticked or not', () => {
    const body = TICKED.replace('## Rollback', '## Rollback\n\n- [ ] Not a release step\n').concat(
      '\n## Notes\n\n- [ ] Also not one\n* [ ] Nor this\n',
    );
    assert.deepEqual(releaseIssueReadiness([issue({ body })], TAG).problems, []);
    // A ticked box elsewhere doesn't make up for an unticked one in the section.
    const unticked = TEMPLATE.replace('## Rollback', '## Rollback\n\n- [x] Rolled back\n');
    assert.equal(releaseIssueReadiness([issue({ body: unticked })], TAG).unticked.length, TEMPLATE_BOXES.length);
    // A box above the section doesn't count either.
    const above = `- [ ] Before the section\n\n${TICKED}`;
    assert.deepEqual(releaseIssueReadiness([issue({ body: above })], TAG).problems, []);
  });

  it('keeps subheadings inside the section, and ends it at the next heading of level 1 or 2', () => {
    const body = '## Before the tag\n\n### More\n\n- [ ] Under a subheading\n\n# Other\n\n- [ ] Elsewhere\n';
    assert.deepEqual(releaseIssueReadiness([issue({ body })], TAG).unticked, ['Under a subheading']);
    const empty = '## Before the tag\n###\n- [ ] Under an empty subheading\n';
    assert.deepEqual(releaseIssueReadiness([issue({ body: empty })], TAG).unticked, ['Under an empty subheading']);
  });

  it('reads every kind of task list item GitHub renders, at any depth', () => {
    const body = [
      '## Before the tag',
      '- [x] dash',
      '* [x] star',
      '+ [x] plus',
      '1. [x] numbered',
      '2) [x] numbered with a parenthesis',
      '  - [ ] nested',
      '- [ ]',
      '-  [X]  wide',
      '',
    ].join('\n');
    const result = releaseIssueReadiness([issue({ body })], TAG);
    assert.deepEqual(result.unticked, ['nested', '(a box with no text)']);
    assert.equal(result.ticked, 6);
  });

  it('does not count what GitHub shows as no box: HTML comments, code blocks, other brackets', () => {
    const body = [
      '## Before the tag',
      '- [x] The real one',
      '<!-- - [ ] In a comment -->',
      '<!--',
      '- [ ] In a comment over lines',
      '-->',
      '```',
      '- [ ] In a code block',
      '```',
      '~~~md',
      '- [ ] In another code block',
      '~~~',
      '- [  ] Two spaces',
      '- [-] A dash',
      '[ ] Not in a list',
      '',
    ].join('\n');
    const result = releaseIssueReadiness([issue({ body })], TAG);
    assert.deepEqual(result.problems, []);
    assert.equal(result.ticked, 1);
  });

  it('runs an unclosed comment or code block to the end, as GitHub renders it', () => {
    for (const rest of ['<!-- - [ ] b', '```\n- [ ] b']) {
      const body = `## Before the tag\n- [x] a\n${rest}\n`;
      assert.deepEqual(releaseIssueReadiness([issue({ body })], TAG).problems, [], rest);
    }
    const hidden = releaseIssueReadiness([issue({ body: '<!--\n## Before the tag\n- [x] a\n' })], TAG);
    assert.match(hidden.problems[0], /^#12 has no "## Before the tag" section\./);
  });

  it('reads an issue saved with Windows line endings', () => {
    const body = TEMPLATE.replace(/\n/g, '\r\n');
    assert.deepEqual(releaseIssueReadiness([issue({ body })], TAG).unticked, TEMPLATE_BOXES);
    assert.deepEqual(releaseIssueReadiness([issue({ body: TICKED.replace(/\n/g, '\r\n') })], TAG).problems, []);
  });

  it('fails without the section, or with a section that holds no box', () => {
    for (const body of [
      TICKED.replace('## Before the tag', '## Before tagging'),
      '',
      null,
      '### Before the tag\n- [x] a',
    ]) {
      const result = releaseIssueReadiness([issue({ body })], TAG);
      assert.deepEqual(result.problems, ['#12 has no "## Before the tag" section. Open it from the Release template.']);
      assert.equal(result.issue.number, 12);
    }
    const empty = '## Before the tag\n\nNothing here.\n\n## Rollback\n\n- [x] Elsewhere\n';
    assert.deepEqual(releaseIssueReadiness([issue({ body: empty })], TAG).problems, [
      '#12 has no checkbox under "## Before the tag". Open it from the Release template.',
    ]);
  });

  it('fails when no open release issue is titled exactly "Release vX.Y.Z"', () => {
    const others = [
      issue({ title: 'Release v0.5.0 ' }),
      issue({ title: 'release v0.5.0' }),
      issue({ title: 'Release 0.5.0' }),
      issue({ title: 'Release v0.5.1' }),
      issue({ title: 'Release v0.5.0-rc.1' }),
      issue({ state: 'closed' }),
      issue({ labels: [{ name: 'quality-gate' }] }),
      issue({ labels: [] }),
      issue({ pull_request: { url: 'https://api.github.com/repos/pirdehi/xomoni/pulls/12' } }),
      issue({ number: '12' }),
    ];
    for (const issues of [[], others]) {
      const result = releaseIssueReadiness(issues, TAG);
      assert.deepEqual(result.problems, [
        'No open issue labelled "release" is titled "Release v0.5.0". Open it from the Release template and tick its boxes (docs/RELEASING.md, step 0).',
      ]);
      assert.equal(result.issue, null);
    }
  });

  it('fails when more than one is, naming them all', () => {
    const result = releaseIssueReadiness([issue({ number: 12 }), issue({ number: 15 })], TAG);
    assert.deepEqual(result.problems, [
      '2 open issues are titled "Release v0.5.0" (#12, #15). Keep one and close the others.',
    ]);
    assert.equal(result.issue, null);
  });

  it('counts only an issue opened by someone who can push, since anyone can open one from the template', () => {
    for (const association of [
      'NONE',
      'CONTRIBUTOR',
      'FIRST_TIMER',
      'FIRST_TIME_CONTRIBUTOR',
      'MANNEQUIN',
      undefined,
    ]) {
      const result = releaseIssueReadiness([issue({ number: 20, author_association: association })], TAG);
      assert.equal(result.issue, null, String(association));
      assert.match(result.problems[0], /^No open issue labelled "release" is titled "Release v0\.5\.0"\./);
      assert.match(result.problems[0], /#20 doesn't count: opened by someone who can't push to the repository\.$/);
    }
    // Someone else's copy neither replaces the maintainer's nor makes it a duplicate.
    const outsider = issue({ number: 20, author_association: 'NONE', body: TICKED });
    const mine = issue({ number: 12, body: TEMPLATE });
    const result = releaseIssueReadiness([outsider, mine], TAG);
    assert.equal(result.issue.number, 12);
    assert.equal(result.unticked.length, TEMPLATE_BOXES.length);
    for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR'])
      assert.deepEqual(releaseIssueReadiness([issue({ author_association: association })], TAG).problems, []);
  });

  it('refuses a tag that is not vX.Y.Z before looking at any issue', () => {
    for (const tag of ['0.5.0', 'v0.5', 'v0.5.0-rc.1', 'v0.5.0\nx', '', undefined]) {
      const result = releaseIssueReadiness([issue({ title: `Release ${String(tag)}` })], tag);
      assert.equal(result.problems.length, 1);
      assert.match(result.problems[0], /is not v<major>\.<minor>\.<patch>\.$/);
      assert.equal(result.issue, null);
    }
  });

  it('names the problem with a tag, or none', () => {
    assert.equal(tagProblem('v1.2.3'), null);
    assert.equal(tagProblem('v1.2'), 'The tag v1.2 is not v<major>.<minor>.<patch>.');
  });

  it('splits candidates into trusted and untrusted ones', () => {
    const { trusted, untrusted } = matchingReleaseIssues(
      [issue({ number: 1 }), issue({ number: 2, author_association: 'NONE' }), issue({ number: 3, title: 'x' })],
      TAG,
    );
    assert.deepEqual(
      trusted.map((i) => i.number),
      [1],
    );
    assert.deepEqual(
      untrusted.map((i) => i.number),
      [2],
    );
  });
});

describe('check-release-issue.mjs (#340)', () => {
  const SCRIPT = join(ROOT, 'tooling/check-release-issue.mjs');
  const TOKEN = 'ghs_a-token-that-must-never-show';

  /**
   * Runs the check for `tag` with a fake `gh` that logs its arguments and whether it got the token, then answers
   * `answer` (or fails with `ghError`). Returns the exit status, the output, $GITHUB_OUTPUT and the gh log.
   */
  function check({ tag = TAG, answer = [issue()], ghError } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'xomoni-readiness-'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'answer.json'), JSON.stringify(answer));
    writeFileSync(join(dir, 'output'), '');
    writeFileSync(
      join(dir, 'bin/gh'),
      [
        '#!/bin/bash',
        `printf '%s\\n' "$@" > "${join(dir, 'args')}"`,
        `[ "$GH_TOKEN" = "${TOKEN}" ] && [ "$GH_REPO" = pirdehi/xomoni ] && echo env > "${join(dir, 'env')}"`,
        ghError ? `echo "${ghError}" >&2; exit 1` : `cat "${join(dir, 'answer.json')}"`,
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const env = {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      GH_TOKEN: TOKEN,
      GH_REPO: 'pirdehi/xomoni',
      GITHUB_OUTPUT: join(dir, 'output'),
    };
    const result = spawnSync(process.execPath, tag == null ? [SCRIPT] : [SCRIPT, tag], {
      cwd: dir,
      env,
      encoding: 'utf8',
    });
    const read = (name) => {
      try {
        return readFileSync(join(dir, name), 'utf8');
      } catch {
        return null;
      }
    };
    const run = {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: read('output'),
      args: read('args')?.trimEnd().split('\n') ?? null,
      sawToken: read('env') != null,
    };
    rmSync(dir, { recursive: true, force: true });
    return run;
  }

  it("asks GitHub for open release issues, with the token and repository from gh's environment only", () => {
    const run = check();
    assert.deepEqual(run.args, ['api', 'repos/{owner}/{repo}/issues?labels=release&state=open&per_page=100']);
    assert.ok(run.sawToken, 'gh got GH_TOKEN and GH_REPO');
    assert.ok(!run.args.some((arg) => arg.includes(TOKEN)), 'never on the command line');
    assert.ok(!`${run.stdout}${run.stderr}`.includes(TOKEN), 'never printed');
  });

  it('passes a complete issue and writes its number for the publish job', () => {
    const run = check();
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.output, 'issue=12\n');
    assert.equal(
      run.stdout.trim(),
      `Release issue #12 is complete: ${TEMPLATE_BOXES.length} boxes ticked under "Before the tag". https://github.com/pirdehi/xomoni/issues/12`,
    );
  });

  it('fails while a box is unticked, printing each one, and still names the issue', () => {
    const body = TICKED.replace('- [x] The rollback below is written', '- [ ] The rollback below is written').replace(
      '- [x] Go: the maintainer approves',
      '- [ ] Go: the maintainer approves',
    );
    const run = check({ answer: [issue({ body })] });
    assert.equal(run.status, 1);
    assert.equal(run.output, 'issue=12\n');
    assert.match(run.stderr, /^::error::#12: unticked under "Before the tag": The rollback below is written$/m);
    assert.match(
      run.stderr,
      /^::error::#12: unticked under "Before the tag": Go: the maintainer approves this release$/m,
    );
    assert.match(run.stderr, /Not ready to release v0\.5\.0: https:\/\/github\.com\/pirdehi\/xomoni\/issues\/12/);
    assert.match(
      run.stderr,
      /Unticked under "Before the tag" \(2\):\n {2}- \[ \] The rollback below is written\n {2}- \[ \] Go: the maintainer approves this release\n/,
    );
    assert.equal(run.stdout, '');
  });

  it('fails without an issue, and writes no number', () => {
    for (const answer of [[], [issue({ title: 'Release v0.4.0' })], [issue({ author_association: 'NONE' })]]) {
      const run = check({ answer });
      assert.equal(run.status, 1);
      assert.equal(run.output, '');
      assert.match(run.stderr, /^::error::No open issue labelled "release" is titled "Release v0\.5\.0"\./m);
    }
  });

  it('fails with two issues, naming both, and writes no number', () => {
    const run = check({ answer: [issue({ number: 12 }), issue({ number: 13 })] });
    assert.equal(run.status, 1);
    assert.equal(run.output, '');
    assert.match(run.stderr, /^::error::2 open issues are titled "Release v0\.5\.0" \(#12, #13\)/m);
  });

  it('fails when gh does, saying why, and when GitHub answers something else than a list', () => {
    const failed = check({ ghError: 'HTTP 401: Bad credentials (https://api.github.com/repos/pirdehi/xomoni/issues)' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /^::error::Couldn't read the release issues with gh: HTTP 401: Bad credentials/m);
    assert.equal(failed.output, '');
    const odd = check({ answer: { message: 'Not Found' } });
    assert.equal(odd.status, 1);
    assert.match(odd.stderr, /^::error::Couldn't read the release issues with gh: GitHub did not answer with a list/m);
  });

  it('refuses to run without a tag, or with a tag that is not vX.Y.Z', () => {
    const none = check({ tag: null });
    assert.equal(none.status, 1);
    assert.match(none.stderr, /^Usage: node tooling\/check-release-issue\.mjs vX\.Y\.Z$/m);
    assert.equal(none.args, null, 'gh never ran');
    const bad = check({ tag: 'main' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /^::error::The tag main is not v<major>\.<minor>\.<patch>\.$/m);
    assert.equal(bad.output, '');
    assert.equal(bad.args, null, 'gh never ran');
  });
});

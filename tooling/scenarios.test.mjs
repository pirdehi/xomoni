// Tests for tooling/scenarios-lib.mjs (#338, ADR-0038), run by `node --test 'tooling/*.test.mjs'` in `npm run verify`.
// Each case writes a small repository into a temporary folder: a scenarios file, the Playwright spec it names, and
// sometimes the feature registry. The repository's own files are checked by `npm run scenarios:check`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  CATEGORY_MINIMUMS,
  MAX_MANUAL,
  MIN_SCENARIOS,
  checkScenarios,
  parseScenarioFile,
  stepProblems,
  taskTag,
  testsInSpec,
} from './scenarios-lib.mjs';

const SPEC = 'apps/web/e2e/task.spec.ts';
const FILE = 'docs/scenarios/7-a-task.md';
const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** A repository in a temporary folder with these files (path → text); returns its root. */
function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'xomoni-scenarios-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Exactly each category's minimum, in order: 20 categories for 20 scenarios. */
const CATEGORIES = Object.entries(CATEGORY_MINIMUMS).flatMap(([category, minimum]) => Array(minimum).fill(category));

/** `S<task>-NN` for the n-th scenario, from 1. */
const idOf = (task, n) => `S${task}-${String(n).padStart(2, '0')}`;

/** One scenario's Markdown; `lines` replaces its Given / When / Then, `ending` its `Test:` line. */
function scenario(id, category, { lines, ending = `Test: ${SPEC}` } = {}) {
  const steps = lines ?? ['Given a visitor on the page', 'When they press the button', 'Then the page answers'];
  return [
    `## ${id} · ${category}`,
    '',
    ...steps.map((line) => `- ${line}`),
    ...(ending ? [`- ${ending}`] : []),
    '',
  ].join('\n');
}

/** A scenarios file for `task`, with the front matter given (task and title by default) and these scenarios. */
function scenariosFile(task, scenarios, front = [`task: ${task}`, 'title: A task']) {
  return ['---', ...front, '---', '', '# A task', '', 'What it covers.', '', ...scenarios].join('\n');
}

/** The minimal valid set: one scenario per category slot, each with a test. `change(i, category)` alters one. */
function minimalScenarios(task = 7, change = () => undefined) {
  return CATEGORIES.map((category, i) => change(i, category) ?? scenario(idOf(task, i + 1), category));
}

/** A spec with a test for each id, tagged for `task`, unless `test(id)` gives that test's own source. */
function spec(ids, task = 7, test = () => undefined) {
  const body = ids.map(
    (id) => test(id) ?? `  test('${id} does what it says', { tag: ['${taskTag(task)}'] }, async ({ page }) => {});`,
  );
  return [`import { test } from './support/test';`, '', `test.describe('a task', () => {`, ...body, '});', ''].join(
    '\n',
  );
}

const ALL_IDS = CATEGORIES.map((_, i) => idOf(7, i + 1));

/** The problems the checker finds in a repository holding `file` as the task's scenarios and `specText` as its spec. */
function problemsOf(file, specText = spec(ALL_IDS), extra = {}) {
  return checkScenarios(repo({ [FILE]: file, [SPEC]: specText, ...extra })).problems;
}

/** Asserts that one of `problems` matches `pattern`. */
function has(problems, pattern) {
  assert.ok(
    problems.some((problem) => pattern.test(problem)),
    `no problem matches ${pattern}:\n${problems.join('\n')}`,
  );
}

describe('a scenarios file that meets the standard (#338)', () => {
  it('passes with 20 scenarios, each category at its minimum, each proven by its tagged test', () => {
    assert.equal(CATEGORIES.length, MIN_SCENARIOS);
    const result = checkScenarios(repo({ [FILE]: scenariosFile(7, minimalScenarios()), [SPEC]: spec(ALL_IDS) }));
    assert.deepEqual(result, { files: 1, scenarios: 20, manual: 0, problems: [] });
  });

  it('accepts plain step lines, And, backticks around the path, a feature id and up to 3 manual scenarios', () => {
    const scenarios = minimalScenarios(7, (i, category) => {
      if (i === 0)
        return [
          `## ${idOf(7, 1)} · ${category}`,
          'Given a visitor',
          'And a second fact',
          'When they press it',
          'Then it works',
          '  and the line goes on here',
          'And something else',
          `Test: \`${SPEC}\``,
          '',
        ].join('\n');
      if (i >= 17)
        return scenario(idOf(7, i + 1), category, { ending: 'Manual: a real browser store can’t be scripted' });
      return undefined;
    });
    const file = scenariosFile(7, scenarios, ['task: 7', 'title: A task: with a colon', 'feature: a-feature']);
    const result = checkScenarios(repo({ [FILE]: file, [SPEC]: spec(ALL_IDS.slice(0, 17)) }));
    assert.deepEqual(result, { files: 1, scenarios: 20, manual: MAX_MANUAL, problems: [] });
  });

  it('ignores the README and a repository without scenarios', () => {
    assert.deepEqual(checkScenarios(repo({ 'docs/scenarios/README.md': '# Not a scenarios file' })), {
      files: 0,
      scenarios: 0,
      manual: 0,
      problems: [],
    });
    assert.deepEqual(checkScenarios(repo({ 'README.md': '# Nothing here' })).problems, []);
  });
});

describe('counts and categories', () => {
  it('fails under 20 scenarios', () => {
    const problems = problemsOf(scenariosFile(7, minimalScenarios().slice(0, 19)), spec(ALL_IDS.slice(0, 19)));
    has(problems, /7-a-task\.md:1: has 19 scenarios; at least 20 are needed/);
  });

  it('fails when a category is under its minimum, even with 20 or more in all', () => {
    const problems = problemsOf(
      scenariosFile(
        7,
        minimalScenarios(7, (i) => (i === 0 ? scenario(idOf(7, 1), 'browser') : undefined)),
      ),
    );
    has(problems, /has 2 happy scenarios; at least 3 are needed/);
    assert.equal(problems.length, 1, problems.join('\n'));
  });

  it('names every category short of its minimum', () => {
    const problems = problemsOf(
      scenariosFile(
        7,
        minimalScenarios(7, (i) => scenario(idOf(7, i + 1), 'happy')),
      ),
    );
    for (const category of Object.keys(CATEGORY_MINIMUMS).filter((c) => c !== 'happy'))
      has(problems, new RegExp(`has 0 ${category} scenarios`));
  });

  it('fails on an unknown category', () => {
    const scenarios = [...minimalScenarios(), scenario(idOf(7, 21), 'sad')];
    has(problemsOf(scenariosFile(7, scenarios), spec([...ALL_IDS, idOf(7, 21)])), /S7-21: unknown category "sad"/);
  });

  it('fails on more than 3 manual scenarios', () => {
    const scenarios = minimalScenarios(7, (i, category) =>
      i < 4 ? scenario(idOf(7, i + 1), category, { ending: 'Manual: needs a real store' }) : undefined,
    );
    has(problemsOf(scenariosFile(7, scenarios), spec(ALL_IDS.slice(4))), /has 4 manual scenarios; at most 3 may be/);
  });

  it('fails on a manual scenario without its reason', () => {
    const scenarios = minimalScenarios(7, (i, category) =>
      i === 0 ? scenario(idOf(7, 1), category, { ending: 'Manual:' }) : undefined,
    );
    has(problemsOf(scenariosFile(7, scenarios), spec(ALL_IDS.slice(1))), /S7-01: Manual: needs the reason/);
  });
});

describe('ids', () => {
  it('fails on a duplicate id', () => {
    const scenarios = minimalScenarios(7, (i, category) => (i === 1 ? scenario(idOf(7, 1), category) : undefined));
    has(problemsOf(scenariosFile(7, scenarios)), /S7-01: is used twice \(also on line \d+\)/);
  });

  it('fails on an id whose number is not the file’s task', () => {
    const scenarios = minimalScenarios(7, (i, category) => (i === 0 ? scenario('S8-01', category) : undefined));
    has(problemsOf(scenariosFile(7, scenarios)), /S8-01: its number is not this file's task \(S7-NN\)/);
  });

  it('fails on a heading that isn’t a scenario’s', () => {
    for (const heading of ['## S7-1 · happy', '## S7-01 - happy', '## Notes', '## s7-01 · happy']) {
      const problems = problemsOf(scenariosFile(7, [...minimalScenarios(), heading, '- Given x', '']));
      has(problems, /is not a scenario heading: ## S<issue>-NN · <category>/);
    }
  });
});

describe('steps', () => {
  it('fails without Given, When and Then, or out of order', () => {
    const cases = {
      'needs Given, When and Then': ['Given a visitor', 'When they press'],
      'has Then before When': ['Given a visitor', 'Then it works'],
      'has When before Given': ['When they press', 'Given a visitor', 'Then it works'],
      'has Given after Then': ['Given a visitor', 'When they press', 'Then it works', 'Given more'],
      'starts with And': ['And a visitor', 'When they press', 'Then it works'],
    };
    for (const [message, lines] of Object.entries(cases)) {
      const scenarios = minimalScenarios(7, (i, category) =>
        i === 0 ? scenario(idOf(7, 1), category, { lines }) : undefined,
      );
      has(problemsOf(scenariosFile(7, scenarios)), new RegExp(`S7-01: ${message}`));
    }
    const missing = minimalScenarios(7, (i, category) =>
      i === 0 ? scenario(idOf(7, 1), category, { lines: [] }) : undefined,
    );
    has(problemsOf(scenariosFile(7, missing)), /S7-01: needs Given, When and Then lines, in that order/);
  });

  it('fails on a line that is none of the scenario’s parts', () => {
    const scenarios = minimalScenarios(7, (i, category) =>
      i === 0
        ? scenario(idOf(7, 1), category, { lines: ['Given a visitor', 'Suddenly a note', 'When x', 'Then y'] })
        : undefined,
    );
    has(
      problemsOf(scenariosFile(7, scenarios)),
      /S7-01: "Suddenly a note" is not a Given, When, Then, And, Test: or Manual: line/,
    );
  });

  it('says what is wrong, in order', () => {
    assert.equal(stepProblems(['Given', 'And', 'When', 'Then', 'And']), null);
    assert.equal(stepProblems(['Given', 'Given', 'When', 'When', 'Then', 'Then']), null);
    assert.match(stepProblems(['Given', 'Then']), /has Then before When/);
    assert.match(stepProblems(['Given', 'When']), /needs Given, When and Then/);
  });

  it('fails on a scenario with no ending, or two', () => {
    const none = minimalScenarios(7, (i, category) =>
      i === 0 ? scenario(idOf(7, 1), category, { ending: null }) : undefined,
    );
    has(problemsOf(scenariosFile(7, none)), /S7-01: ends with no Test: <spec path> or Manual: <reason>/);
    const two = minimalScenarios(7, (i, category) =>
      i === 0 ? `${scenario(idOf(7, 1), category)}- Manual: and by hand\n` : undefined,
    );
    has(problemsOf(scenariosFile(7, two)), /S7-01: has more than one Test: or Manual: line/);
  });
});

describe('the test that proves each scenario', () => {
  /** The problems with S7-01's test replaced by `source`. */
  const withTest = (source, extra) =>
    problemsOf(
      scenariosFile(7, minimalScenarios()),
      spec(ALL_IDS, 7, (id) => (id === 'S7-01' ? source : undefined)),
      extra,
    );

  it('fails when the Test: path doesn’t exist, isn’t a spec, or leaves the repository', () => {
    for (const path of ['apps/web/e2e/gone.spec.ts', 'apps/web/e2e/task.ts', '../outside.spec.ts', '/etc/x.spec.ts']) {
      const scenarios = minimalScenarios(7, (i, category) =>
        i === 0 ? scenario(idOf(7, 1), category, { ending: `Test: ${path}` }) : undefined,
      );
      has(problemsOf(scenariosFile(7, scenarios), spec(ALL_IDS.slice(1))), /S7-01: Test: .* is not a Playwright spec/);
    }
    const empty = minimalScenarios(7, (i, category) =>
      i === 0 ? scenario(idOf(7, 1), category, { ending: 'Test:' }) : undefined,
    );
    has(problemsOf(scenariosFile(7, empty), spec(ALL_IDS.slice(1))), /S7-01: Test: needs the path/);
  });

  it('fails when no test’s title starts with the id', () => {
    for (const title of ['S7-010 a longer id', 'the S7-01 scenario', 'S7-01x close']) {
      const problems = withTest(`  test('${title}', { tag: ['@task-7'] }, async () => {});`);
      has(problems, /S7-01: apps\/web\/e2e\/task\.spec\.ts has no test whose title starts with S7-01/);
    }
  });

  it('fails when two tests claim the id', () => {
    const twice = `  test('S7-01 one', { tag: '@task-7' }, async () => {});\n  test('S7-01 two', { tag: '@task-7' }, async () => {});`;
    has(withTest(twice), /S7-01: .* has 2 tests whose titles start with S7-01/);
  });

  it('fails when the test is skipped, left to fix, run alone or expected to fail', () => {
    for (const modifier of ['skip', 'fixme', 'only', 'fail']) {
      has(
        withTest(`  test.${modifier}('S7-01 x', { tag: ['@task-7'] }, async () => {});`),
        new RegExp(`marked ${modifier}`),
      );
      // A group around it.
      has(
        withTest(
          `  test.describe.${modifier}('a group', () => { test('S7-01 x', { tag: ['@task-7'] }, async () => {}); });`,
        ),
        new RegExp(`marked ${modifier}`),
      );
    }
    // Skipped from inside the test, or from inside its group, on a condition.
    has(
      withTest(`  test('S7-01 x', { tag: ['@task-7'] }, async () => { test.skip(true, 'not today'); });`),
      /marked skip/,
    );
    has(
      withTest(`  test.describe('g', () => { test.fixme(); test('S7-01 x', { tag: ['@task-7'] }, async () => {}); });`),
      /marked fixme/,
    );
  });

  it('fails when the whole spec is skipped', () => {
    const skipped = spec(ALL_IDS).replace("test.describe('a task'", "test.skip(); test.describe('a task'");
    has(problemsOf(scenariosFile(7, minimalScenarios()), skipped), /S7-01: its test .* is marked skip/);
  });

  it('fails when the test doesn’t carry the task’s tag', () => {
    has(
      withTest(`  test('S7-01 x', async () => {});`),
      /S7-01: its test \(apps\/web\/e2e\/task\.spec\.ts:\d+\) doesn't carry the tag @task-7/,
    );
    has(withTest(`  test('S7-01 x', { tag: ['@task-8'] }, async () => {});`), /doesn't carry the tag @task-7/);
  });

  it('takes the tag from the title, a single string, or a group around the test', () => {
    assert.deepEqual(withTest(`  test('S7-01 x @task-7', async () => {});`), []);
    assert.deepEqual(withTest(`  test('S7-01 x', { tag: '@task-7' }, async () => {});`), []);
    assert.deepEqual(
      withTest(`  test.describe('g', { tag: '@task-7' }, () => { test('S7-01 x', async () => {}); });`),
      [],
    );
  });
});

describe('tests that claim a scenario', () => {
  it('fail when no scenarios file has their id', () => {
    const extra = { 'apps/web/e2e/other.spec.ts': spec(['S7-30', 'S9-01'], 7) };
    const problems = problemsOf(scenariosFile(7, minimalScenarios()), spec(ALL_IDS), extra);
    has(problems, /other\.spec\.ts:\d+: test "S7-30 does what it says" names S7-30, which no scenarios file has/);
    has(problems, /other\.spec\.ts:\d+: test "S9-01 does what it says" names S9-01, which no scenarios file has/);
  });

  it('fail when their scenario names another spec, or is manual', () => {
    const scenarios = minimalScenarios(7, (i, category) =>
      i === 0 ? scenario(idOf(7, 1), category, { ending: 'Manual: by hand' }) : undefined,
    );
    const extra = { 'apps/web/e2e/other.spec.ts': spec(['S7-01', 'S7-02'], 7) };
    const problems = problemsOf(scenariosFile(7, scenarios), spec(ALL_IDS.slice(1)), extra);
    has(problems, /other\.spec\.ts:\d+: test "S7-01 does what it says" names S7-01, whose scenario is manual/);
    has(
      problems,
      /other\.spec\.ts:\d+: test "S7-02 does what it says" names S7-02, whose scenario names apps\/web\/e2e\/task\.spec\.ts/,
    );
  });

  it('fail when they carry a task’s tag without an id of that task', () => {
    const extra = {
      'apps/web/e2e/other.spec.ts': spec(
        ['x'],
        7,
        () => `  test('no id', { tag: ['@task-7', '@slow'] }, async () => {});`,
      ),
    };
    has(
      problemsOf(scenariosFile(7, minimalScenarios()), spec(ALL_IDS), extra),
      /test "no id" carries @task-7 but its title doesn't start with an S7-NN id/,
    );
  });
});

describe('front matter and the file’s name', () => {
  /** The problems of a file with the minimal scenarios under this front matter (null: none at all). */
  const front = (lines, name = FILE) =>
    checkScenarios(
      repo({
        [name]: lines === null ? minimalScenarios().join('\n') : scenariosFile(7, minimalScenarios(), lines),
        [SPEC]: spec(ALL_IDS),
      }),
    ).problems;

  it('fails without it, unclosed, or with a line that isn’t key: value', () => {
    has(front(null), /:1: must start with front matter/);
    has(checkScenarios(repo({ [FILE]: '---\ntask: 7\ntitle: x\n' })).problems, /front matter is not closed/);
    has(front(['task: 7', 'title: A task', 'just words']), /:4: front matter line "just words" is not "key: value"/);
  });

  it('fails on an unknown or repeated key', () => {
    has(front(['task: 7', 'title: A task', 'owner: me']), /unknown front matter key "owner"/);
    has(front(['task: 7', 'title: A task', 'title: Again']), /front matter key "title" is set twice/);
  });

  it('fails without a task that is an issue number, or a title', () => {
    has(front(['title: A task']), /front matter has no task/);
    has(front(['task: #7', 'title: A task']), /front matter task "#7" is not an issue number/);
    has(front(['task: 7']), /front matter has no title/);
    has(front(['task: 7', 'title:']), /front matter has no title/);
  });

  it('fails when the task isn’t the issue in the file’s name, or the name isn’t <issue>-<slug>.md', () => {
    has(front(['task: 8', 'title: A task']), /front matter task 8 is not the issue in the file's name \(7\)/);
    for (const name of ['docs/scenarios/a-task.md', 'docs/scenarios/7_A_Task.md', 'docs/scenarios/7.md'])
      has(front(['task: 7', 'title: A task'], name), /the name must be <issue>-<slug>\.md/);
  });

  it('checks the feature only against a registry that exists', () => {
    const lines = ['task: 7', 'title: A task', 'feature: install-guide'];
    assert.deepEqual(front(lines), []);
    const file = scenariosFile(7, minimalScenarios(), lines);
    const registry = (ids) => JSON.stringify({ features: ids.map((id) => ({ id })) });
    assert.deepEqual(problemsOf(file, spec(ALL_IDS), { 'docs/features.json': registry(['install-guide']) }), []);
    has(
      problemsOf(file, spec(ALL_IDS), { 'docs/features.json': registry(['store-install']) }),
      /feature "install-guide" is not an id in docs\/features\.json/,
    );
    has(problemsOf(file, spec(ALL_IDS), { 'docs/features.json': '{ not json' }), /docs\/features\.json: can't be read/);
    has(
      front(['task: 7', 'title: A task', 'feature: Install Guide']),
      /feature "Install Guide" is not a kebab-case id/,
    );
  });
});

describe('reading a spec', () => {
  it('finds each test with its line, its tags and its groups’ tags, and what disables it', () => {
    const source = [
      "import { test } from './support/test';",
      "test.describe('outer', { tag: '@area' }, () => {",
      '  test.use({ viewport: { width: 390, height: 844 } });',
      "  test('S7-01 first @inline', { tag: ['@task-7', '@slow'] }, async ({ page }) => {",
      "    await test.step('a step', async () => {});",
      '  });',
      "  test.describe('inner', () => {",
      '    test(`S7-02 a template title`, async () => {});',
      "    test.fixme('S7-03 not yet', async () => {});",
      '  });',
      '});',
      'const title = "dynamic";',
      'test(title, async () => {});',
    ].join('\n');
    assert.deepEqual(testsInSpec(source), [
      { title: 'S7-01 first @inline', line: 4, tags: ['@inline', '@task-7', '@slow', '@area'], disabled: null },
      { title: 'S7-02 a template title', line: 8, tags: ['@area'], disabled: null },
      { title: 'S7-03 not yet', line: 9, tags: ['@area'], disabled: 'fixme' },
    ]);
  });

  it('parses a file’s parts and what is malformed in it', () => {
    const { meta, scenarios, problems } = parseScenarioFile(
      [
        '---',
        'task: 7',
        'title: A task',
        '---',
        '',
        '## S7-01 · happy',
        '- Given a',
        '- When b',
        '- Then c',
        `- Test: \`${SPEC}\``,
      ].join('\n'),
    );
    assert.deepEqual(meta, { task: '7', title: 'A task' });
    assert.deepEqual(scenarios, [
      {
        id: 'S7-01',
        task: 7,
        category: 'happy',
        line: 6,
        steps: ['Given', 'When', 'Then'],
        test: SPEC,
        manual: null,
        endings: 1,
      },
    ]);
    assert.deepEqual(problems, []);
  });
});

// User scenarios (#338, ADR-0038): every user-facing task has `docs/scenarios/<issue>-<slug>.md`, at least 20 scenarios
// across the categories below, each proven by a Playwright test whose title starts with its id and that carries the
// tag `@task-<issue>`, or manual with the reason it can't be automated. The standard is in docs/scenarios/README.md; the
// command line is tooling/check-scenarios.mjs; tooling/scenarios.test.mjs tests these helpers. Pure but for reading
// files under the root it is given.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import ts from 'typescript';

/** Where the scenarios files live, from the repository's root. */
export const SCENARIOS_DIR = 'docs/scenarios';

/** The feature registry (#337, ADR-0039). A file's `feature:` must be one of its ids, once the registry exists. */
export const FEATURES_FILE = 'docs/features.json';

/** The fewest scenarios a file may have. */
export const MIN_SCENARIOS = 20;

/** The most scenarios a file may leave to a person instead of a browser test. */
export const MAX_MANUAL = 3;

/**
 * Each category's slug and the fewest scenarios a file must have in it (ADR-0038): the main path, wrong or edge-case
 * input, failures of the network, X, GitHub or Supabase, security (another user, signed out, data that must stay in
 * the browser), first run with nothing yet, cancel, confirm and undo, accessibility, another browser, system or screen
 * size, and what lasts across a reload, a second tab, or signing out and in.
 */
export const CATEGORY_MINIMUMS = Object.freeze({
  happy: 3,
  invalid: 3,
  error: 3,
  security: 3,
  empty: 2,
  cancel: 2,
  a11y: 2,
  browser: 1,
  persistence: 1,
});

/** A scenarios file's name: `<issue>-<slug>.md`, such as `299-install-page.md`. */
export const FILE_NAME = /^(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** A Playwright spec, which a `Test:` line names. */
const SPEC_FILE = /\.spec\.[cm]?[jt]sx?$/;

/** A scenario's heading: `## S299-01 · happy`. */
const HEADING = /^## S(\d+)-(\d{2,3}) · ([a-z0-9]+)$/;

/** The id at the start of a test's title: `S299-01`, followed by a space or nothing. */
const TITLE_ID = /^S(\d+)-(\d{2,3})(?:\s|$)/;

/** A feature's id in the registry: kebab-case. */
const FEATURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The front matter's keys; `feature` may be left out. */
const META_KEYS = ['task', 'title', 'feature'];

/** How a test or a group can be kept from proving anything: skipped, left to fix, run alone, or expected to fail. */
const DISABLING = new Set(['skip', 'fixme', 'only', 'fail']);

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', 'playwright-report', 'test-results']);

/** The tag every test of task `task` carries, which `npx playwright test --grep @task-<task>` selects. */
export function taskTag(task) {
  return `@task-${task}`;
}

/**
 * The parts of a scenarios file: its front matter (`meta`), its scenarios, and what is malformed in it (`problems`,
 * each `line: what`). A scenario is `{ id, task, category, line, steps, test, manual, endings }`, where `steps` lists
 * its Given / When / Then / And keywords in order, `test` or `manual` is what its `Test:` or `Manual:` line says
 * (backticks around a path dropped), and `endings` counts those lines, which must be exactly one.
 */
export function parseScenarioFile(text) {
  const lines = text.split(/\r?\n/);
  const problems = [];
  const fail = (line, message) => problems.push(`${line}: ${message}`);

  // Front matter: `---`, `key: value` lines, `---`.
  const meta = {};
  let i = 0;
  if (lines[0]?.trim() !== '---') {
    fail(1, 'must start with front matter: ---, task: <issue>, title: <task title>, ---');
  } else {
    const end = lines.findIndex((line, n) => n > 0 && line.trim() === '---');
    if (end < 0) fail(1, 'front matter is not closed with ---');
    for (let n = 1; n < (end < 0 ? lines.length : end); n++) {
      const line = lines[n] ?? '';
      if (!line.trim()) continue;
      const match = /^([a-z]+):\s*(.*)$/.exec(line);
      if (!match) fail(n + 1, `front matter line "${line}" is not "key: value"`);
      else if (!META_KEYS.includes(match[1]))
        fail(n + 1, `unknown front matter key "${match[1]}" (${META_KEYS.join(', ')})`);
      else if (match[1] in meta) fail(n + 1, `front matter key "${match[1]}" is set twice`);
      else meta[match[1]] = match[2].trim();
    }
    i = end < 0 ? lines.length : end + 1;
  }
  if (meta.task === undefined) fail(1, 'front matter has no task');
  else if (!/^[1-9]\d*$/.test(meta.task)) fail(1, `front matter task "${meta.task}" is not an issue number`);
  if (!meta.title) fail(1, 'front matter has no title');
  if (meta.feature !== undefined && !FEATURE_ID.test(meta.feature))
    fail(1, `front matter feature "${meta.feature}" is not a kebab-case id`);

  // Scenarios: a heading, then Given / When / Then (And), then Test: or Manual:.
  const scenarios = [];
  let current = null;
  for (; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const n = i + 1;
    if (raw.startsWith('## ')) {
      const match = HEADING.exec(raw.trimEnd());
      if (!match) {
        fail(n, `"${raw.trim()}" is not a scenario heading: ## S<issue>-NN · <category>`);
        current = null;
        continue;
      }
      current = {
        id: `S${match[1]}-${match[2]}`,
        task: Number(match[1]),
        category: match[3],
        line: n,
        steps: [],
        test: null,
        manual: null,
        endings: 0,
      };
      scenarios.push(current);
      continue;
    }
    if (!current || !raw.trim() || raw.startsWith('#')) continue;
    // A line may be a list item (`- Given …`); an indented line goes on from the one before it.
    if (/^\s/.test(raw) && !/^\s*[-*]\s/.test(raw)) continue;
    const line = raw.replace(/^\s*[-*]\s+/, '').trim();
    const step = /^(Given|When|Then|And)\s+\S/.exec(line);
    const ending = /^(Test|Manual):(.*)$/.exec(line);
    if (step) current.steps.push(step[1]);
    else if (ending) {
      current.endings++;
      const value = ending[2].trim().replace(/^`(.*)`$/, '$1');
      if (ending[1] === 'Test') current.test = value;
      else current.manual = value;
    } else fail(n, `${current.id}: "${line}" is not a Given, When, Then, And, Test: or Manual: line`);
  }
  return { meta, scenarios, problems };
}

/** What is wrong with a scenario's steps: they must be Given, When and Then, in that order, with And after any. */
export function stepProblems(steps) {
  const order = { Given: 1, When: 2, Then: 3 };
  let phase = 0;
  for (const step of steps) {
    if (step === 'And') {
      if (phase === 0) return 'starts with And: start with Given';
      continue;
    }
    if (order[step] < phase) return `has ${step} after ${['', 'Given', 'When', 'Then'][phase]}: Given, When, Then`;
    if (order[step] > phase + 1) return `has ${step} before ${['Given', 'When'][phase]}: Given, When, Then`;
    phase = order[step];
  }
  return phase === 3 ? null : 'needs Given, When and Then lines, in that order';
}

/** A call's callee as names, such as `['test', 'describe', 'skip']`; null for anything but a chain of names. */
function calleeChain(expression) {
  const names = [];
  let node = expression;
  while (ts.isPropertyAccessExpression(node)) {
    names.unshift(node.name.text);
    node = node.expression;
  }
  if (!ts.isIdentifier(node)) return null;
  names.unshift(node.text);
  return names;
}

/** A string literal's text, or null for anything else (a template with `${…}`, a variable). */
function literal(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
}

/** The tags in a test's or group's details (`{ tag: '@a' }` or `{ tag: ['@a', '@b'] }`) and in its title. */
function tagsOf(title, details) {
  const tags = (title.match(/(?<=^|\s)@[\w-]+/g) ?? []).slice();
  if (details && ts.isObjectLiteralExpression(details)) {
    for (const property of details.properties) {
      const name = ts.isPropertyAssignment(property) ? property.name : null;
      if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name)) || name.text !== 'tag') continue;
      const value = property.initializer;
      const items = ts.isArrayLiteralExpression(value) ? value.elements : [value];
      for (const item of items) if (literal(item) !== null) tags.push(literal(item));
    }
  }
  return tags;
}

/**
 * The Playwright tests declared in a spec's source: `{ title, line, tags, disabled }`, where `tags` include those of
 * the groups around the test (Playwright's `--grep` sees them too), and `disabled` names what keeps it from running
 * as a passing test: `test.skip`, `test.fixme`, `test.only` or `test.fail`, on the test, on a group around it, or
 * called inside either without a title (`test.skip(condition)`); null when nothing does.
 */
export function testsInSpec(source, fileName = 'spec.ts') {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tests = [];
  const visit = (node, scope) => {
    let inner = scope;
    if (ts.isCallExpression(node)) {
      const [first, ...rest] = calleeChain(node.expression) ?? [];
      const title = literal(node.arguments[0]);
      const details = node.arguments.length > 2 ? node.arguments[1] : undefined;
      const disabling = rest.find((name) => DISABLING.has(name)) ?? null;
      if (first === 'test' && rest[0] === 'describe' && title !== null) {
        inner = { parent: scope, tags: tagsOf(title, details), disabled: disabling };
      } else if (first === 'test' && rest.every((name) => DISABLING.has(name))) {
        if (title !== null) {
          const test = {
            title,
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            parent: scope,
            tags: tagsOf(title, details),
            disabled: disabling,
          };
          tests.push(test);
          inner = test;
        } else if (disabling) {
          // `test.skip()`, `test.fixme(condition, reason)`: the test, group or file it is called in.
          scope.disabled ??= disabling;
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, inner));
  };
  visit(file, { parent: null, tags: [], disabled: null });
  return tests.map((test) => {
    const tags = [];
    let disabled = null;
    for (let scope = test; scope; scope = scope.parent) {
      tags.push(...scope.tags);
      disabled ??= scope.disabled;
    }
    return { title: test.title, line: test.line, tags: [...new Set(tags)], disabled };
  });
}

/** Every Playwright spec under `apps/` and `packages/`, repository-relative. */
function specFiles(root) {
  const out = [];
  const walk = (dir) => {
    const full = join(root, dir);
    if (!existsSync(full)) return;
    for (const name of readdirSync(full)) {
      if (SKIP_DIRS.has(name)) continue;
      const path = `${dir}/${name}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (SPEC_FILE.test(name)) out.push(path);
    }
  };
  walk('apps');
  walk('packages');
  return out;
}

/** The feature ids in the registry, or null while it doesn't exist (#337); a problem when it can't be read. */
function featureIds(root) {
  const path = join(root, FEATURES_FILE);
  if (!existsSync(path)) return { ids: null, problem: null };
  try {
    const registry = JSON.parse(readFileSync(path, 'utf8'));
    const features = Array.isArray(registry) ? registry : registry?.features;
    if (!Array.isArray(features)) throw new Error('no "features" list');
    return { ids: new Set(features.map((feature) => feature?.id)), problem: null };
  } catch (error) {
    return {
      ids: null,
      problem: `${FEATURES_FILE}: can't be read (${error.message}), so no feature id can be checked`,
    };
  }
}

/**
 * Checks every scenarios file under `root` against the standard (docs/scenarios/README.md) and every Playwright spec
 * against the files: `{ files, scenarios, manual, problems }`, each problem `path:line: what`. A test whose title
 * starts with a scenario id, or that carries a task's tag, must be that scenario's test, so `--grep @task-<issue>`
 * runs exactly a task's scenarios.
 */
export function checkScenarios(root) {
  const problems = [];
  const dir = join(root, SCENARIOS_DIR);
  const names = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.md') && name !== 'README.md')
        .sort()
    : [];
  const features = featureIds(root);
  if (features.problem) problems.push(features.problem);

  const specs = new Map();
  /** The tests in a spec, read once; null when the path isn't a spec in the repository. */
  const testsOf = (path) => {
    if (!specs.has(path)) {
      const full = join(root, path);
      const inside = !isAbsolute(path) && !normalize(path).startsWith('..');
      specs.set(
        path,
        inside && SPEC_FILE.test(path) && existsSync(full) && statSync(full).isFile()
          ? testsInSpec(readFileSync(full, 'utf8'), path)
          : null,
      );
    }
    return specs.get(path);
  };

  /** Each task's scenario ids, and the spec each one names, for the reverse check below. */
  const known = new Map();
  let scenarioCount = 0;
  let manualCount = 0;
  for (const name of names) {
    const path = `${SCENARIOS_DIR}/${name}`;
    const at = (line, message) => problems.push(`${path}:${line}: ${message}`);
    const { meta, scenarios, problems: format } = parseScenarioFile(readFileSync(join(dir, name), 'utf8'));
    for (const problem of format) problems.push(`${path}:${problem}`);
    const fileTask = FILE_NAME.exec(name)?.[1];
    if (!fileTask) at(1, 'the name must be <issue>-<slug>.md, such as 299-install-page.md');
    const task = /^[1-9]\d*$/.test(meta.task ?? '') ? Number(meta.task) : null;
    if (task !== null && fileTask && Number(fileTask) !== task)
      at(1, `front matter task ${task} is not the issue in the file's name (${fileTask})`);
    if (meta.feature && features.ids && !features.ids.has(meta.feature))
      at(1, `feature "${meta.feature}" is not an id in ${FEATURES_FILE}`);

    const ids = new Map();
    if (task !== null) known.set(task, ids);
    const counts = Object.fromEntries(Object.keys(CATEGORY_MINIMUMS).map((category) => [category, 0]));
    let manual = 0;
    for (const scenario of scenarios) {
      const where = (message) => at(scenario.line, `${scenario.id}: ${message}`);
      if (task !== null && scenario.task !== task) where(`its number is not this file's task (S${task}-NN)`);
      if (ids.has(scenario.id)) where(`is used twice (also on line ${ids.get(scenario.id).line})`);
      else ids.set(scenario.id, { line: scenario.line, spec: scenario.test });
      if (scenario.category in counts) counts[scenario.category]++;
      else where(`unknown category "${scenario.category}" (${Object.keys(CATEGORY_MINIMUMS).join(', ')})`);
      const steps = stepProblems(scenario.steps);
      if (steps) where(steps);

      if (scenario.endings !== 1) {
        where(
          scenario.endings === 0
            ? 'ends with no Test: <spec path> or Manual: <reason>'
            : 'has more than one Test: or Manual: line',
        );
        continue;
      }
      if (scenario.manual !== null) {
        manual++;
        if (!scenario.manual) where('Manual: needs the reason it can’t be automated');
        continue;
      }
      const spec = scenario.test;
      const tests = spec ? testsOf(spec) : null;
      if (!spec) {
        where('Test: needs the path of its Playwright spec, from the repository root');
        continue;
      }
      if (!tests) {
        where(`Test: ${spec} is not a Playwright spec (*.spec.ts) in the repository`);
        continue;
      }
      const matching = tests.filter((test) => TITLE_ID.exec(test.title)?.[0].trim() === scenario.id);
      if (matching.length === 0) {
        where(`${spec} has no test whose title starts with ${scenario.id}`);
        continue;
      }
      if (matching.length > 1) where(`${spec} has ${matching.length} tests whose titles start with ${scenario.id}`);
      for (const test of matching) {
        if (test.disabled) where(`its test (${spec}:${test.line}) is marked ${test.disabled}`);
        if (task !== null && !test.tags.includes(taskTag(task)))
          where(`its test (${spec}:${test.line}) doesn't carry the tag ${taskTag(task)}`);
      }
    }
    scenarioCount += scenarios.length;
    manualCount += manual;
    if (scenarios.length < MIN_SCENARIOS)
      at(1, `has ${scenarios.length} scenarios; at least ${MIN_SCENARIOS} are needed`);
    for (const [category, minimum] of Object.entries(CATEGORY_MINIMUMS))
      if (counts[category] < minimum)
        at(1, `has ${counts[category]} ${category} scenarios; at least ${minimum} are needed`);
    if (manual > MAX_MANUAL) at(1, `has ${manual} manual scenarios; at most ${MAX_MANUAL} may be`);
  }

  // The other way round: a test that names a scenario, or carries a task's tag, belongs to a scenario.
  for (const spec of specFiles(root)) {
    for (const test of testsOf(spec) ?? []) {
      const where = `${spec}:${test.line}`;
      const id = TITLE_ID.exec(test.title);
      if (id) {
        const scenario = known.get(Number(id[1]))?.get(id[0].trim());
        if (!scenario)
          problems.push(`${where}: test "${test.title}" names ${id[0].trim()}, which no scenarios file has`);
        else if (scenario.spec !== spec)
          problems.push(
            `${where}: test "${test.title}" names ${id[0].trim()}, whose scenario ${scenario.spec ? `names ${scenario.spec}` : 'is manual'}`,
          );
      }
      for (const tag of test.tags) {
        const tagged = /^@task-(\d+)$/.exec(tag);
        if (tagged && id?.[1] !== tagged[1])
          problems.push(
            `${where}: test "${test.title}" carries ${tag} but its title doesn't start with an S${tagged[1]}-NN id`,
          );
      }
    }
  }
  return { files: names.length, scenarios: scenarioCount, manual: manualCount, problems };
}

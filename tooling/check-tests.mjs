// Test presence gate, run by `npm run tests:check` (part of `npm run verify` and CI).
//
// Every source file must be imported by at least one test file, directly. Coverage thresholds say how much
// of the code runs under test; this check says that nothing was added without a test at all (docs/TESTING.md).
// A file that has nothing to test on its own (types only, or a thin entry point covered elsewhere) is listed
// in EXEMPT with the reason. An exemption for a file that no longer exists, or that now has a test, fails too,
// so the list can't go stale.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Source trees checked, with the alias each workspace resolves (`@/` in the website). */
const WORKSPACES = [
  { dir: 'apps/extension', sources: ['src'], skip: ['src/dev/'], aliases: {} },
  { dir: 'apps/web', sources: ['src/modules', 'src/shared', 'src/proxy.ts'], skip: [], aliases: { '@/': 'src/' } },
  { dir: 'packages/consent', sources: ['src'], skip: [], aliases: {} },
  { dir: 'packages/db', sources: ['src'], skip: [], aliases: {} },
];

/** Files with nothing to test on their own, and why. Paths are relative to the repository root. */
const EXEMPT = {
  'apps/extension/src/shared/types.ts': 'types only',
  'apps/extension/src/shared/messages.ts': 'message types only',
  'apps/extension/src/ui/navigation.ts': 'types only',
  'apps/extension/src/ui/main.tsx': 'entry point: mounts <App />, which has its own tests',
  'apps/extension/src/engine/timer-worker.ts':
    'a Web Worker script that only forwards setTimeout; used through timers.ts',
  'apps/web/src/modules/auth/application/ports.ts': 'interfaces only',
  'apps/web/src/modules/dashboard/application/ports.ts': 'interfaces only',
  'packages/db/src/database.types.ts': 'generated from the migrations; checked by the CI types-drift step',
  'packages/db/src/index.ts': 'type re-exports only',
};

const SOURCE = /\.(ts|tsx)$/;
const TEST = /\.(test|spec)\.(ts|tsx)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'coverage']);

/** Every file under `path` (a file or a folder, repository-relative) whose name matches `pattern`. */
function files(path, pattern, out = []) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return out;
  if (!statSync(full).isDirectory()) {
    if (pattern.test(path)) out.push(path);
    return out;
  }
  for (const name of readdirSync(full)) {
    if (SKIP_DIRS.has(name)) continue;
    files(`${path}/${name}`, pattern, out);
  }
  return out;
}

/** The repository-relative file a specifier in `from` points to, or null for packages. */
function resolveImport(from, specifier, workspace) {
  let target = null;
  if (specifier.startsWith('.')) target = join(dirname(from), specifier);
  for (const [alias, path] of Object.entries(workspace.aliases))
    if (specifier.startsWith(alias)) target = join(workspace.dir, path, specifier.slice(alias.length));
  if (!target) return null;
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`])
    if (existsSync(join(ROOT, candidate)) && statSync(join(ROOT, candidate)).isFile()) return candidate;
  return null;
}

// Static and dynamic imports, and `vi.importActual` (how a test loads a page script for its side effects).
// `import type` brings in no code, and `vi.mock('…')` replaces a file instead of testing it: neither counts.
const IMPORT =
  /(?:import|export)\s+(?!type\s)[^'"]*?from\s*['"]([^'"]+)['"]|import(?:Actual)?\s*(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

const problems = [];
let checked = 0;
for (const workspace of WORKSPACES) {
  const tests = files(workspace.dir, TEST);
  const imported = new Set();
  for (const test of tests) {
    const text = readFileSync(join(ROOT, test), 'utf8');
    for (const match of text.matchAll(IMPORT)) {
      const target = resolveImport(test, match[1] ?? match[2] ?? match[3], workspace);
      if (target) imported.add(target);
    }
  }
  const sources = workspace.sources
    .flatMap((path) => files(`${workspace.dir}/${path}`, SOURCE))
    .filter((path) => !TEST.test(path) && !path.endsWith('.d.ts'))
    .filter((path) => !workspace.skip.some((skip) => path.startsWith(`${workspace.dir}/${skip}`)));
  for (const source of sources) {
    checked++;
    const exempt = EXEMPT[source];
    if (imported.has(source) && exempt) problems.push(`${source}: has a test now; remove it from EXEMPT`);
    else if (!imported.has(source) && !exempt) problems.push(`${source}: no test imports it`);
  }
}
for (const path of Object.keys(EXEMPT))
  if (!existsSync(join(ROOT, path))) problems.push(`${path}: listed in EXEMPT but does not exist`);

if (problems.length) {
  console.error(`Test presence check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nAdd a test that imports the file (see docs/TESTING.md), or list it in EXEMPT with the reason.');
  process.exit(1);
}
console.log(`Test presence check passed: ${checked} source files, each imported by a test or exempt with a reason.`);

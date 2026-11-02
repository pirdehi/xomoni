// Documentation gate, run by `npm run docs:check` (pre-push hook and CI).
//
// Code-level docs (a doc comment on every export) are enforced by ESLint. This script checks the
// documents around the code, so the docs can't silently fall behind the architecture:
//
//   1. The project documents exist.
//   2. Every architectural unit (app, package, website module, extension area, supabase/) has a
//      README.md with a title and real content.
//   3. docs/ARCHITECTURE.md mentions every unit by path, and documents every architecture rule
//      defined in .dependency-cruiser.cjs.
//   4. ADRs are numbered, complete (Status, Context, Decision, Consequences) and listed in the index.
//   5. Relative links in Markdown files resolve.
//   6. Every environment variable the website reads is documented in apps/web/.env.example.
//   7. Every database migration starts with a comment explaining it.
//
// Prints every problem, then exits 1 if there were any.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const exists = (path) => existsSync(join(ROOT, path));
const dirs = (path) =>
  exists(path) ? readdirSync(join(ROOT, path)).filter((name) => statSync(join(ROOT, path, name)).isDirectory()) : [];

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.temp',
  '.branches',
]);

/** All files under `dir` (repo-relative) whose name matches `test`. */
function walk(dir, test, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (SKIP_DIRS.has(name)) continue;
    const path = dir ? `${dir}/${name}` : name;
    if (statSync(join(ROOT, path)).isDirectory()) walk(path, test, out);
    else if (test(name)) out.push(path);
  }
  return out;
}

// 1. Project documents ────────────────────────────────────────────────────────────────────
const REQUIRED_DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'AGENTS.md',
  'docs/ARCHITECTURE.md',
  'docs/PLAYBOOK.md',
  'docs/ROADMAP.md',
  'docs/adr/README.md',
];
for (const doc of REQUIRED_DOCS) if (!exists(doc)) fail(doc, 'required document is missing');

// 2. A README for every architectural unit ───────────────────────────────────────────────
const units = [
  ...dirs('apps').map((app) => `apps/${app}`),
  ...dirs('packages').map((pkg) => `packages/${pkg}`),
  ...dirs('apps/web/src/modules').map((mod) => `apps/web/src/modules/${mod}`),
  'apps/web/src/shared',
  ...dirs('apps/extension/src').map((area) => `apps/extension/src/${area}`),
  'supabase',
];
for (const unit of units) {
  const readme = `${unit}/README.md`;
  if (!exists(readme)) {
    fail(readme, 'missing: every app, package, module and area documents its responsibility');
    continue;
  }
  const text = read(readme);
  if (!/^# \S/m.test(text)) fail(readme, 'needs a "# Title" heading');
  const prose = text.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
  if (prose.length < 3) fail(readme, 'too short: describe responsibility, dependencies and rules');
}

// 3. ARCHITECTURE.md covers every unit and every enforced rule ───────────────────────────
if (exists('docs/ARCHITECTURE.md')) {
  const architecture = read('docs/ARCHITECTURE.md');
  for (const unit of units) {
    if (!architecture.includes(unit)) fail('docs/ARCHITECTURE.md', `does not mention \`${unit}\``);
  }
  const require = createRequire(import.meta.url);
  const cruiser = require(join(ROOT, '.dependency-cruiser.cjs'));
  for (const rule of [...(cruiser.forbidden ?? []), ...(cruiser.required ?? [])]) {
    if (!architecture.includes(`\`${rule.name}\``))
      fail('docs/ARCHITECTURE.md', `does not document rule \`${rule.name}\``);
    if (!rule.comment) fail('.dependency-cruiser.cjs', `rule ${rule.name} has no comment`);
  }
}

// 4. ADRs ─────────────────────────────────────────────────────────────────────────────────
if (exists('docs/adr')) {
  const index = exists('docs/adr/README.md') ? read('docs/adr/README.md') : '';
  const adrs = readdirSync(join(ROOT, 'docs/adr'))
    .filter((name) => name.endsWith('.md') && name !== 'README.md' && name !== 'template.md')
    .sort();
  adrs.forEach((name, i) => {
    const where = `docs/adr/${name}`;
    const match = /^(\d{4})-[a-z0-9-]+\.md$/.exec(name);
    if (!match) return fail(where, 'name must be NNNN-kebab-title.md');
    if (Number(match[1]) !== i + 1) fail(where, `expected number ${String(i + 1).padStart(4, '0')} (no gaps)`);
    const text = read(where);
    if (!/^- Status: (Proposed|Accepted|Superseded by \[ADR-\d{4}\]\(.+\)|Deprecated)\s*$/m.test(text))
      fail(where, 'needs "- Status: Proposed|Accepted|Deprecated|Superseded by [ADR-NNNN](…)"');
    if (!/^- Date: \d{4}-\d{2}-\d{2}\s*$/m.test(text)) fail(where, 'needs "- Date: YYYY-MM-DD"');
    for (const section of ['Context', 'Decision', 'Consequences']) {
      if (!new RegExp(`^## ${section}\\b`, 'm').test(text)) fail(where, `missing "## ${section}"`);
    }
    if (!index.includes(`(${name})`)) fail('docs/adr/README.md', `does not list ${name}`);
  });
}

// 5. Relative links in Markdown ───────────────────────────────────────────────────────────
for (const file of walk('', (name) => name.endsWith('.md'))) {
  const text = read(file)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = decodeURIComponent(target.split('#')[0]);
    if (!path) continue;
    const absolute = resolve(ROOT, dirname(file), path);
    if (!existsSync(absolute)) fail(file, `broken link → ${target}`);
    else if (!absolute.startsWith(ROOT)) fail(file, `link leaves the repository → ${target}`);
  }
}

// 6. Environment variables are documented ─────────────────────────────────────────────────
// Set by the platform, not by us.
const PLATFORM_ENV = new Set(['NODE_ENV', 'CI', 'VERCEL', 'VERCEL_ENV', 'NEXT_PUBLIC_VERCEL_URL', 'NEXT_RUNTIME']);
if (exists('apps/web/.env.example')) {
  const documented = new Set([...read('apps/web/.env.example').matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  for (const file of walk('apps/web/src', (name) => /\.(ts|tsx)$/.test(name))) {
    for (const [, name] of read(file).matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!PLATFORM_ENV.has(name) && !documented.has(name))
        fail(file, `${name} is not documented in apps/web/.env.example`);
    }
  }
}

// 7. Migrations explain themselves ────────────────────────────────────────────────────────
for (const file of exists('supabase/migrations') ? walk('supabase/migrations', (name) => name.endsWith('.sql')) : []) {
  if (!read(file).trimStart().startsWith('--'))
    fail(file, 'must start with a -- comment saying what it changes and why');
}

// ──────────────────────────────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`Documentation check failed (${problems.length}):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('\nSee docs/ARCHITECTURE.md#documentation-rules.');
  process.exit(1);
}
console.log(`Documentation check passed: ${units.length} units, all links and ADRs in order.`);

// Writes, or checks, the generated blocks of README.md and README.fa.md from docs/features.json (#337, ADR-0039): the
// feature list, and the status (the newest release in CHANGELOG.md). Text outside the markers is never touched.
//
//   node tooling/readme.mjs           `npm run readme`: writes both READMEs
//   node tooling/readme.mjs --check   `npm run readme:check`, part of `npm run verify`: fails when the registry is
//                                     invalid or out of step with CHANGELOG.md, or when a README differs from what
//                                     `npm run readme` would write
//
// The rules are in tooling/readme-lib.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { README_FILES, readmeReport } from './readme-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const check = process.argv.includes('--check');

const fail = (problems) => {
  console.error(`README check failed (${problems.length}):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(
    '\nEvery feature lives in docs/features.json; `npm run readme` writes the READMEs from it (CONTRIBUTING.md).',
  );
  process.exit(1);
};

let registry;
try {
  registry = JSON.parse(read('docs/features.json'));
} catch (error) {
  fail([`docs/features.json: ${error instanceof Error ? error.message : String(error)}`]);
}
const readmes = Object.fromEntries(
  Object.values(README_FILES).map((file) => [file, existsSync(join(ROOT, file)) ? read(file) : undefined]),
);
const { problems, expected, stale } = readmeReport({
  registry,
  changelog: read('CHANGELOG.md'),
  readmes,
  exists: (path) => existsSync(join(ROOT, path)),
});

if (check) {
  for (const file of stale)
    problems.push(`${file} is out of date with docs/features.json and CHANGELOG.md: run npm run readme`);
  if (problems.length) fail(problems);
  console.log(`README check passed: ${registry.features.length} features, both READMEs up to date.`);
} else {
  if (problems.length) fail(problems);
  for (const file of stale) writeFileSync(join(ROOT, file), expected[file]);
  console.log(
    stale.length
      ? `Wrote ${stale.join(' and ')} from ${registry.features.length} features.`
      : `README.md and README.fa.md are already up to date (${registry.features.length} features).`,
  );
}

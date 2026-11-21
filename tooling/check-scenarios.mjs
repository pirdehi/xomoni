// User scenarios gate (#338, ADR-0038), run by `npm run scenarios:check` (part of `npm run verify`, so of the pre-push
// hook and CI). Every file in docs/scenarios/ must have at least 20 scenarios across the categories, each tied to a
// Playwright test whose title starts with its id and that carries `@task-<issue>`, or manual with a reason (3 at most).
// The rules are in tooling/scenarios-lib.mjs and docs/scenarios/README.md.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS_DIR, checkScenarios } from './scenarios-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { files, scenarios, manual, problems } = checkScenarios(ROOT);
if (problems.length) {
  console.error(`User scenarios check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`\nSee ${SCENARIOS_DIR}/README.md for the standard.`);
  process.exit(1);
}
console.log(
  `User scenarios check passed: ${files} ${files === 1 ? 'file' : 'files'}, ${scenarios} scenarios (${scenarios - manual} with a browser test, ${manual} manual).`,
);

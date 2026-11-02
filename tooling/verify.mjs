// The full local quality gate: the same checks CI runs before anything can merge.
// Runs on every `git push` through .githooks/pre-push; run it yourself with `npm run verify`.
import { spawnSync } from 'node:child_process';

const steps = [
  ['Formatting', 'format:check'],
  ['Lint and code documentation', 'lint'],
  ['Types', 'typecheck'],
  ['Architecture rules', 'arch'],
  ['Documentation', 'docs:check'],
  ['Test presence', 'tests:check'],
  ['Unit tests and coverage', 'test'],
];

const results = [];
for (const [label, script] of steps) {
  console.log(`\n━━ ${label} (npm run ${script})`);
  const started = Date.now();
  const { status } = spawnSync('npm', ['run', '--silent', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  results.push({ label, ok: status === 0, seconds: ((Date.now() - started) / 1000).toFixed(1) });
  if (status !== 0) break;
}

console.log('\n━━ Summary');
for (const { label, ok, seconds } of results) console.log(`  ${ok ? '✓' : '✗'} ${label} (${seconds}s)`);
const failed = results.find((r) => !r.ok);
if (failed) {
  console.error(`\nverify failed at "${failed.label}". Fix it before pushing; see CONTRIBUTING.md.`);
  process.exit(1);
}
console.log('\nAll checks passed.');

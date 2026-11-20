// No remotely hosted code (#301), run by `npm run remote-code:check` (part of `npm run verify`) after building the
// extension, and by the release workflow on the build it packages. Manifest V3 and both stores refuse an extension that
// runs code from outside its package or builds code from strings; this reads every script and page in the bundle,
// libraries included, and the manifest's CSP. The rules are in tooling/remote-code-lib.mjs.
//
//   node tooling/check-remote-code.mjs [bundle folder]   default: apps/extension/dist
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleProblems } from './remote-code-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(ROOT, process.argv[2] ?? 'apps/extension/dist');
const problems = bundleProblems(dir);
if (problems.length) {
  console.error(`Remote code check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nEvery script must ship in the extension and none may be built from a string (docs/STORE-LISTING.md).',
  );
  process.exit(1);
}
console.log(`Remote code check passed: no remotely hosted or string-built code in ${dir}.`);

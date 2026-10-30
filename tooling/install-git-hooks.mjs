// Points git at the versioned hooks in .githooks, so `git push` runs `npm run verify` first.
// Runs on `npm install` (the "prepare" script). Skipped in CI and outside a git checkout,
// such as a Vercel build.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.env.CI || process.env.VERCEL || !existsSync('.git')) process.exit(0);
execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
console.log('git hooks: .githooks (pre-push runs npm run verify)');

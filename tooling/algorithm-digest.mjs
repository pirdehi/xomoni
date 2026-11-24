// Drafts the monthly digest of X's open ranking code (#430, ADR-0046), run by .github/workflows/algorithm-digest.yml on
// the 20th of each month and by hand; anyone can run it.
//
//   node tooling/algorithm-digest.mjs [--month yyyy-mm] [--from <commit>] [--to <commit>] [--body-file <path>]
//
// It reads X's public repository `xai-org/x-algorithm` through GitHub's REST API: the newest commit (or `--to`), and the
// comparison from the last digest's commit (or `--from`) to it. When something changed, it writes the draft to
// apps/web/src/modules/algorithm/data/<month>.json, rewrites the folder's index.ts, writes the pull request's
// description to `--body-file` if given, and sets `changed=true` and `month` in GITHUB_OUTPUT. With no new commit it
// writes nothing and sets `changed=false`. Any error from GitHub ends it with no file written and exit code 1.
//
// It reads GITHUB_TOKEN from the environment when set (GitHub allows more requests with it) and never prints it. It
// reads no other input: no X data, no Xomoni data, nothing about any person. Node's built-ins only.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, DigestError, draft, parseArgs, pullRequestBody } from './algorithm-digest-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = join(ROOT, DATA_DIR);

/** Stops with `message` as an error annotation on the run. */
function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

/** Sets a step output for the workflow, when there is a workflow. */
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

const { options, problem } = parseArgs(process.argv.slice(2));
if (problem) {
  console.error('Usage: node tooling/algorithm-digest.mjs [--month yyyy-mm] [--from <commit>] [--to <commit>]');
  fail(problem);
}

/** The data folder, as the draft reads and writes it. */
const store = {
  list: () => (existsSync(folder) ? readdirSync(folder).sort() : []),
  read: (name) => readFileSync(join(folder, name), 'utf8'),
  write: (name, text) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, name), text);
  },
};

try {
  const result = await draft({
    options,
    token: process.env.GITHUB_TOKEN ?? '',
    fetch: globalThis.fetch,
    store,
    now: new Date(),
  });
  if (!result.changed) {
    console.log(`::notice::${result.reason} No draft this month.`);
    output('changed', 'false');
  } else {
    if (options.bodyFile) writeFileSync(options.bodyFile, pullRequestBody(result.digest));
    const { digest } = result;
    console.log(
      `Drafted ${DATA_DIR}/${result.month}.json: ${digest.commits} commits, ${digest.files} files, ` +
        `${digest.areas.length} areas, ${digest.parameterCount} parameters, up to ${digest.to}.`,
    );
    output('changed', 'true');
    output('month', result.month);
  }
} catch (error) {
  if (error instanceof DigestError) fail(error.message);
  throw error;
}

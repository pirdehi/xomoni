// Finds server secrets in xomoni.com's browser bundle (#421, ADR-0042, decision 4). Supabase's service-role key and
// Polar's keys are server-only: Next.js inlines only `NEXT_PUBLIC_` variables into the browser, and the files that
// read the others import `server-only`. This checks the result, so a mistake in either fails CI. The command line is
// tooling/check-browser-bundle.mjs; tooling/browser-bundle.test.mjs tests these helpers.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The server-only variables whose names, and whose values when set, may never be in a browser file. */
export const SERVER_SECRETS = ['SUPABASE_SERVICE_ROLE_KEY', 'POLAR_ACCESS_TOKEN', 'POLAR_WEBHOOK_SECRET'];

/** Every file under `dir` the browser may load: scripts, styles and source maps. */
export function browserFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return browserFiles(path);
    return /\.(js|mjs|css|map)$/.test(name) ? [path] : [];
  });
}

/**
 * The secrets found in `files` (`{ path, text }`): each variable's name, and its value from `env` when it is set and
 * long enough not to match by chance (8 characters or more). Each finding names the file and what was found, never
 * the value itself.
 */
export function secretsIn(files, env = {}) {
  const needles = SERVER_SECRETS.flatMap((name) => {
    const value = env[name];
    return [
      { needle: name, label: name },
      ...(typeof value === 'string' && value.length >= 8 ? [{ needle: value, label: `the value of ${name}` }] : []),
    ];
  });
  return files.flatMap(({ path, text }) =>
    needles.filter(({ needle }) => text.includes(needle)).map(({ label }) => `${path}: ${label}`),
  );
}

/** Reads every browser file of the website's build in `root` (`apps/web/.next/static`), with repo-relative paths. */
export function readBuild(root, repo) {
  return browserFiles(root).map((path) => ({ path: relative(repo, path), text: readFileSync(path, 'utf8') }));
}

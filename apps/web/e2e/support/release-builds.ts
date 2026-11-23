import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXTENSION_DIR_ENV } from './build-extension';

/** The environment variable naming the folder that holds the previous release, its zip unpacked (#419). */
export const PREVIOUS_DIR_ENV = 'XOMONI_E2E_PREVIOUS';

/** A built Xomoni the release smoke test installs: its folder and the version its manifest says. */
export interface ReleaseBuild {
  dir: string;
  version: string;
}

/** The Xomoni in the folder that `name` names, or why it can't be used; how to fetch one is in docs/RELEASING.md. */
export function releaseBuild(name: string, env: Record<string, string | undefined> = process.env): ReleaseBuild {
  const dir = env[name];
  const fetch = 'unpack a release with `node tooling/release-download.mjs vX.Y.Z <folder>` (docs/RELEASING.md)';
  if (!dir) throw new Error(`${name} is not set: ${fetch}`);
  const manifest = path.join(dir, 'manifest.json');
  if (!existsSync(manifest)) throw new Error(`${name}=${dir} has no manifest.json: ${fetch}`);
  const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version?: unknown };
  if (typeof version !== 'string') throw new Error(`${name}=${dir}: its manifest has no version`);
  return { dir: path.resolve(dir), version };
}

/** Whether version `a` comes after `b`, by their numbers (`0.10.0` after `0.9.1`). */
export function isNewer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(x!.length, y!.length); i++) {
    const d = (x![i] ?? 0) - (y![i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * The candidate (`XOMONI_E2E_EXTENSION`) and the previous release (`XOMONI_E2E_PREVIOUS`) in `env`, both unpacked
 * zips; throws unless both are there and the candidate is the newer.
 */
export function releaseBuilds(env: Record<string, string | undefined> = process.env): {
  candidate: ReleaseBuild;
  previous: ReleaseBuild;
} {
  const candidate = releaseBuild(EXTENSION_DIR_ENV, env);
  const previous = releaseBuild(PREVIOUS_DIR_ENV, env);
  if (!isNewer(candidate.version, previous.version))
    throw new Error(
      `${EXTENSION_DIR_ENV} is Xomoni ${candidate.version}, not newer than ${PREVIOUS_DIR_ENV}'s ${previous.version}`,
    );
  return { candidate, previous };
}

/**
 * Playwright's global setup for the release smoke test (`playwright.release.config.ts`, #419). It builds nothing: it
 * checks the two releases with `releaseBuilds`, then prints both versions.
 */
export default function checkReleaseBuilds(): void {
  const { candidate, previous } = releaseBuilds();
  console.info(`Release smoke test: Xomoni ${previous.version} (previous) to ${candidate.version} (candidate)`);
}

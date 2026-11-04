// Helpers for releasing the extension (docs/RELEASING.md). Kept apart from the command line in
// tooling/release.mjs so tooling/release.test.mjs can test them.
import { execFileSync } from 'node:child_process';
import { chmodSync, readdirSync, utimesSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The version in a tag such as `v0.2.0`, or null when the tag isn't `v` plus a semantic version. */
export function versionOfTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  return match ? match[1] : null;
}

/**
 * The problems with releasing `tag`: the extension's manifest and package must carry the same version, the tag
 * (when given) must name it, and the changelog must have a section for it. Empty when all is in order.
 */
export function releaseProblems({ manifestVersion, packageVersion, changelog, tag }) {
  const problems = [];
  if (manifestVersion !== packageVersion)
    problems.push(`manifest.json says ${manifestVersion}, apps/extension/package.json says ${packageVersion}`);
  if (tag != null) {
    const version = versionOfTag(tag);
    if (!version) problems.push(`the tag ${tag} is not v<major>.<minor>.<patch>`);
    else {
      if (version !== manifestVersion) problems.push(`the tag ${tag} doesn't match the manifest's ${manifestVersion}`);
      if (changelogSection(changelog, version) == null) problems.push(`CHANGELOG.md has no section for ${version}`);
    }
  }
  return problems;
}

/** The notes under `## [version]` in a Keep a Changelog file, without the heading; null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

/** Every file under `dir`, as paths relative to it, sorted, so a zip lists them in the same order anywhere. */
export function filesUnder(dir) {
  const files = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(dir, path));
    }
  };
  walk(dir);
  return files.sort();
}

/**
 * Zips `dir` into `zipFile` so that the same files always give the same bytes (#142): sorted, without directory
 * entries or extra attributes, every file readable by all and dated `epoch` (seconds) in UTC. Anyone can then
 * rebuild a tag in the release's environment and compare the checksum. It changes the files' dates and modes.
 */
export function reproducibleZip(dir, zipFile, epoch) {
  const files = filesUnder(dir);
  const date = new Date(epoch * 1000);
  for (const file of files) {
    chmodSync(join(dir, file), 0o644);
    utimesSync(join(dir, file), date, date);
  }
  execFileSync('zip', ['-X', '-D', '-q', zipFile, '-@'], {
    cwd: dir,
    input: `${files.join('\n')}\n`,
    env: { ...process.env, TZ: 'UTC' },
  });
}

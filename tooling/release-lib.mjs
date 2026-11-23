// Helpers for releasing the extension (docs/RELEASING.md). Kept apart from the command line in
// tooling/release.mjs so tooling/release.test.mjs can test them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, readFileSync, readdirSync, utimesSync } from 'node:fs';
import { join, relative } from 'node:path';
import { changelogAddedIssues, statusVersion } from './readme-lib.mjs';

/**
 * The zips a release attaches for `version`. `latest` and `versioned` are the same file, the default build with the
 * one-click updater (#305), signed; the website's install page links `latest`. `store` is the store build, without
 * the updater, which the store workflow sends to the Chrome Web Store and Edge Add-ons (#303). It isn't signed:
 * nothing it holds checks a signature, since a store updates Xomoni itself.
 */
export const releaseZips = (version) => ({
  latest: 'xomoni-extension.zip',
  versioned: `xomoni-extension-${version}.zip`,
  store: `xomoni-extension-store-${version}.zip`,
});

/**
 * Whether `manifest`, as built, is the store build's (`npm run build:store`): nothing in it names where GitHub
 * releases are downloaded from, which the default build's host access and CSP name for the updater
 * (tooling/store-build.test.mjs checks the same).
 */
export const isStoreManifest = (manifest) => !/githubusercontent|releases\/download/.test(JSON.stringify(manifest));

/** SHA256SUMS for every zip in `dir`, sorted by name, as `sha256sum --check` reads it. */
export function zipChecksums(dir) {
  const lines = readdirSync(dir)
    .filter((name) => name.endsWith('.zip'))
    .sort()
    .map(
      (name) =>
        `${createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex')}  ${name}`,
    );
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/** The version in a tag such as `v0.2.0`, or null when the tag isn't `v` plus a semantic version. */
export function versionOfTag(tag) {
  const match = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  return match ? match[1] : null;
}

/**
 * The problems with releasing `tag`: the extension's manifest and package must carry the same version, the tag
 * (when given) must name it, and the changelog must have a section for it. Empty when all is in order. Trusting no
 * release signing key isn't one: such a release goes out unsigned, with a warning (`releaseKeyWarning`, #305).
 * Given the feature registry and the READMEs too (`registry`, `readmes`), a tag also needs `featureReleaseProblems`
 * to be empty (#337, ADR-0039).
 */
export function releaseProblems({ manifestVersion, packageVersion, changelog, tag, registry, readmes }) {
  const problems = [];
  if (manifestVersion !== packageVersion)
    problems.push(`manifest.json says ${manifestVersion}, apps/extension/package.json says ${packageVersion}`);
  if (tag != null) {
    const version = versionOfTag(tag);
    if (!version) problems.push(`the tag ${tag} is not v<major>.<minor>.<patch>`);
    else {
      if (version !== manifestVersion) problems.push(`the tag ${tag} doesn't match the manifest's ${manifestVersion}`);
      if (changelogSection(changelog, version) == null) problems.push(`CHANGELOG.md has no section for ${version}`);
      if (registry != null && readmes != null)
        problems.push(...featureReleaseProblems({ version, registry, changelog, readmes }));
    }
  }
  return problems;
}

/**
 * What the feature registry and the READMEs still lack for releasing `version` (#337, ADR-0039): every feature whose
 * issues CHANGELOG.md names under that version's `### Added` must be stamped (`since` no longer `unreleased`), and
 * each README's generated status (`readmes` maps file to text) must name the version, which `npm run readme` writes
 * from the changelog. Empty when all is in order.
 */
export function featureReleaseProblems({ version, registry, changelog, readmes }) {
  const problems = [];
  const added = changelogAddedIssues(changelog);
  const features = Array.isArray(registry?.features) ? registry.features : [];
  if (!Array.isArray(registry?.features)) problems.push('docs/features.json has no "features" list');
  for (const feature of features) {
    if (feature?.since !== 'unreleased' || !Array.isArray(feature.issues)) continue;
    const shipped = feature.issues.find((issue) => added.get(issue)?.includes(version));
    if (shipped != null)
      problems.push(
        `docs/features.json: "${feature.id}" ships in ${version} (#${shipped} is under its ### Added), but its "since" is still "unreleased": set it to "${version}", then run npm run readme`,
      );
  }
  for (const [file, text] of Object.entries(readmes)) {
    const named = typeof text === 'string' ? statusVersion(text) : null;
    if (named !== version)
      problems.push(
        named
          ? `${file}'s status names ${named}, not ${version}: run npm run readme`
          : `${file} has no generated status naming ${version}: run npm run readme`,
      );
  }
  return problems;
}

/** An Ed25519 public key as the extension trusts it: base64 of its 32 raw bytes. */
const RELEASE_KEY = /^[A-Za-z0-9+/]{43}=$/;

/**
 * The release signing keys the extension trusts, from the text of `apps/extension/src/update/release-keys.json`
 * (#305): the publish job signs only with a key in this list, so every release can be checked by the Xomoni it makes.
 * Throws when the file isn't a `keys` list of base64 Ed25519 public keys.
 */
export function trustedReleaseKeys(json) {
  const keys = JSON.parse(json)?.keys;
  if (!Array.isArray(keys)) throw new Error('release-keys.json has no "keys" list');
  const bad = keys.filter((key) => typeof key !== 'string' || !RELEASE_KEY.test(key));
  if (bad.length)
    throw new Error(`release-keys.json has keys that aren't base64 Ed25519 public keys: ${bad.join(', ')}`);
  return keys;
}

/**
 * The warning for a release while the extension trusts no signing key (#305, ADR-0033): it goes out unsigned, and no
 * Xomoni can update to it in one click. Null once a key is trusted, when signing is required instead.
 */
export function releaseKeyWarning(releaseKeys) {
  return releaseKeys.length
    ? null
    : 'apps/extension/src/update/release-keys.json trusts no signing key yet: this release will go out unsigned, and no Xomoni can update to it in one click (docs/RELEASING.md, Signing key).';
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

/**
 * The entries of a zip that would land outside the folder it is unpacked into, or nowhere: an absolute path, a drive
 * letter, a `..` step, a backslash (a separator on Windows) or an empty name. Empty for a zip `release.mjs package`
 * made. The release smoke test's download (`tooling/release-download.mjs`, #419) unpacks only a zip without any.
 */
export function unsafeZipEntries(names) {
  return names.filter(
    (name) =>
      !name ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.includes('\\') ||
      name.split('/').some((step) => step === '..'),
  );
}

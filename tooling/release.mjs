// Releasing the extension (docs/RELEASING.md). The release workflow runs these; anyone can run them locally.
//
//   node tooling/release.mjs check [vX.Y.Z]   versions agree (and match the tag), the changelog has the section; with a
//                                             tag, the features it ships are stamped with its version in
//                                             docs/features.json and both READMEs' status names it (#337); warns
//                                             while no release signing key is trusted (#305)
//   node tooling/release.mjs notes vX.Y.Z     prints the changelog section, for the GitHub release
//   node tooling/release.mjs package          zips the default build in apps/extension/dist (`npm run build`) into
//                                             apps/extension/release, with SHA256SUMS; reproducible: files dated
//                                             SOURCE_DATE_EPOCH, else the last commit's time; and release-keys, the
//                                             signing keys the extension trusts, for the publish job to check its
//                                             key against (#305)
//   node tooling/release.mjs package-store    then, after `npm run build:store`, zips the store build the same way
//                                             beside them, and lists it in SHA256SUMS (#303)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changelogSection,
  isStoreManifest,
  releaseKeyWarning,
  releaseProblems,
  releaseZips,
  reproducibleZip,
  trustedReleaseKeys,
  versionOfTag,
  zipChecksums,
} from './release-lib.mjs';
import { README_FILES } from './readme-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'apps/extension');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const manifestVersion = JSON.parse(read('apps/extension/public/manifest.json')).version;
const packageVersion = JSON.parse(read('apps/extension/package.json')).version;
const releaseKeys = trustedReleaseKeys(read('apps/extension/src/update/release-keys.json'));

const [command, tag] = process.argv.slice(2);

if (command === 'check') {
  // An unreadable registry is a problem only for a tag, which needs its features stamped.
  let registry = {};
  let registryError = null;
  try {
    registry = JSON.parse(read('docs/features.json'));
  } catch (error) {
    registryError = `docs/features.json can't be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  const readmes = Object.fromEntries(
    Object.values(README_FILES).map((file) => [file, existsSync(join(ROOT, file)) ? read(file) : undefined]),
  );
  const problems = releaseProblems({
    manifestVersion,
    packageVersion,
    changelog: read('CHANGELOG.md'),
    tag,
    registry,
    readmes,
  });
  if (tag != null && registryError) problems.push(registryError);
  // `::warning::` makes it an annotation on the release's run in GitHub Actions.
  const warning = releaseKeyWarning(releaseKeys);
  if (warning) console.warn(`::warning::${warning}`);
  if (problems.length) {
    console.error(`Not ready to release:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Release check passed: extension ${manifestVersion}${tag ? `, tag ${tag}` : ''}.`);
} else if (command === 'notes') {
  const notes = changelogSection(read('CHANGELOG.md'), versionOfTag(tag) ?? '');
  if (notes == null) {
    console.error(`CHANGELOG.md has no section for ${tag}.`);
    process.exit(1);
  }
  console.log(notes);
} else if (command === 'package' || command === 'package-store') {
  const store = command === 'package-store';
  const build = `npm run ${store ? 'build:store' : 'build'} -w @xomoni/extension`;
  const fail = (message) => {
    console.error(message);
    process.exit(1);
  };
  const dist = join(EXT, 'dist');
  if (!existsSync(join(dist, 'manifest.json'))) fail(`apps/extension/dist has no build: run \`${build}\` first.`);
  // The GitHub zips must hold the updater and the store's zip must not, whatever was built last.
  const built = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  if (isStoreManifest(built) !== store)
    fail(
      store
        ? `apps/extension/dist is the default build, with the one-click updater: run \`${build}\` first.`
        : `apps/extension/dist is the store build, without the one-click updater: run \`${build}\` first.`,
    );
  if (built.version !== manifestVersion)
    fail(`apps/extension/dist holds version ${String(built.version)}, not ${manifestVersion}: run \`${build}\` again.`);
  const out = join(EXT, 'release');
  const zips = releaseZips(manifestVersion);
  const epoch = Number(
    process.env.SOURCE_DATE_EPOCH ||
      execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8' }),
  );
  if (store) {
    if (!existsSync(join(out, zips.versioned)))
      fail('Package the default build first: `node tooling/release.mjs package`, then the store build.');
    rmSync(join(out, zips.store), { force: true });
    reproducibleZip(dist, join(out, zips.store), epoch);
  } else {
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out);
    // One file with a fixed name for the website's "latest" link, and one that names the version.
    reproducibleZip(dist, join(out, zips.latest), epoch);
    writeFileSync(join(out, zips.versioned), readFileSync(join(out, zips.latest)));
    // Not a release file: the publish job checks its signing key against it, then signs the zips (#305).
    writeFileSync(join(out, 'release-keys'), releaseKeys.map((key) => `${key}\n`).join(''));
  }
  const sums = zipChecksums(out);
  writeFileSync(join(out, 'SHA256SUMS'), sums);
  console.log(`Packaged ${manifestVersion}${store ? ', store build' : ''}:\n${sums.trimEnd()}`);
} else {
  console.error('Usage: node tooling/release.mjs check [vX.Y.Z] | notes vX.Y.Z | package | package-store');
  process.exit(1);
}

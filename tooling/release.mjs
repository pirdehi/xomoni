// Releasing the extension (docs/RELEASING.md). The release workflow runs these; anyone can run them locally.
//
//   node tooling/release.mjs check [vX.Y.Z]   versions agree (and match the tag), the changelog has the section
//   node tooling/release.mjs notes vX.Y.Z     prints the changelog section, for the GitHub release
//   node tooling/release.mjs package          zips apps/extension/dist into apps/extension/release, with SHA256SUMS
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogSection, releaseProblems, versionOfTag } from './release-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(ROOT, 'apps/extension');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const manifestVersion = JSON.parse(read('apps/extension/public/manifest.json')).version;
const packageVersion = JSON.parse(read('apps/extension/package.json')).version;

const [command, tag] = process.argv.slice(2);

if (command === 'check') {
  const problems = releaseProblems({ manifestVersion, packageVersion, changelog: read('CHANGELOG.md'), tag });
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
} else if (command === 'package') {
  const dist = join(EXT, 'dist');
  if (!existsSync(join(dist, 'manifest.json'))) {
    console.error('apps/extension/dist has no build: run `npm run build -w @xomoni/extension` first.');
    process.exit(1);
  }
  const out = join(EXT, 'release');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out);
  // One file with a fixed name for the website's "latest" link, and one that names the version.
  const names = ['xomoni-extension.zip', `xomoni-extension-${manifestVersion}.zip`];
  execFileSync('zip', ['-r', '-X', '-q', join(out, names[0]), '.'], { cwd: dist });
  writeFileSync(join(out, names[1]), readFileSync(join(out, names[0])));
  const sums = names.map((name) => {
    const hash = createHash('sha256')
      .update(readFileSync(join(out, name)))
      .digest('hex');
    return `${hash}  ${name}`;
  });
  writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  console.log(`Packaged ${manifestVersion}:\n${sums.join('\n')}`);
} else {
  console.error('Usage: node tooling/release.mjs check [vX.Y.Z] | notes vX.Y.Z | package');
  process.exit(1);
}

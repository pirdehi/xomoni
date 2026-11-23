// Downloads a published release of the extension and unpacks it, for the release smoke test (#419,
// docs/RELEASING.md): the zip people install from GitHub, checked against the release's SHA256SUMS before it is opened.
//
//   node tooling/release-download.mjs vX.Y.Z <folder>
//
// `gh release download` fetches xomoni-extension-X.Y.Z.zip and SHA256SUMS from pirdehi/xomoni, or from GH_REPO when
// set. The zip must be listed in SHA256SUMS and match it; no entry may land outside the folder; the folder must hold
// no link once unpacked; and its manifest must name X.Y.Z. The folder must be new or empty: nothing in it is
// overwritten. `gh` uses its own sign-in, so no token goes on a command line. Node's built-ins, `gh` and `unzip` only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SUMS, parseSums } from './published-release-lib.mjs';
import { releaseZips, unsafeZipEntries, versionOfTag } from './release-lib.mjs';

/** Runs `command` with `args`, never through a shell, and returns what it printed. Throws when it fails. */
const run = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });

/** The first line of what a failed command said. */
const why = (error) =>
  String(error.stderr || error.message || error)
    .trim()
    .split('\n')[0];

/** Every path under `dir` that is a symbolic link, relative to it. */
function linksUnder(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (lstatSync(path).isSymbolicLink()) out.push(path.slice(base.length + 1));
    else if (entry.isDirectory()) linksUnder(path, base, out);
  }
  return out;
}

/** Downloads, checks and unpacks `tag` into `target`; throws with what went wrong, leaving `target` as it was. */
function download(tag, target) {
  const version = versionOfTag(tag);
  if (!version) throw new Error(`${tag ?? '(no tag)'} is not v<major>.<minor>.<patch>`);
  if (!target) throw new Error('Name the folder to unpack into');
  if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} is not empty`);
  const zip = releaseZips(version).versioned;
  const repo = process.env.GH_REPO || 'pirdehi/xomoni';
  const work = mkdtempSync(join(tmpdir(), 'xomoni-release-'));
  try {
    try {
      run('gh', ['release', 'download', tag, '--repo', repo, '--pattern', zip, '--pattern', SUMS, '--dir', work]);
    } catch (error) {
      throw new Error(`gh release download ${tag} failed: ${why(error)}`, { cause: error });
    }
    for (const name of [zip, SUMS]) if (!existsSync(join(work, name))) throw new Error(`${tag} has no ${name}`);

    const { sums, problems } = parseSums(readFileSync(join(work, SUMS), 'utf8'));
    if (problems.length) throw new Error(`${SUMS}: ${problems.join('; ')}`);
    const expected = sums.get(zip);
    if (!expected) throw new Error(`${SUMS} doesn't list ${zip}`);
    const actual = createHash('sha256')
      .update(readFileSync(join(work, zip)))
      .digest('hex');
    if (actual !== expected) throw new Error(`${zip} doesn't match ${SUMS}: ${actual}, not ${expected}`);

    const unsafe = unsafeZipEntries(
      run('unzip', ['-Z1', join(work, zip)])
        .split('\n')
        .filter(Boolean),
    );
    if (unsafe.length) throw new Error(`${zip} has entries outside its folder: ${unsafe.join(', ')}`);
    const unpacked = join(work, 'unpacked');
    run('unzip', ['-q', join(work, zip), '-d', unpacked]);
    const links = linksUnder(unpacked);
    if (links.length) throw new Error(`${zip} has links: ${links.join(', ')}`);
    const manifest = join(unpacked, 'manifest.json');
    if (!existsSync(manifest)) throw new Error(`${zip} has no manifest.json at its root`);
    const said = JSON.parse(readFileSync(manifest, 'utf8')).version;
    if (said !== version) throw new Error(`${zip}'s manifest says ${String(said)}, not ${version}`);

    cpSync(unpacked, target, { recursive: true });
    return { version, sha256: actual };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const [tag, folder] = process.argv.slice(2);
try {
  const target = folder ? resolve(folder) : '';
  const { version, sha256 } = download(tag, target);
  console.info(`Xomoni ${version} in ${target} (${releaseZips(version).versioned}, sha256 ${sha256})`);
} catch (error) {
  console.error(`release-download: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

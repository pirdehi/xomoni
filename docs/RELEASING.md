# Releasing

A release ships the extension as a zip on [GitHub Releases](https://github.com/pirdehi/xomoni/releases). The website deploys from `main` on its own and needs no release.

## Steps

1. On a branch, set the same version in `apps/extension/public/manifest.json` and `apps/extension/package.json` ([Semantic Versioning](https://semver.org/)).
2. In [`CHANGELOG.md`](../CHANGELOG.md), rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and start a new empty `## [Unreleased]` above it.
3. Run `node tooling/release.mjs check vX.Y.Z`, then open a pull request and merge it when CI is green.
4. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag -s vX.Y.Z -m "Xomoni X.Y.Z"
   git push origin vX.Y.Z
   ```

5. The [release workflow](../.github/workflows/release.yml) runs in two jobs (#142):
   - **build**, with a read-only token and no token left in the checkout:
     - checks that the tag points at a commit on `main`;
     - runs `npm run verify`;
     - checks the versions against the tag;
     - builds the extension and packages it reproducibly.
   - **publish**, which runs no npm code:
     - signs the zips with [build provenance](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) (SLSA);
     - creates the release, with the changelog section as notes.

   It attaches:
   - `xomoni-extension.zip`: the same name in every release, so `https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip` always serves the newest one (the website's install page links there);
   - `xomoni-extension-X.Y.Z.zip`: the same file, named for its version;
   - `SHA256SUMS`: the SHA-256 of both, to check a download.

6. Record the release, so connected browsers show that it is out (#151): add a migration that inserts it into `public.extension_releases`, with `security` true when it fixes a vulnerability, merge it, then run `supabase db push`.

   ```sql
   -- Release X.Y.Z, for the update notice in connected browsers (#151).
   insert into public.extension_releases (version, published_at, security) values ('X.Y.Z', 'YYYY-MM-DD', false);
   ```

   A zip install never updates by itself, so this notice, together with the release notes, is how people hear about a fix until the Chrome Web Store ships updates (#43).

## Checking a download

- **Checksum:** `shasum -a 256 -c SHA256SUMS` next to the zip. `SHA256SUMS` comes from the same release, so this only catches a broken download.
- **Provenance:** `gh attestation verify xomoni-extension.zip --repo pirdehi/xomoni` checks that GitHub Actions built this exact file from this repository's release workflow, and from which commit.
- **Rebuild:** the zip is reproducible. Its files are sorted, dated with the tagged commit's time in UTC and readable by all, with no extra attributes. Rebuild it in the release's environment (Linux, Node 22) and compare the checksum:

  ```bash
  git switch --detach vX.Y.Z && npm ci && npm run build -w @xomoni/extension
  SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" node tooling/release.mjs package
  ```

## Repository settings that protect releases

Set on GitHub, not in code (#142):
- **Actions:** every action is pinned by full commit SHA. GitHub requires this, and `tooling/workflows.test.mjs` checks it. Only GitHub's own actions and `supabase/setup-cli` may run. Dependabot keeps the pins current.
- **Tags:** a ruleset on `v*` lets only maintainers create tags, and nobody move or delete one.
- **Releases** are immutable once published.
- **`main`:** branches up to date before merging, and the `verify`, `database` and `e2e` checks. GitHub signs the squash merges it makes.
- **Not yet: signed commits.** GitHub refuses to merge a pull request whose own commits are unsigned, even as a squash. So the rule waits until the maintainer signs commits (an SSH signing key added to GitHub, and `git config commit.gpgsign true` with `gpg.format ssh`). It was turned on with #142 and taken back off the same day.
- **Workflows from forks:** need approval for every outside contributor.

## Checked on every pull request

CI builds the extension and runs `node tooling/release.mjs check` and `node tooling/release.mjs package`, so a broken build or packaging step shows up before anyone tags. The helpers are tested by `tooling/release.test.mjs` (reproducible zips included), and the workflows by `tooling/workflows.test.mjs`: actions pinned by SHA, no token left in a checkout, no write access by default, and a release build that can't write. Both run with `node --test 'tooling/*.test.mjs'`, part of `npm run verify`.

## Chrome Web Store

Not yet: the maintainer put the store listing off for now ([#43](https://github.com/pirdehi/xomoni/issues/43)). When it comes, the same `xomoni-extension-X.Y.Z.zip` is what gets uploaded.

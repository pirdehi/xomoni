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

5. The [release workflow](../.github/workflows/release.yml) runs `npm run verify`, builds the extension, checks the versions against the tag, packages it and creates the release with the changelog section as notes. It attaches:
   - `xomoni-extension.zip`: the same name in every release, so `https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip` always serves the newest one (the website's install page links there);
   - `xomoni-extension-X.Y.Z.zip`: the same file, named for its version;
   - `SHA256SUMS`: the SHA-256 of both, to check a download.

## Checked on every pull request

CI builds the extension and runs `node tooling/release.mjs check` and `node tooling/release.mjs package`, so a broken build or packaging step shows up before anyone tags. The helpers are tested by `tooling/release.test.mjs` (`node --test tooling/`, part of `npm run verify`).

## Chrome Web Store

Not yet: the maintainer put the store listing off for now ([#43](https://github.com/pirdehi/xomoni/issues/43)). When it comes, the same `xomoni-extension-X.Y.Z.zip` is what gets uploaded.

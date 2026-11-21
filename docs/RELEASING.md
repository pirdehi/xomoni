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
     - builds the extension, checks that it has no remotely hosted code (#301), and packages it reproducibly.
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

CI builds the extension and runs `node tooling/release.mjs check` and `node tooling/release.mjs package`, so a broken build or packaging step shows up before anyone tags. `npm run verify` builds it too and runs `node tooling/check-remote-code.mjs` on the build, which fails on code from a string or from another site, which the stores refuse (#301). The helpers are tested by `tooling/release.test.mjs` (reproducible zips included), and the workflows by `tooling/workflows.test.mjs`: actions pinned by SHA, no token left in a checkout, no write access by default, and a release build that can't write. Both run with `node --test 'tooling/*.test.mjs'`, part of `npm run verify`.

## The fixed id: the Chrome Web Store's key (#302)

Chrome gives an unpacked extension an id made from its folder, unless its manifest carries a `key`. With the Chrome Web Store item's public key there, a zip install has the store's id, and xomoni.com finds Xomoni by that id without being told ([ADR-0024](adr/0024-connect-a-browser-with-one-click.md), [ADR-0025](adr/0025-one-sign-in-for-the-website-and-the-extension.md), amended for #302). The key and the id go in together, in one pull request:

1. In the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole), open Xomoni's item. A draft that was never published is enough: upload the release zip once, without submitting it.
2. **The id:** the item's 32 letters, at the top of its page and in its address. Write it in [`packages/bridge/src/extension-ids.ts`](../packages/bridge/src/extension-ids.ts): `chrome: '<id>',` in `STORE_EXTENSION_IDS`.
3. **The key:** *Package* › *View public key*. Copy what is between `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC KEY-----`, remove the newlines, and add it to [`apps/extension/public/manifest.json`](../apps/extension/public/manifest.json) as `"key": "<one line>"`. It is a public key, not a secret; the private key stays with Google.
4. Check: `npx vitest run tests/manifest-key.test.ts` in `apps/extension`. It fails unless the key is base64 of an RSA public key and gives exactly that id, and it names the id the key gives. To check by hand:

   ```bash
   echo '<one-line key>' | base64 -d | openssl dgst -sha256 | awk '{print $NF}' | cut -c1-32 | tr 0-9a-f a-p
   ```

5. **Edge Add-ons** assigns an id of its own, which isn't derived from the key. Once the item exists in Partner Center, write its id as `edge` in the same file. No key goes with it.

The id written there is all the website needs: it then asks that id on every page. Nothing else changes until it is written.

**The order matters** (the comment on #302). A new id is another extension to Chrome, with an empty database (ADR-0032):
1. Release 0.5.0 **without** the key, with *Export everything* and *Import from a file*. Zip users replace the same folder: same id, same data.
2. People export from 0.5.0 (*Settings › Move your data*).
3. Release the next version **with** the key and the Chrome id. Loaded from a new folder it has the new id, and its first run offers the import.

**Open question, for the first upload (phase 5):** some developers report that the store refuses a new item's zip whose manifest has a `key` (*key field is not allowed in manifest*). If it does, upload a copy of the zip without the key; the item keeps its id either way, and the GitHub zip keeps the key.

## Chrome Web Store

Not submitted yet ([#43](https://github.com/pirdehi/xomoni/issues/43), [#301](https://github.com/pirdehi/xomoni/issues/301)). The same `xomoni-extension-X.Y.Z.zip` is what gets uploaded, to the Chrome Web Store and to Microsoft Edge Add-ons. Everything else the stores ask for is in [the store listing](STORE-LISTING.md):
- the permission justifications and the privacy answers;
- the listing text and the notes for reviewers;
- the images, made by `npm run store:images -w @xomoni/extension`.

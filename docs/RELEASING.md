# Releasing

A release ships the extension as a zip on [GitHub Releases](https://github.com/pirdehi/xomoni/releases), then sends that same zip to the Chrome Web Store and Microsoft Edge Add-ons ([stores](#stores)). The website deploys from `main` on its own and needs no release.

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
     - installs with `npm ci --ignore-scripts`, so no dependency's install script runs where the release is built (#305);
     - runs `npm run verify`;
     - checks the versions against the tag;
     - builds the extension, checks that it has no remotely hosted code (#301), and packages it reproducibly.
   - **publish**, which runs no npm code and is the only job that sees the signing key (#305, [ADR-0033](adr/0033-one-click-updates-for-the-zip-install.md)). It waits for your approval, as the `release` environment's required reviewer:
     - signs each zip with the release signing key (Ed25519, with OpenSSL only), after checking that the release trusts that key, and checks each signature. While the extension trusts no key, it skips signing with a warning instead (see *Signing key*);
     - signs the zips with [build provenance](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) (SLSA);
     - creates the release, with the changelog section as notes.

   It attaches:
   - `xomoni-extension.zip`: the same name in every release, so `https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip` always serves the newest one (the website's install page links there);
   - `xomoni-extension-X.Y.Z.zip`: the same file, named for its version;
   - `xomoni-extension.zip.sig` and `xomoni-extension-X.Y.Z.zip.sig`: the Ed25519 signature of each, 64 bytes, which a zip install checks before *Update now* writes anything. Not there while the extension trusts no key;
   - `SHA256SUMS`: the SHA-256 of both zips, to check a download.

6. Record the release, so connected browsers show that it is out (#151): add a migration that inserts it into `public.extension_releases`, with `security` true when it fixes a vulnerability, merge it, then run `supabase db push`.

   ```sql
   -- Release X.Y.Z, for the update notice in connected browsers (#151).
   insert into public.extension_releases (version, published_at, security) values ('X.Y.Z', 'YYYY-MM-DD', false);
   ```

   A zip install never updates by itself, so this notice, together with the release notes, is how people hear about a fix. Installed from a store, Xomoni updates itself ([ADR-0034](adr/0034-distribution-through-the-browsers-stores.md)).

7. Send the release to the stores (#303), once it is on GitHub Releases:
   1. In **Actions → Stores → Run workflow**, from `main`: the tag, the store (`both`, `chrome` or `edge`) and **upload**. Approve the run when the `stores` environment asks. The zip becomes each store's draft; nothing goes to review yet.
   2. Look at the drafts in the [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole) and in [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview): the version, and the listing if it needs a change.
   3. Run it again with **publish**. Each draft goes to review and goes live once approved, with the visibility set in the store (unlisted at first).

## Signing key

Releases are signed for one-click updates of a zip install (#305, [ADR-0033](adr/0033-one-click-updates-for-the-zip-install.md)).

- **While `apps/extension/src/update/release-keys.json` trusts no key**, a release goes out unsigned. The signing step and `node tooling/release.mjs check` say so with a warning. No Xomoni can update to it in one click, so zip installs update by hand, as before.
- **Once it trusts a key, signing is required:** the release fails without the `RELEASE_SIGNING_KEY` secret, or with a key that isn't in the list.

### Once, before the first signed release

On your own computer, with OpenSSL 3 (`brew install openssl@3` on macOS; macOS's own `openssl` is LibreSSL and can't do this):

1. Make the key pair. The private key never goes into the repository.

   ```bash
   openssl genpkey -algorithm ed25519 -out xomoni-release-signing.pem
   ```

2. Make the `release` environment, which only the release workflow's `publish` job uses: *Settings › Environments › New environment*, named `release`. Both of these are required:
   - **Required reviewers:** add yourself. Every release then waits for your approval before anything is signed. Approve only after checking that the tag is the commit you meant to release, on `main`.
   - **Deployment branches and tags:** choose *Selected branches and tags* and add the tag rule `v*`.
3. Add the private key as that environment's secret:

   ```bash
   gh secret set RELEASE_SIGNING_KEY --env release --repo pirdehi/xomoni < xomoni-release-signing.pem
   ```
4. Print the public key as the extension keeps it: base64 of its 32 raw bytes.

   ```bash
   openssl pkey -in xomoni-release-signing.pem -pubout -outform DER | tail -c 32 | base64
   ```

   Put it in `apps/extension/src/update/release-keys.json` (`{"keys": ["…"]}`), commit it in a pull request, and merge it before you tag.
5. Keep `xomoni-release-signing.pem` offline, for example in your password manager, and delete the file. Anyone with it can sign a release that every zip install with one-click updates would accept.

### What the key's protection rests on

The signing key follows a tag, not reviewed code. A tag runs the release workflow as it is at the tagged commit. The build job checks that the commit is on `main`, but someone who can push a tag can push one on a commit whose workflow skips that check: no step of a workflow a tag starts can be made impossible to skip. What GitHub enforces, whatever the workflow says, is the `release` environment's protection:
- the required reviewer, which is why step 2 is required;
- the `v*` tag rule.

Beyond that, the key's safety rests on the tag ruleset, on who has write access to the repository, and on the key staying offline. ADR-0033 says what this leaves open.

### Replacing the key

1. Make a new pair as above.
2. Add its public key to `release-keys.json` beside the old one, and release that version, still signed with the old key.
3. Once that release is out, set the secret to the new key, and remove the old public key in the next release.

A Xomoni only accepts releases signed with a key it already trusts. A lost key can't be replaced this way: zip installs then update by hand once, to a version that trusts the new key. A leaked key: remove it from `release-keys.json` and release at once, signed with a new key, as a security release, so the dashboard's notice can't be dismissed. Zip installs then update by hand once too.

## Checking a download

- **Checksum:** `shasum -a 256 -c SHA256SUMS` next to the zip. `SHA256SUMS` comes from the same release, so this only catches a broken download.
- **Signature:** what *Update now* checks. With the public key from `release-keys.json` (base64 of the raw key) and OpenSSL 3:

  ```bash
  (printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00'; echo 'THE_KEY_IN_BASE64' | base64 -d) > release.der
  openssl pkey -pubin -inform DER -in release.der -out release.pub
  openssl pkeyutl -verify -pubin -inkey release.pub -rawin -in xomoni-extension.zip -sigfile xomoni-extension.zip.sig
  ```
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
- **The `release` environment** (#305): the maintainer as required reviewer, and only `v*` tags may deploy to it. Its secret `RELEASE_SIGNING_KEY` signs releases for one-click updates (*Signing key* above).
- **`main`:** branches up to date before merging, and the `verify`, `database` and `e2e` checks. GitHub signs the squash merges it makes.
- **Not yet: signed commits.** GitHub refuses to merge a pull request whose own commits are unsigned, even as a squash. So the rule waits until the maintainer signs commits (an SSH signing key added to GitHub, and `git config commit.gpgsign true` with `gpg.format ssh`). It was turned on with #142 and taken back off the same day.
- **Workflows from forks:** need approval for every outside contributor.
- **Environment `stores`** (#303): holds the store keys, which only runs from `main` can read, after the maintainer approves ([below](#the-stores-environment)).

## Checked on every pull request

CI builds the extension and runs `node tooling/release.mjs check` and `node tooling/release.mjs package`, so a broken build or packaging step shows up before anyone tags. `npm run verify` builds it too and runs `node tooling/check-remote-code.mjs` on the build, which fails on code from a string or from another site, which the stores refuse (#301). The helpers are tested by `tooling/release.test.mjs` (reproducible zips included), and the store calls by `tooling/store-api.test.mjs`, against a fake network. The workflows are tested by `tooling/workflows.test.mjs`: actions pinned by SHA and only from GitHub or `supabase/setup-cli`, no token left in a checkout, no input pasted into a script, no write access by default, a release build that can't write, the signing step, run with a throwaway key, whose signatures the extension's check accepts, and a store workflow that never builds and keeps each store's keys in the `stores` environment. Signing is skipped with a warning while no key is trusted, and refused once one is, without the secret or with another key. The step that creates the release attaches the signatures only when there are some, and the build installs without install scripts. They run with `node --test 'tooling/*.test.mjs'`, part of `npm run verify`.

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

## Chrome Web Store and Edge Add-ons

The stores are to be the main way to install ([ADR-0034](adr/0034-distribution-through-the-browsers-stores.md)): the Chrome Web Store (Unlisted at first) and Edge Add-ons (Hidden at first), and GitHub Releases keep the zip for anyone who installs it by hand. Not submitted yet ([#43](https://github.com/pirdehi/xomoni/issues/43), [#301](https://github.com/pirdehi/xomoni/issues/301)). A store updates Xomoni itself, so what gets uploaded, to the Chrome Web Store and to Microsoft Edge Add-ons, is the store build, without the one-click updater (#305, [ADR-0033](adr/0033-one-click-updates-for-the-zip-install.md)), not the zip on GitHub Releases:

```bash
npm run build:store -w @xomoni/extension   # → apps/extension/dist, without src/update/, its GitHub access and CSP sources
```

`tooling/store-build.test.mjs`, part of `npm run verify`, builds it and checks both. Everything else the stores ask for is in [the store listing](STORE-LISTING.md):
- the permission justifications and the privacy answers;
- the listing text and the notes for reviewers;
- the images, made by `npm run store:images -w @xomoni/extension`.

The [store workflow](../.github/workflows/store.yml) (#303) sends a release that is already on GitHub to the Chrome Web Store and Microsoft Edge Add-ons. It runs only by hand, from `main`, one run at a time:

| Input | What it takes |
| --- | --- |
| `tag` | `vX.Y.Z`: a release already on GitHub Releases. |
| `store` | `both`, `chrome` or `edge`. |
| `action` | `upload`: the zip becomes the store's draft. `publish`: the draft goes to review, and live once approved. |
| `percentage` | Chrome, `publish` only, optional: the share of users who get the update, 1 to 100; empty means everyone. The store allows it only for items with more than 10,000 weekly users. Raise it later in the dashboard. |

What it does:
- **release**, read-only and without any store key: checks that it runs from `main` for a `vX.Y.Z` tag and that the release exists. For `upload`, it downloads `xomoni-extension-X.Y.Z.zip` and `SHA256SUMS` from that release, checks the checksum, and checks the build provenance with `gh attestation verify --signer-workflow …/release.yml --source-ref refs/tags/vX.Y.Z`. Only a zip that the release workflow built from that tag goes on. It never builds one.
- **chrome** and **edge**, in the `stores` environment, each with only its own store's keys: check the checksum again and run `node tooling/store.mjs`. The calls live in [`tooling/store-api.mjs`](../tooling/store-api.mjs), with Node's own `fetch` and no dependency.
  - Chrome Web Store, [API v2](https://developer.chrome.com/docs/webstore/using-api) (v1.1 was supported until 2026-10-15): trades the refresh token for a one-hour access token, hidden in the log; uploads the zip to the item and checks that the store read the tag's version. `publish` submits the draft for review with the visibility set in the dashboard, then reads which version went to review: when it isn't the tag's, it cancels the submission and fails.
  - Microsoft Edge Add-ons, [API v1.1](https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api): uploads the zip to the draft submission, or submits the draft with notes that link the release notes, and follows each operation until it ends. Edge's answers don't name the version, so look at the draft in Partner Center before `publish`.
- A failure names the missing secret or quotes the store's answer on one line, never a key or a token. A store that is still busy after 10 minutes stops the run; check its dashboard before running again.

Neither API can create an item or change its visibility. The first package, the listing and **Unlisted** or **Public** are set by hand in each store. If the visibility changes in the Chrome dashboard, publish once there by hand before the API can publish again.

### The `stores` environment

Create it before the first run, in **Settings → Environments → New environment**, named `stores`. A run that names a missing environment creates one without any protection.
- **Deployment branches and tags:** *Selected branches and tags*, with `main` only, so no other branch's copy of the workflow can read the keys.
- **Required reviewers** (recommended): yourself, with *Prevent self-review* off. Every run then waits for your approval before a store key is read.
- **Environment secrets:** the eight below. Not repository secrets: any workflow could read those.

### Chrome Web Store keys

API v2 takes an OAuth client with a refresh token, or a service account. Xomoni uses the OAuth client: a service account would need its JSON private key in the secrets, which Google warns about, or Workload Identity Federation through an action the repository doesn't allow.

1. In the [Google Cloud console](https://console.cloud.google.com/), signed in with your personal Google account, create a project (for example `xomoni-store`) and enable the **Chrome Web Store API**.
2. **OAuth consent screen:** user type **External**; app name `Xomoni store upload`; your email as support and developer contact; yourself as a test user. Then publish the app (**Audience → Publish app**, *In production*): an app left in *Testing* gets refresh tokens that expire after 7 days ([Google](https://developers.google.com/identity/protocols/oauth2#expiration)). Google's verification isn't needed for your own use; the sign-in page warns that the app isn't verified, and you continue under *Advanced*.
3. **Credentials → Create credentials → OAuth client ID**, type **Web application**, with the authorized redirect URI `https://developers.google.com/oauthplayground`. Its client ID is `CWS_CLIENT_ID`, its client secret `CWS_CLIENT_SECRET`.
4. In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground): the gear → **Use your own OAuth credentials**, with that client; the scope `https://www.googleapis.com/auth/chromewebstore`; **Authorize APIs** with the Google account that owns the item; **Exchange authorization code for tokens**. The refresh token is `CWS_REFRESH_TOKEN`.
5. `CWS_PUBLISHER_ID`: in the [developer dashboard](https://chrome.google.com/webstore/devconsole), the publisher's **Settings** page.
6. `CWS_ITEM_ID`: the item's 32-letter ID, on its **Package** page; the same as Xomoni's ID in `chrome://extensions`.

A refresh token stops working when it is revoked, unused for six months, or its client secret changes. The log then says `invalid_grant`: repeat step 4 and update the secret. Steps from [Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api).

### Edge Add-ons keys

1. In [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/public/login?ref=dd): **Microsoft Edge → Publish API**, **Enable** the new experience (API v1.1), then **Create API credentials**. The **Client ID** is `EDGE_CLIENT_ID`, the **API key** `EDGE_API_KEY`.
2. `EDGE_PRODUCT_ID`: **Microsoft Edge → Overview**, then Xomoni; the **Extension identity** section shows its Product ID, a GUID that is also in the address bar between `microsoftedge/` and `/packages`. It isn't the extension's ID in the browser.
3. API keys expire: the Publish API page shows the date, Partner Center emails before it, and Microsoft's [announcement](https://blogs.windows.com/msedgedev/2024/09/30/enhanced-security-for-extensions-with-new-publish-api/) gives 72 days. A run that fails with HTTP 401 usually means a lapsed key: create a new one and update `EDGE_API_KEY`.

Steps from [Use the REST API to update an extension](https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api).

### Turning on the install button

Nothing on xomoni.com or in Xomoni mentions a store until its listing is published. Then:

1. Copy the listing's public address:
   - Chrome Web Store: the developer dashboard's link to the item, `https://chromewebstore.google.com/detail/<name>/<id>`;
   - Edge Add-ons: Partner Center's link to the listing, `https://microsoftedge.microsoft.com/addons/detail/<name>/<id>`.
2. Set it in both apps, in one pull request: `CHROME_WEB_STORE_URL` or `EDGE_ADDONS_URL` in `apps/web/src/shared/config/store-listings.ts` and in `apps/extension/src/shared/store-listings.ts`.
3. `npm run verify` checks it: each value must be an https page on its store's own host (`apps/web/src/shared/config/store-listings.test.ts`), and `apps/extension/tests/store-listings.test.ts` fails when the two apps differ.

Once merged, xomoni.com/install shows the store's button for the browsers that store serves, with the zip guide under *Advanced: install from a zip*, and explains the move at `/install#move-to-store`. The extension's card that invites a zip install to move (export, remove, install from the store, import) ships with the next release. Set the address only once the listing opens for people with the link, since the button leads straight to it.

### Counting installs

Only the stores' own install counts (install project, task 8.4). xomoni.com and Xomoni add no analytics, no campaign parameters on the store links and no install ping.

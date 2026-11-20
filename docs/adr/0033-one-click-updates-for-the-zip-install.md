# ADR-0033: One-click updates for the zip install: signed releases, written into Xomoni's own folder

- Status: Accepted
- Date: 2026-11-21

## Context

Xomoni is installed from a zip with *Load unpacked*. Chrome never updates such an extension. To update, the person downloads the new zip, replaces the folder's files by hand and presses reload on `chrome://extensions`. Many don't, so fixes, safety ones included, reach them late. The dashboard already says when a newer version is out (#151), from xomoni.com's answer to its status report.

The store versions will update themselves (#43, phases 3 to 5 of the install project), but a store may refuse Xomoni or take weeks, and the zip stays for those who prefer it.

An extension can't reload new code from anywhere but its folder, and Manifest V3 forbids running code it didn't ship. But a person can let a page write to a folder they pick (File System Access), and Chrome 122 and later can keep that permission (*Allow on every visit*). A Xomoni that writes a new release into the folder Chrome loads it from, then calls `chrome.runtime.reload()`, runs the new version with the same id and the same IndexedDB.

That makes the release itself the thing to protect. Whoever can make Xomoni write a file into its folder runs code with all of Xomoni's access to the person's X account the next time Chrome loads it.

## Decision

1. **Releases are signed with Ed25519, and only by the release workflow.**
   - The private key exists only as the `RELEASE_SIGNING_KEY` secret of the `release` environment, which only `v*` tags can use. It is never in the repository, and the PR that added this carried no key.
   - The workflow's `publish` job runs no npm code (#142). Its signing step uses only OpenSSL. It writes the key to a file only its user can read, removes it when the step ends and never prints it.
   - It signs the bytes of each zip (`pkeyutl -sign -rawin`) and checks each signature before it attaches `xomoni-extension.zip.sig` and `xomoni-extension-X.Y.Z.zip.sig` to the release.
   - It refuses to sign with a key the release doesn't trust itself (`release/release-keys`, written from `release-keys.json` by the build job), and `node tooling/release.mjs check vX.Y.Z` refuses a tag while no key is trusted. Every release can therefore be checked by the Xomoni it makes.
   - A missing secret fails the release. One-click updates rely on every release being signed, so an unsigned one never ships.
2. **The extension trusts the public keys in `apps/extension/src/update/release-keys.json`**, base64 of the 32 raw bytes. A new key is added beside the old one in one release, which is still signed with the old key, and the old one is removed after (docs/RELEASING.md). A lost key can't be replaced this way: zip installs then update by hand once.
3. **The check is the browser's own Ed25519** (Web Crypto, Chrome 137 and later). Xomoni carries no signature code of its own. On an older browser, one-click updates say why they can't work and the download link stays; `minimum_chrome_version` stays 116. A hand-written verifier for those browsers would be the riskiest code in Xomoni, for a few people whose Chrome updates itself anyway.
4. **What is checked, all before the first write** (`update/update.ts`):
   - Xomoni was loaded unpacked (`chrome.management.getSelf`), the version is newer than the one running, and no job runs.
   - The folder still holds this Xomoni at this version.
   - The zip and its signature come only from `https://github.com/pirdehi/xomoni/releases/download/vX.Y.Z/`, through GitHub's redirect to `release-assets.githubusercontent.com`. The manifest's CSP lets extension pages connect to those two places only, beside Xomoni's API, and the host access to them is optional: Chrome asks the person on their first click, never on install. No cookie or referrer is sent. A download is at most 32 MB.
   - The signature is over exactly the zip's bytes, under a trusted key. A missing signature, a wrong one, another key or a browser error stops the update.
   - Every path in the zip stays inside the folder: relative, `/`-separated, no `..`, no absolute or drive path, no backslash, no hidden or device name, at most six levels and 200 characters. No two paths may differ only in case. Sizes and CRCs are checked, at most 1,000 files and 64 MB.
   - The zip's `manifest.json` is Manifest V3 and names exactly the release's version, so an older signed release can't be served as a newer one. The scripts it names are in the zip.
   - The zip's `key` must equal the folder's (both absent today). A new `key` makes Chrome load a different extension, with an empty database, so that update is refused and the person is pointed to *Move your data* (ADR-0032).
5. **The person picks Xomoni's folder once, and Xomoni checks it.** It must hold a `manifest.json` with this extension's name and the version Chrome runs, checked when picked and again before each update. The handle is kept in IndexedDB. Chrome asks for write access when the folder is picked, and again when it hasn't kept the permission. *Forget the folder* is in Settings › Updates.
6. **No update while a job runs.** The update refuses while the runner's Web Lock (`RUNNER_LOCK`) is held. It holds the lock itself while it writes, so no job can start then.
7. **All or nothing, with a rollback** (`update/write.ts`):
   - Every file the release replaces is read first, and kept in IndexedDB as a journal.
   - New files go first, replaced ones next, `manifest.json` last.
   - If a write fails, every file written so far gets its old bytes back, or is removed if it was new. The journal is forgotten once all of it is back.
   - If putting back fails too, or the tab closed in the middle, the dashboard shows *Put back X.Y.Z* until the journal's files are restored, then reloads.
   - Only after every write succeeded are the old version's leftovers removed, and only in `assets/`, the folder only Xomoni's build writes. A file the person keeps in the folder is never touched.
8. **Every update is in the activity log:** the versions, the signing key's start, the zip's SHA-256 (to compare with `SHA256SUMS`) and how many files were written. Failures about the release or the files are logged too, a bad signature as an error. After the reload, the service worker reopens the dashboard, only after such an update. The dashboard says the new version runs. If Chrome still runs the old one, the folder written to isn't the one Chrome loads Xomoni from: Xomoni says so, logs it and forgets that folder.
9. **The data is never touched.** The update writes only the extension's files. Chrome keeps the id, so IndexedDB, the settings and the xomoni.com connection stay as they were.

Built in [#305](https://github.com/pirdehi/xomoni/issues/305).

## Consequences

What can't happen:
- **Code from anywhere but this repository's releases.** It must be signed by the key in the release workflow's secret, and the CSP blocks every other host.
- **Rolling back to an older release.** The version must be newer, and the zip's manifest must say it.
- **A file outside the folder.** Paths are checked when the zip is read and again before each write, and File System Access can't leave the folder it was given.
- **An update in the middle of a job, or a half-written Xomoni.** The runner's lock keeps jobs out, and a failed write is undone.
- **Losing the data, or another id.**

Other consequences:
- Someone who holds the signing key and can publish a release on this repository can ship code to every zip install that presses *Update now*, as they could already through the zip people download by hand. The key's environment, the tag ruleset, immutable releases and the build provenance (#142) are what stand in their way.
- The maintainer generates the key pair once, adds the secret and commits the public key before the next release (docs/RELEASING.md). Until then releases fail, on purpose.
- Extension pages may connect to two GitHub hosts. A change of GitHub's asset host breaks one-click downloads until a release adds it; the manual download still works.
- The store versions carry this code too, but it never runs there (`chrome.management.getSelf` says `normal`, not `development`), and it asks for no host access unless the person clicks.
- Chrome before 137 has no one-click update. Chrome before 122 asks for the folder on each click.
- Things that need a real Chrome to confirm: that Chrome lets a page write `.js` files into an extension's folder on every system (Safe Browsing checks each file written), and that it reopens nothing by itself after `chrome.runtime.reload()`.

## Alternatives considered

- **A checksum file, without a signature.** `SHA256SUMS` comes from the same release as the zip, so whoever could change one could change both. It only catches a broken download.
- **GitHub's build provenance (Sigstore) checked in the extension.** It proves the workflow built the file, but checking it needs a Sigstore client and its certificates in the extension. That is far more code to trust than one Ed25519 key.
- **A pure-JavaScript Ed25519 for Chrome 116 to 136.** Hand-written signature code is easy to get subtly wrong, for very few people. The browser's own is audited.
- **Raising `minimum_chrome_version` to 137.** It would stop an older Chrome from loading Xomoni at all, for a feature that is optional.
- **Host permissions for GitHub in the manifest.** They would show a warning at every install, the store's included, for something many never use. Optional ones are asked for on the click.
- **Updating without asking, in the background.** The folder permission and Chrome's prompts need the person's click, and an update should never surprise someone in the middle of their work.
- **A native helper or a terminal command** (`curl … | unzip`). Both need more trust than a page writing into one folder the person picked, and the second teaches an unsafe habit.

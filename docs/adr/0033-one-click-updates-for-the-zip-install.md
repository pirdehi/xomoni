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
   - The private key exists only as the `RELEASE_SIGNING_KEY` secret of the `release` environment. It is never in the repository, and the PR that added this carried no key.
   - The environment's protection is set on GitHub, not in the workflow file: only `v*` tags may deploy to it, **and the maintainer is its required reviewer**, so every signing run waits for their approval (docs/RELEASING.md, *Signing key*). Both are required setup.
   - The workflow's `publish` job runs no npm code (#142). Its signing step uses only OpenSSL. It writes the key to a file only its user can read, removes it when the step ends and never prints it.
   - It signs the bytes of each zip (`pkeyutl -sign -rawin`) and checks each signature before it attaches `xomoni-extension.zip.sig` and `xomoni-extension-X.Y.Z.zip.sig` to the release.
   - **While the extension trusts no key** (`release-keys.json` empty), the release goes out unsigned, with a `::warning::` from the signing step and from `node tooling/release.mjs check`. No Xomoni can update to it in one click: a build that trusts no key never offers to. This keeps a release from waiting on the key's setup.
   - **Once the extension trusts a key, signing is required:** a missing secret fails the release, and so does a key the release doesn't trust itself (`release/release-keys`, written from `release-keys.json` by the build job). Every signed release can therefore be checked by the Xomoni it makes.
2. **The extension trusts the public keys in `apps/extension/src/update/release-keys.json`**, base64 of the 32 raw bytes. A new key is added beside the old one in one release, which is still signed with the old key, and the old one is removed after (docs/RELEASING.md). A lost key can't be replaced this way: zip installs then update by hand once.
3. **The check is the browser's own Ed25519** (Web Crypto, Chrome 137 and later). Xomoni carries no signature code of its own. On an older browser, one-click updates say why they can't work and the download link stays; `minimum_chrome_version` stays 116. A hand-written verifier for those browsers would be the riskiest code in Xomoni, for a few people whose Chrome updates itself anyway.
4. **What is checked, all before the first write** (`update/update.ts`):
   - Xomoni was loaded unpacked (`chrome.management.getSelf`), the version is newer than the one running, no job runs, and no earlier update's journal is kept (see 7).
   - The folder still holds this Xomoni at this version.
   - The zip and its signature come only from `https://github.com/pirdehi/xomoni/releases/download/vX.Y.Z/`, through GitHub's redirect to `release-assets.githubusercontent.com`.
     - The manifest's CSP lets extension pages connect to those two places only, beside Xomoni's API.
     - The host access to them is optional: Chrome asks the person on their click, never on install, and Xomoni gives it back as soon as the download is over.
     - A response from anywhere else, an empty URL included, is refused. No cookie or referrer is sent. A download is at most 32 MB.
   - The signature is over exactly the zip's bytes, under a trusted key. A missing signature, a wrong one, another key or a browser error stops the update.
   - Every path in the zip stays inside the folder: relative, `/`-separated, no `..`, no absolute or drive path, no backslash, no hidden or device name, at most six levels and 200 characters. No two paths may differ only in case. Sizes and CRCs are checked, at most 1,000 files and 64 MB.
   - The zip's `manifest.json` is Manifest V3 and names exactly the release's version, so an older signed release can't be served as a newer one. The scripts it names are in the zip.
   - The zip's `key` must equal the folder's (both absent today). A new `key` makes Chrome load a different extension, with an empty database, so that update is refused and the person is pointed to *Move your data* (ADR-0032).
   - **The zip's manifest may not ask for more than the folder's** (`update/manifest-access.ts`). Chrome shows what an extension asks for only when it is installed by hand, so a new version that asks for more is refused, and the person installs it by hand. Compared:
     - `permissions`, `optional_permissions`, `host_permissions` and `optional_host_permissions`;
     - the pages content scripts run on;
     - `externally_connectable` and `web_accessible_resources`;
     - each CSP directive's sources, after `default-src`;
     - leaving incognito's `not_allowed`.
   - **Its `minimum_chrome_version` may not be above the browser's major version**, or Chrome would refuse to load the new version after the reload. A value that can't be read counts as too high.
5. **The person picks Xomoni's folder once, and Xomoni checks it.** It must hold a `manifest.json` with this extension's name and the version Chrome runs, checked when picked and again before each update. The handle is kept in IndexedDB. Chrome asks for write access when the folder is picked, and again when it hasn't kept the permission. *Forget the folder* is in Settings › Updates.
6. **No update while a job runs.** The update refuses while the runner's Web Lock (`RUNNER_LOCK`) is held. It holds that lock and its own (`xomoni-update`) while it writes, and still holds them when it calls `chrome.runtime.reload()`, so no job and no other update can start in between. Under the locks it checks again that no journal is kept and that the folder still holds the version running, with the same manifest checks: another tab may have written meanwhile.
7. **All or nothing, with a rollback** (`update/write.ts`):
   - Every file the release replaces is read first, and kept in IndexedDB as a journal.
   - **A journal already kept is never written over.** It may be the only copy of the old files, so while one exists no update starts (`unfinished`), and *Put back* comes first.
   - New files go first, replaced ones next, `manifest.json` last.
   - If a write fails, every file written so far gets its old bytes back, or is removed if it was new. The journal is forgotten once all of it is back.
   - If putting back fails too, or the tab closed in the middle, the dashboard shows *Put back X.Y.Z*. It doesn't while an update holds `xomoni-update`: then the journal is a write under way.
   - **Put back only where it applies.** It runs only while Xomoni still runs the version the journal replaced, and the folder holds that version or the one being written. A journal for anything else is forgotten, with a line in the log saying why:
     - Xomoni runs the new version: the update finished, and only forgetting its journal failed.
     - Xomoni or the folder holds a third version: putting it back would mix versions.

     The dashboard does the same after each reload.
   - Once every file is written, a journal that can't be forgotten is no failure: the update goes on, and the next dashboard finds it stale.
   - **Leftovers:** after every write succeeded, the old version's files that the new one doesn't have are removed. Only files in `assets/` count, the folder only Xomoni's build writes, and only those the previous one-click update wrote: each update keeps the list of files it wrote. After a version installed by hand, nothing is removed. A file the person keeps in the folder is never touched.
   - *Delete local data* keeps the journal, the folder and that list. They hold no X content, and wiping them could strand a half-written Xomoni.
8. **Every update is in the activity log:** the versions, the signing key's start, the zip's SHA-256 (to compare with `SHA256SUMS`) and how many files were written. Failures about the release or the files are logged too, a bad signature as an error.
   - After the reload, the service worker reopens the dashboard, only after such an update, and the dashboard says the new version runs.
   - If Chrome still runs the old one, the folder written to isn't the one Chrome loads Xomoni from: Xomoni says so, logs it and forgets that folder.
9. **The data is never touched.** The update writes only the extension's files. Chrome keeps the id, so IndexedDB, the settings and the xomoni.com connection stay as they were.
10. **A store build has no updater.** A store updates Xomoni itself, and may refuse code that downloads extension code and writes it. `npm run build:store` (`vite build --mode store`) puts a stand-in that shows nothing in place of `OneClickUpdate.tsx`, so nothing imports `src/update/`. It also removes the GitHub host access and CSP sources from the manifest. `tooling/store-build.test.mjs` builds it and checks the manifest and that none of the updater's code is in the bundle. The zip on GitHub Releases is the default build, with the updater. Each release also attaches the store build, unsigned, as `xomoni-extension-store-X.Y.Z.zip`, which is what the store workflow sends to the stores (#303).
11. **The release is built without install scripts.** The build job runs `npm ci --ignore-scripts`, so no dependency's install script runs where the release is built. Only esbuild has one, and esbuild and Vite build without it (checked with the locked versions). The repository's own `prepare`, which installs git hooks, has no place there either.

Built in [#305](https://github.com/pirdehi/xomoni/issues/305).

## Consequences

What can't happen:
- **Code from anywhere but this repository's signed releases.** It must be signed by the key in the release environment's secret, and the CSP blocks every other host.
- **More access than the person granted.** A release that asks for more permissions, hosts, pages or a looser policy can't be installed in one click.
- **Rolling back to an older release.** The version must be newer, and the zip's manifest must say it.
- **A file outside the folder.** Paths are checked when the zip is read and again before each write, and File System Access can't leave the folder it was given.
- **An update in the middle of a job, a half-written Xomoni, or a lost backup.** The runner's lock keeps jobs out, a failed write is undone, and a kept journal is never written over.
- **Losing the data, or another id.**

What still can, said plainly:
- **The signing key follows the tag, not the reviewed code.** A tag starts the release workflow as it is at the tagged commit. Its build job checks that the commit is on `main`, but a person who can push a tag can push one on a commit whose workflow skips that check: no step a tag-pushed workflow runs can be made unskippable. So the control is GitHub's, not the workflow's:
  - the `release` environment's required reviewer (the maintainer), who approves each signing run and should look at what was tagged;
  - its `v*` tag rule;
  - the tag ruleset;
  - who has write access to the repository.

  Without the required reviewer, anyone who can push a `v*` tag can have a release signed. Someone who holds the key, or gets a run approved, can ship code to every zip install that presses *Update now*, as they already could through the zip people download by hand.
- **The build trusts its dependencies' code.** `--ignore-scripts` keeps their install scripts from running, but the build still runs the code of Vite, esbuild, React and the rest, pinned by `package-lock.json`. A compromised version of one of them, merged by mistake, would be in the release. Dependabot, the lockfile and review of each update are what stand in the way.
- **One-click updates wait on the key's setup.** Until the maintainer adds the first key, releases go out unsigned and every zip install updates by hand.
- **The first one-click update leaves the hand-installed version's old assets** in `assets/`, a few unused kilobytes, since Xomoni never wrote them.
- Extension pages may connect to two GitHub hosts. A change of GitHub's asset host breaks one-click downloads until a release adds it; the manual download still works.
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
- **Relying on the workflow to sign only commits on `main`.** It already checks, but the check lives in the workflow the tag runs, so it holds only against mistakes. The environment's required reviewer is enforced by GitHub whatever the workflow says.
- **Failing every release until a key exists.** Safer in principle, but it would hold release 0.5.0 on the key's setup for nothing: a build that trusts no key can't update in one click anyway, so an unsigned release gives no one a way in.
- **Installing a release that asks for more access, with a warning in the dashboard.** The dashboard's words are not Chrome's prompt, and a person clicking *Update now* expects the same Xomoni. Installing by hand shows Chrome's own list.
- **Removing every file in `assets/` the new version doesn't have.** Simpler, but a file the person put there would go too. Only files Xomoni itself wrote are its to remove.

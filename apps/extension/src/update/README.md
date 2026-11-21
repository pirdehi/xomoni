# `update/`: one-click updates of a zip install

A Xomoni loaded from the zip (*Load unpacked*) can't update itself the way a store install does. This area lets it, on the person's click, with every check done before anything is written ([ADR-0033](../../../../docs/adr/0033-one-click-updates-for-the-zip-install.md), #305):

1. **Once, Xomoni's own folder.** The person picks the folder they loaded Xomoni from, in the browser's folder picker with read and write access (File System Access). Xomoni keeps it only if its `manifest.json` names this extension at the version Chrome runs. Chrome 122 and later can keep the permission (*Allow on every visit*); otherwise it asks again on the next click.
2. **On *Update now*, only while no job runs** (the runner's Web Lock, `RUNNER_LOCK`) **and no earlier update is left unfinished**, Xomoni:
   - downloads the release's zip and its signature from this repository's GitHub releases, and nowhere else, then gives back its access to GitHub;
   - checks the Ed25519 signature with the browser's own Web Crypto against the keys this build trusts (`release-keys.json`);
   - reads every file of the zip and checks its path, its size and that the manifest is this version's, asks for no more access than the version running and no newer browser than this one;
   - under the runner's lock and its own (`xomoni-update`), checks the folder and the journal again, then writes it all into the folder, or none of it;
   - writes the update to the activity log and reloads itself, still holding the locks.

   Chrome keeps the extension's id and IndexedDB, so the data stays.

## Files

| File | Responsibility |
| --- | --- |
| `release-keys.json` | The Ed25519 public keys trusted to sign a release, as base64 of their 32 raw bytes. The maintainer adds the first one (docs/RELEASING.md, *Signing key*); `tooling/release.mjs` hands the list to the publish job, which signs only with a key in it. Empty, no one-click update is possible. |
| `signature.ts` | `RELEASE_KEYS` (the file's keys, checked), `keyBytes`, `trustedKeys`, `ed25519Available` (Web Crypto's Ed25519, Chrome 137 and later) and `signedBy`: the trusted key whose signature is over exactly the zip's bytes, or null. A malformed signature, key or browser error is null, never a pass. No signature code of Xomoni's own. |
| `download.ts` | Where releases come from: `RELEASE_DOWNLOADS` (`https://github.com/pirdehi/xomoni/releases/download/`), `RELEASE_ASSETS` (GitHub's redirect host) and `RELEASE_HOSTS` (the manifest's `optional_host_permissions`); `releaseUrls` (the versioned zip and its `.sig`); `downloadAccess`, which asks for that host access on the click, and `dropDownloadAccess`, which gives it back after the download; `fromReleaseHosts`, which refuses any other origin, an empty URL included; `downloadFile`, which sends no cookie or referrer, refuses another host, a status other than 200 (404 is null) and more bytes than its limit, and gives up after two minutes. |
| `release-zip.ts` | `safePath` (relative, `/`-separated, letters, digits, `.`, `_` and `-`, no `..`, no hidden or device names, at most six levels) and `readRelease`: every path safe and distinct (also without regard to case), at most `MAX_RELEASE_FILES` files and `MAX_RELEASE_UNZIPPED` bytes, every entry read with `shared/zip.ts` (sizes and CRCs), a top-level Manifest V3 `manifest.json` of exactly the version asked for, with the scripts it names inside. Returns the files, the manifest and its `key`. `minimumChrome`: the major version `minimum_chrome_version` asks for (one that can't be read asks too much). |
| `manifest-access.ts` | `widerAccess`: what a release's manifest would let Xomoni do that the folder's doesn't, in words for the log. Compared: the four permission lists, content scripts' pages, `externally_connectable`, `web_accessible_resources`, each CSP directive's sources after `default-src` (`parseCsp`), and leaving incognito's `not_allowed`. Chrome shows these only when an extension is installed by hand, so any of them refuses the update (`new-permissions`). Pure. |
| `own-folder.ts` | `OwnFolder` and `OwnFile` (the parts of the File System Access handles used), `pickOwnFolder` (the picker, read and write, checked with `checkOwnFolder`, kept in `kvOwnFolderStore`), `folderProblemText`, `folderAccess` (`granted`, `denied`, or `needs-click` when Chrome must ask and the click is used up), `readFolderManifest` and `runningXomoni`. |
| `write.ts` | `writeRelease`: refuses, writing nothing, while an earlier update's journal is kept (`unfinished`: it may be the only backup). Then it reads every file it will replace into a backup and keeps it in IndexedDB (`kvJournal`), and writes new files first, replaced ones next and `manifest.json` last. If one write fails, it puts everything back (`write-failed`, or `rollback-failed` with the journal kept). Once all is written, a journal it can't forget is left for the reload to settle. Only then does it remove the old version's leftovers: files in `assets/` that the previous one-click update wrote (`kvShipped`) and this one doesn't, never a file Xomoni didn't write. `restoreJournal` undoes an update cut short. Every path is checked again before any file is touched. The journal, the folder and the list of files written are `UPDATE_KEYS` in `shared/db.ts`, which *Delete local data* keeps. |
| `problems.ts` | `UpdateProblem`, each reason an update stops (`unfinished`, `new-permissions` and `old-browser` among them), `UpdateFailure` and `problemText`, what the dashboard says for each. |
| `update.ts` | `updateTo`, the update in order: the checks (`unfinished` first), the download, the signature, the package. A release whose `key` differs from the folder's is refused as `new-identity`, one that asks for more access as `new-permissions` (`widerAccess`), and one that needs a newer browser as `old-browser`. Then, under `RUNNER_LOCK` and `UPDATE_LOCK`, the folder, the journal and those checks again, the write, the log line with the zip's SHA-256, `recordUpdate` and `chrome.runtime.reload`, still under the locks. `oneClickState` (a zip install, a trusted key, Ed25519 and the picker, and the folder chosen); `unfinishedUpdate` and `updateWriting` (whether `UPDATE_LOCK` is held, so the dashboard doesn't take an update under way for one cut short). `putBackUnfinished` restores only while Xomoni runs the version the journal replaced and the folder holds it or the one written; otherwise it forgets the journal, saying why (`done`, `stale`). `updateOutcome` runs after the reload: it settles a stale journal, then says whether the new version runs, or Chrome loads Xomoni from another folder (forgotten then); a record of other versions says nothing. Also `chromeMajor`, `isZipInstall` (`chrome.management.getSelf`, needing no permission) and `browserPorts`, the browser's parts, which tests replace. |

## Depends on

- `../shared/` only (rule `ext-update-is-isolated`): `db.ts` (`kv`, the activity log), `runner-lock.ts`, `update-record.ts`, `version.ts`, `json.ts` and `zip.ts`.
- Browser APIs: Web Crypto (Ed25519, SHA-256), File System Access (`showDirectoryPicker`, handle permissions, `createWritable`), Web Locks, `fetch`, and `chrome.permissions`, `chrome.management.getSelf` and `chrome.runtime.reload`.

## Used by

- `../ui/components/OneClickUpdate.tsx` and `../ui/components/UpdateNotice.tsx`: *Update now* in the notice that a newer version is out, Settings' *Updates* card, and *Put back* after an update cut short.
- Not in a store build: `npm run build:store` puts `../ui/components/OneClickUpdate.store.tsx` in place of `OneClickUpdate.tsx`, so nothing imports this folder there, and drops its GitHub access and CSP sources from the manifest (`vite.config.ts`, checked by `tooling/store-build.test.mjs`).
- Nothing else: the engine, the service worker, the content scripts and `cloud/` can't import it (their own rules). The service worker reopens the dashboard after an update through `shared/update-record.ts`.

## Rules

- `ext-update-is-isolated` (from `.dependency-cruiser.cjs`): files here import only `update/` and `shared/`.
- `tests/manifest.test.ts`: only this area calls `chrome.permissions`, `chrome.runtime.reload`, opens a folder for writing or names GitHub's release hosts; extension pages may connect only to Xomoni's API and those two hosts.
- Nothing here is written before the release is downloaded, its signature checked against `RELEASE_KEYS`, and every path and the manifest checked (version, `key`, access, browser). Nothing is written while a job runs or while an earlier update's journal is kept. A write that fails is undone.
- No code comes from anywhere but this repository's signed releases, and none is run before Chrome reloads the extension from its folder.

## Tests

- `../../tests/update-signature.test.ts`: RFC 8032's test vector, a good signature, a tampered zip, another key, a missing or altered signature, a browser without Ed25519.
- `../../tests/update-release-zip.test.ts`: zip-slip and every other unsafe path, two files a case-insensitive disk would mix up, a missing or wrong manifest, another version, a missing script, a damaged zip and too many files.
- `../../tests/update-folder.test.ts`: the folder check (this Xomoni, another version, not Xomoni), the picker (closed, refused, wrong folder), the permission (kept, asked on a click, a used-up click, denied).
- `../../tests/update-write.test.ts`: the order, the rollback when a write fails, a rollback that fails and is finished later from the journal, a journal never written over, a journal that can't be forgotten after a complete write, leftovers (only files the previous update wrote, only in `assets/`), the update's values surviving *Delete local data*, never a path outside the folder.
- `../../tests/update-access.test.ts`: one refusal for each kind of wider access, and the same or less passing.
- `../../tests/update-download.test.ts`, `../../tests/update.test.ts`:
  - the whole update with a throwaway key and a fake GitHub;
  - nothing changes after a bad signature, a missing one, zip-slip, another version, another `key`, more access, a newer browser needed, a network failure, a running job or a failed write;
  - a second update after a failed rollback is refused with the backup kept;
  - the checks again under the lock;
  - GitHub's access given back, and the reload under the locks;
  - put back only where it applies, with stale journals settled after the reload.
- `../../tests/ui/one-click-update.test.tsx`: the update card's states, the notice hidden while an update writes, and journals forgotten instead of put back. `../../tests/ui/one-click-update-store.test.tsx`: the store build's stand-in.
- `../../../../tooling/store-build.test.mjs`: the store build has none of this folder's code, and no GitHub access in its manifest.
- `../../../../tooling/workflows.test.mjs`: the release workflow's signing step, run with a throwaway key, gives signatures this check accepts; it releases unsigned with a warning while no key is trusted, and refuses once one is, without the secret or with another key.

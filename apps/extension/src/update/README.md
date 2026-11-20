# `update/`: one-click updates of a zip install

A Xomoni loaded from the zip (*Load unpacked*) can't update itself the way a store install does. This area lets it, on the person's click, with every check done before anything is written ([ADR-0033](../../../../docs/adr/0033-one-click-updates-for-the-zip-install.md), #305):

1. **Once, Xomoni's own folder.** The person picks the folder they loaded Xomoni from, in the browser's folder picker with read and write access (File System Access). Xomoni keeps it only if its `manifest.json` names this extension at the version Chrome runs. Chrome 122 and later can keep the permission (*Allow on every visit*); otherwise it asks again on the next click.
2. **On *Update now*, only while no job runs** (the runner's Web Lock, `RUNNER_LOCK`), Xomoni:
   - downloads the release's zip and its signature from this repository's GitHub releases, and nowhere else;
   - checks the Ed25519 signature with the browser's own Web Crypto against the keys this build trusts (`release-keys.json`);
   - reads every file of the zip and checks its path, its size and that the manifest is this version's;
   - writes it all into the folder, or none of it, while holding the runner's lock;
   - writes the update to the activity log and reloads itself.

   Chrome keeps the extension's id and IndexedDB, so the data stays.

## Files

| File | Responsibility |
| --- | --- |
| `release-keys.json` | The Ed25519 public keys trusted to sign a release, as base64 of their 32 raw bytes. The maintainer adds the first one (docs/RELEASING.md, *Signing key*); `tooling/release.mjs` hands the list to the publish job, which signs only with a key in it. Empty, no one-click update is possible. |
| `signature.ts` | `RELEASE_KEYS` (the file's keys, checked), `keyBytes`, `trustedKeys`, `ed25519Available` (Web Crypto's Ed25519, Chrome 137 and later) and `signedBy`: the trusted key whose signature is over exactly the zip's bytes, or null. A malformed signature, key or browser error is null, never a pass. No signature code of Xomoni's own. |
| `download.ts` | Where releases come from: `RELEASE_DOWNLOADS` (`https://github.com/pirdehi/xomoni/releases/download/`), `RELEASE_ASSETS` (GitHub's redirect host) and `RELEASE_HOSTS` (the manifest's `optional_host_permissions`); `releaseUrls` (the versioned zip and its `.sig`); `downloadAccess`, which asks for that host access on the click; `downloadFile`, which sends no cookie or referrer, refuses another host, a status other than 200 (404 is null) and more bytes than its limit, and gives up after two minutes. |
| `release-zip.ts` | `safePath` (relative, `/`-separated, letters, digits, `.`, `_` and `-`, no `..`, no hidden or device names, at most six levels) and `readRelease`: every path safe and distinct (also without regard to case), at most `MAX_RELEASE_FILES` files and `MAX_RELEASE_UNZIPPED` bytes, every entry read with `shared/zip.ts` (sizes and CRCs), a top-level Manifest V3 `manifest.json` of exactly the version asked for, with the scripts it names inside. Returns the files and the manifest's `key`. |
| `own-folder.ts` | `OwnFolder` and `OwnFile` (the parts of the File System Access handles used), `pickOwnFolder` (the picker, read and write, checked with `checkOwnFolder`, kept in `kvOwnFolderStore`), `folderProblemText`, `folderAccess` (`granted`, `denied`, or `needs-click` when Chrome must ask and the click is used up), `readFolderManifest` and `runningXomoni`. |
| `write.ts` | `writeRelease`: reads every file it will replace into a backup and keeps it in IndexedDB (`kvJournal`), writes new files first, replaced ones next and `manifest.json` last, puts everything back if one write fails (`write-failed`, or `rollback-failed` with the journal kept), and only then removes the old version's leftovers in `assets/`. `restoreJournal` undoes an update cut short. Every path is checked again before any file is touched. |
| `problems.ts` | `UpdateProblem`, each reason an update stops, `UpdateFailure` and `problemText`, what the dashboard says for each. |
| `update.ts` | `updateTo`, the update in order (checks, download, signature, package, a release whose `key` differs from the folder's refused as `new-identity`, then the write under the runner's lock, the log line with the zip's SHA-256, `recordUpdate` and `chrome.runtime.reload`); `oneClickState` (a zip install, a trusted key, Ed25519 and the picker, and the folder chosen); `unfinishedUpdate` and `putBackUnfinished`; `updateOutcome` (after the reload: the new version runs, or Chrome loads Xomoni from another folder, which is then forgotten); `isZipInstall` (`chrome.management.getSelf`, needing no permission) and `browserPorts`, the browser's parts, which tests replace. |

## Depends on

- `../shared/` only (rule `ext-update-is-isolated`): `db.ts` (`kv`, the activity log), `runner-lock.ts`, `update-record.ts`, `version.ts`, `json.ts` and `zip.ts`.
- Browser APIs: Web Crypto (Ed25519, SHA-256), File System Access (`showDirectoryPicker`, handle permissions, `createWritable`), Web Locks, `fetch`, and `chrome.permissions`, `chrome.management.getSelf` and `chrome.runtime.reload`.

## Used by

- `../ui/components/OneClickUpdate.tsx` and `../ui/components/UpdateNotice.tsx`: *Update now* in the notice that a newer version is out, Settings' *Updates* card, and *Put back* after an update cut short.
- Nothing else: the engine, the service worker, the content scripts and `cloud/` can't import it (their own rules). The service worker reopens the dashboard after an update through `shared/update-record.ts`.

## Rules

- `ext-update-is-isolated` (from `.dependency-cruiser.cjs`): files here import only `update/` and `shared/`.
- `tests/manifest.test.ts`: only this area calls `chrome.permissions`, `chrome.runtime.reload`, opens a folder for writing or names GitHub's release hosts; extension pages may connect only to Xomoni's API and those two hosts.
- Nothing here is written before the release is downloaded, its signature checked against `RELEASE_KEYS` and every path and the manifest checked. Nothing is written while a job runs. A write that fails is undone.
- No code comes from anywhere but this repository's signed releases, and none is run before Chrome reloads the extension from its folder.

## Tests

- `../../tests/update-signature.test.ts`: RFC 8032's test vector, a good signature, a tampered zip, another key, a missing or altered signature, a browser without Ed25519.
- `../../tests/update-release-zip.test.ts`: zip-slip and every other unsafe path, two files a case-insensitive disk would mix up, a missing or wrong manifest, another version, a missing script, a damaged zip and too many files.
- `../../tests/update-folder.test.ts`: the folder check (this Xomoni, another version, not Xomoni), the picker (closed, refused, wrong folder), the permission (kept, asked on a click, a used-up click, denied).
- `../../tests/update-write.test.ts`: the order, the rollback when a write fails, a rollback that fails and is finished later from the journal, an update cut short, never a path outside the folder.
- `../../tests/update-download.test.ts`, `../../tests/update.test.ts`: the whole update with a throwaway key and a fake GitHub, and that a bad signature, a missing one, zip-slip, another version, another `key`, a network failure, a running job or a failed write changes nothing.
- `../../tests/ui/one-click-update.test.tsx`: the update card's states.
- `../../../../tooling/workflows.test.mjs`: the release workflow's signing step, run with a throwaway key, gives signatures this check accepts.

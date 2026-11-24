# `shared/vault/`: X's official files, kept on the computer

The vault ([ADR-0043](../../../../../docs/adr/0043-the-vault-x-files-kept-on-the-computer.md), #424): what X's official files say about the person's own account, read in, checked and kept in the extension's IndexedDB. It is part of `shared/`, the kernel, and follows its rules. Nothing here sends anything anywhere ([ADR-0004](../../../../../docs/adr/0004-x-data-stays-local.md)), and nothing here acts on X: it never sends a request to X, scrolls, navigates, clicks or opens a tab there.

## Files

| File         | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`   | The data model and its closed lists: `VAULT_SOURCES`, the import ledger's row (`VaultImport`, with `ImportCounts`), X's analytics of a post (`AnalyticsPost`, `POST_METRICS`) and of a day (`AnalyticsDay`, `DAY_METRICS`), and the timeline's events (`AccountEvent`, `ACCOUNT_EVENT_KINDS`, `ACCOUNT_EVENT_SOURCES`), with their limits (`EVENT_WORDS`, 500; `FINGERPRINT`; `MAX_COUNT`, 10¹²). Pure.                                                                    |
| `records.ts` | Every vault row checked and copied field by field (`vaultImportRecord`, `analyticsPostRecord`, `analyticsDayRecord`, `accountEventRecord`): X ids, whole numbers from 0 to 10¹², real days that aren't in the future (`isVaultDay`), known kinds and sources, texts of limited size, refs that can't carry markup. `cleanWords` cleans the timeline's words and cuts them to 500. Used by `db.ts` here and by the move file (ADR-0032). Pure.                              |
| `db.ts`      | Storage, on the tables of Dexie version 8 (`../db.ts`): the ledger (`recordImport`, `findImport` for duplicates, `importLedger`), the analytics merges (`mergeAnalyticsPosts`: each number the highest seen, never lower; `mergeAnalyticsDays`: the newer import wins), the timeline (`addAccountEvent`, once per kind and `ref` within `EVENT_WINDOWS`; `accountTimeline`, newest first, joined with the risk ladder's events in `RISK_EVENT_WORDS`). One bad row writes nothing (`VaultError`). |
| `importer.ts` | The one importer (ADR-0043, decisions 1 to 5): `openFiles` lists what was dropped (a ZIP's directory only, its entries read in place; an entry whose path climbs out, `isSafeZipPath`, is left out), `registerParser` takes a strategy per kind of file (`VaultParser`: `matches`, which may peek at a file's first bytes with `head` within its limit, `onePerFile` for a part per file, `maxBytes`, `owner`, which sees the files' fingerprint, `read` and `finish`), `planImport` gives each file to the first parser that takes it, checks every size before anything is read, asks whose files they are (refused, or to confirm), and looks each part's `fingerprint` up in the ledger (a ZIP's: the paths, sizes and CRCs of its directory; a text file up to 50 MB: its SHA-256 by Web Crypto; a folder: its files' paths, sizes and times). `runImport` merges batch by batch and writes one ledger row per part: a duplicate writes only that row, a cancel (`AbortSignal`) stops between batches and keeps what was merged, a failure writes `failed` and throws. |
| `archive-manifest.ts` | `parseThar`: X's archive manifest (`data/manifest.js`, `window.__THAR_CONFIG`) read tolerantly: when X made the archive, whether it is partial, its size and each kind of data's count; an unknown field is ignored, a broken file is null. Pure. |
| `archive-parser.ts` | X's archive on the importer (`ARCHIVE_PARSER`, registered when the module loads): `account.js`, `tweets.js`, `like.js` and their parts, and the manifest, with the archive import's own limits (`MAX_ARCHIVE_FILE_BYTES`, `MAX_ACCOUNT_FILE_BYTES`), words and chunks of 20,000 (`ARCHIVE_IMPORT_CHUNK`, #390). The ledger keeps the date X made the archive (`coverTo`), and the timeline an `archive_imported` entry. |

## Depends on

- `../db.ts` (the database), `../archive.ts` (the archive's own parsers), `../ids.ts`, `../json.ts`, `../risk.ts`, `../time.ts` and `../zip.ts`. No other area of the extension (rule `ext-shared-is-the-kernel`, whose path covers this folder).

## Used by

- `../../ui/importArchive.ts`: the Library's archive import, a thin shell over `planImport` and `runImport` with `ARCHIVE_PARSER` alone.
- `../../../tests/vault-db.test.ts`: the upgrade from version 7, every check and merge rule, the timeline, and removal with `forgetAccount` and *Delete local data*.
- `../../../tests/vault-importer.test.ts` and `../../../tests/archive-manifest.test.ts`: the importer and the manifest.

## Rules

- Every value is `unknown` until `records.ts` checks it ([ADR-0016](../../../../../docs/adr/0016-strict-typescript-and-type-aware-lint.md)). A write checks all its rows first; one out of shape refuses the whole write.
- A merge never lowers a number: X's counts only grow (ADR-0043, decision 6).
- The timeline's words are Xomoni's own or the person's note, at most 500 characters, never text from an X page (#146). They are shown as text, never as HTML.
- The vault's tables go with *Delete local data* and with `forgetAccount`. They are not in *Download a copy*.
- `db.ts`, `importer.ts` and `archive-parser.ts` use IndexedDB, so the content script must not import them; `types.ts`, `records.ts` and `archive-manifest.ts` are safe there.
- A parser reads nothing before `planImport` has checked every size, and refuses another account's files before anything is written.

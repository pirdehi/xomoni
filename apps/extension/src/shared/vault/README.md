# `shared/vault/`: X's official files, kept on the computer

The vault ([ADR-0043](../../../../../docs/adr/0043-the-vault-x-files-kept-on-the-computer.md), #424): what X's official files say about the person's own account, read in, checked and kept in the extension's IndexedDB. It is part of `shared/`, the kernel, and follows its rules. Nothing here sends anything anywhere ([ADR-0004](../../../../../docs/adr/0004-x-data-stays-local.md)), and nothing here acts on X: it never sends a request to X, scrolls, navigates, clicks or opens a tab there.

## Files

| File         | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`   | The data model and its closed lists: `VAULT_SOURCES`, the import ledger's row (`VaultImport`, with `ImportCounts`), X's analytics of a post (`AnalyticsPost`, `POST_METRICS`) and of a day (`AnalyticsDay`, `DAY_METRICS`), and the timeline's events (`AccountEvent`, `ACCOUNT_EVENT_KINDS`, `ACCOUNT_EVENT_SOURCES`), with their limits (`EVENT_WORDS`, 500; `FINGERPRINT`; `MAX_COUNT`, 10¹²). Pure.                                                                    |
| `records.ts` | Every vault row checked and copied field by field (`vaultImportRecord`, `analyticsPostRecord`, `analyticsDayRecord`, `accountEventRecord`): X ids, whole numbers from 0 to 10¹², real days that aren't in the future (`isVaultDay`), known kinds and sources, texts of limited size, refs that can't carry markup. `cleanWords` cleans the timeline's words and cuts them to 500. Used by `db.ts` here and by the move file (ADR-0032). Pure.                              |
| `db.ts`      | Storage, on the tables of Dexie version 8 (`../db.ts`): the ledger (`recordImport`, `findImport` for duplicates, `importLedger`), the analytics merges (`mergeAnalyticsPosts`: each number the highest seen, never lower; `mergeAnalyticsDays`: the newer import wins), the timeline (`addAccountEvent`, once per kind and `ref` within `EVENT_WINDOWS`; `accountTimeline`, newest first, joined with the risk ladder's events in `RISK_EVENT_WORDS`). One bad row writes nothing (`VaultError`). |

## Depends on

- `../db.ts` (the database), `../ids.ts`, `../json.ts`, `../risk.ts` and `../time.ts`. No other area of the extension (rule `ext-shared-is-the-kernel`, whose path covers this folder).

## Used by

- `../../../tests/vault-db.test.ts`: the upgrade from version 7, every check and merge rule, the timeline, and removal with `forgetAccount` and *Delete local data*.

## Rules

- Every value is `unknown` until `records.ts` checks it ([ADR-0016](../../../../../docs/adr/0016-strict-typescript-and-type-aware-lint.md)). A write checks all its rows first; one out of shape refuses the whole write.
- A merge never lowers a number: X's counts only grow (ADR-0043, decision 6).
- The timeline's words are Xomoni's own or the person's note, at most 500 characters, never text from an X page (#146). They are shown as text, never as HTML.
- The vault's tables go with *Delete local data* and with `forgetAccount`. They are not in *Download a copy*.
- `db.ts` uses IndexedDB, so the content script must not import it; `types.ts` and `records.ts` are safe there.

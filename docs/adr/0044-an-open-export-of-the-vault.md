# ADR-0044: An open export of the vault that needs no Xomoni to read

- Status: Accepted
- Date: 2026-11-23

## Context

The vault ([ADR-0043](0043-the-vault-x-files-kept-on-the-computer.md)) keeps a person's history from X's files on their computer. Xomoni already writes two files from its data:

- *Export everything* writes a file only another Xomoni can read. It is checked and versioned for a move ([ADR-0032](0032-move-data-between-xomoni-versions.md)), and holds the data in Xomoni's own shape, as JSON.
- *Download a copy* in the Library writes the posts of a date range, as a page and as JSON (#151).

Neither is a stable contract for a person who wants their history in a spreadsheet, in another tool, or in a folder they keep after they stop using Xomoni. A promise that a person's data outlives the tool needs a fixed format, readable with what every computer has.

## Decision

1. **One ZIP, made on the computer.**
   - *Export my vault* writes one ZIP with the browser's own compression (`CompressionStream`), and saves it in Downloads with the dashboard's download helper.
   - It never leaves the device: no server, account or network takes part ([ADR-0004](0004-x-data-stays-local.md)).
2. **What is in it:**
   - `README.txt`: what each file is, with its columns, the date of the export and the schema's version, and that no Xomoni is needed to read it;
   - `schema.json`: the version, `xomoni-vault-export@1`, and every file with its columns and their types;
   - one CSV and one JSON for each part: the posts, replies and reposts; the likes; the daily numbers; the analytics of each post; the account's timeline; the import ledger; and the parts later features add, such as X's labels ([ADR-0045](0045-reach-diagnosis-guesses-labelled-as-guesses.md));
   - `index.html`: a page that shows the parts, with every text escaped and no script, under `ARCHIVE_CSP`, as *Download a copy* is.
3. **CSV a spreadsheet can't run.** RFC 4180, in UTF-8 with a byte order mark. A cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a `'` in front, so a spreadsheet shows it as text instead of running it as a formula. This is the rule of the website's `toCsv`.
4. **Stable names.**
   - Within a schema version, a column keeps its name and its meaning.
   - Renaming a column, removing one or changing its meaning makes a new version, `xomoni-vault-export@2`, whose README lists the change.
   - Adding a column or a part keeps the version. A reader ignores what it doesn't know.
5. **Other people's words only when asked.** A part that holds other people's words is left out unless the person ticks it, beside a line that says whose words it holds. Such parts are messages, bookmarks, and replies others wrote to the person ([ADR-0030](0030-replies-to-you-kept-on-the-computer.md)). By default, the export holds only the person's own data.
6. **Always free.** The export is on every plan, never behind the paywall ([ADR-0042](0042-payments-and-entitlements-with-polar.md)).
7. **Large exports work.**
   - The ZIP is written entry by entry, as a stream.
   - It uses ZIP64 past 65,535 entries or 4 GB.
   - Cancelling writes no file.

Built in [#426](https://github.com/pirdehi/xomoni/issues/426).

## Consequences

- A person can open their history in any spreadsheet or tool, and keep it after Xomoni.
- **The export is a public contract.** Tests check `schema.json` against the files, and a change of columns needs a new version.
- **The ZIP holds personal data in plain files.** The page says to keep it private, as it does for the move file.
- **It is not a backup Xomoni restores from;** that is the move file's job (ADR-0032). The two formats stay apart on purpose: one for people and other tools, one for another Xomoni.
- Each feature that adds data to the vault registers its part, with its columns, in the same pull request.

## Alternatives considered

- **Reuse the move file.** It is versioned for a move between copies of Xomoni, holds the data in Xomoni's own shape, and is JSON only. A person can't read it in a spreadsheet.
- **JSON only.** Tools can read it; most people can't.
- **SQLite.** One typed file, but it needs a tool most people don't have.
- **Others' words by default.** Their words aren't the person's to pass on without a thought; ADR-0030 already keeps them to the minimum.

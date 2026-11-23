# ADR-0043: The vault: X's official files read and kept on the computer, with an import ledger

- Status: Accepted
- Date: 2026-11-23

## Context

X gives a person official files about their own account:

- **the archive**, a ZIP from *Download an archive of your data*, which Xomoni already reads for posts and likes ([ADR-0022](0022-get-the-x-archive-without-leaving-xomoni.md));
- **the analytics export**, a CSV of posts or of days, which covers only the last months;
- **the monthly *Under the hood* file**, a JSON from X's settings that lists the labels X applied that month.

Reach diagnosis ([ADR-0045](0045-reach-diagnosis-guesses-labelled-as-guesses.md)), the account's timeline and the open export ([ADR-0044](0044-an-open-export-of-the-vault.md)) build on these files in R1 (#424 to #426), and later features will too. No decision says yet:

- which of X's files Xomoni reads;
- how much of them it keeps, and for how long;
- how it knows a file it has read before;
- what it does with another account's file.

X's rules prohibit "non-API automation, such as scripting the X website" ([PLAYBOOK C7](../PLAYBOOK.md)).

- Reading a file the person downloaded does nothing on X.
- Keeping what X already sends to a page the person opened makes no new request either ([ADR-0026](0026-daily-numbers-in-the-cloud.md), [ADR-0030](0030-replies-to-you-kept-on-the-computer.md)).
- A tool that scrolls, navigates or clicks on X by itself is a different risk. On 2026-11-23 the maintainer decided that the vault, and every feature built on it, does none of that.

## Decision

1. **Sources.** The vault reads only these:
   - X's official files, chosen or dropped by the person: the archive (the ZIP, or its unzipped folder), the analytics CSV (posts or days) and the *Under the hood* JSON;
   - the archive ZIP in Downloads › Xomoni, as today (ADR-0022);
   - later, under a decision of its own, X's answers to pages the person opens and scrolls themselves. That means only what X already sent to that page, never a request made for the vault, and only with the person's consent for each kind of page.

   Each source is a parser registered on one importer (`shared/vault/importer.ts`), a table-driven strategy ([ADR-0015](0015-architecture-styles-principles-and-patterns.md)). A file no parser recognizes is refused with the reason, and nothing is written.
2. **No automatic reading of X.**
   - The vault never sends a request to X.
   - It never scrolls, navigates or clicks there, opens an X tab, or starts a job.
   - It uses none of X's limits ([ADR-0012](0012-one-fifth-of-every-x-limit.md)).
   - Its empty state tells the person how to get a file: open X's archive or analytics page themselves, then drop the file in Xomoni. It doesn't offer to start the archive job of ADR-0022 for them.
3. **Size limits, checked before reading.** A file over its limit is refused before any of it is read:
   - an archive entry over `MAX_ARCHIVE_FILE_BYTES` (512 MB), as today;
   - a CSV over 50 MB;
   - a JSON over 5 MB.

   Every value read is `unknown` until checked (`shared/json.ts`, [ADR-0016](0016-strict-typescript-and-type-aware-lint.md)).
4. **An import ledger.** Every import writes one row in `vaultImports`:
   - the account and the source;
   - the file's name and size, and its fingerprint;
   - when it was imported, and the period the file covers;
   - the rows read, merged and skipped, and the problems met.

   The fingerprint of a ZIP is the size and CRC of every entry in its central directory, read without reading the whole file. For a text file it is its SHA-256, computed with Web Crypto. A file whose fingerprint is known writes a `duplicate` row and nothing else. The ledger and the fingerprints never leave the computer.
5. **Whose file it is.**
   - An archive belongs to the account in its `account.js`. Another account's archive is refused, as today.
   - A posts CSV is accepted when at least half of its post ids are the account's own posts in Xomoni's inventory. Below half, it is refused with the reason. With an empty inventory, the person confirms that the CSV is theirs.
   - A days CSV has no ids, so the person confirms it once. The answer is remembered for that fingerprint.
   - An *Under the hood* file is matched by the id or handle inside it when it has one, and otherwise confirmed.
6. **Kept until the person deletes it.**
   - Vault data has no expiry.
   - It goes with *Delete local data* and when an account is forgotten (`forgetAccount`).
   - It moves with the move file ([ADR-0032](0032-move-data-between-xomoni-versions.md), amended for version 2 in #424).
   - It isn't in *Download a copy*, which holds the posts of a date range.

   A merge never lowers a number. X's counts only grow, so a post keeps the highest count seen, with its newest "as of" date. For a day, the newest import wins.
7. **Tolerant of X's changes.** X changes its files without notice.
   - A column or field the parser doesn't know is ignored, and counted in the ledger's problems.
   - A row it can't read is skipped, with its line number.
   - Known headers have aliases (`Impressions` or `Views`).

   A file is refused only when nothing in it is recognizable.
8. **The person's own data first.**
   - The vault keeps what X's files say about the person's own account and posts.
   - Where a file carries other people's words, such as messages or bookmarks, the feature that reads it decides in its own decision what is kept and for how long, as ADR-0030 does for replies.
   - The timeline's words are Xomoni's own, or the person's notes of at most 500 characters, never text from an X page.
9. **A local reminder, with no new permission.**
   - Each source has a cadence: 30 days for the archive, 60 for the analytics CSV, since X keeps about 90.
   - When one is due, Xomoni reminds the person at most once a day per account, and only within active hours. It uses the notifications Xomoni already has, and asks for no `alarms` permission.
   - *Not now* snoozes the reminder for 7 days, and a switch in Settings turns it off.
   - A reminder opens the Vault page. It never starts anything, opens X or sends anything.
10. **Nothing reaches a server.**
    - Every vault table lives in the extension's IndexedDB. No Supabase table, column or function is added (ADR-0004).
    - The website reads a summary of counts and dates only, in the same browser ([ADR-0028](0028-xomoni-data-on-the-website-in-the-same-browser.md), amended in #426).
    - The website never starts an import ([ADR-0006](0006-website-is-view-only.md)).

Built in [#424](https://github.com/pirdehi/xomoni/issues/424) (the tables, the ledger, the importer), [#425](https://github.com/pirdehi/xomoni/issues/425) (the Vault page, the analytics CSV, the timeline, the reminder) and [#426](https://github.com/pirdehi/xomoni/issues/426) (the export, the website's card, performance).

## Consequences

- **One base for every feature on X's files.** Reach diagnosis, the timeline and the export share one importer, one ledger and one set of rules. A new file type is a parser and its fixture.
- **The vault grows with every import.** Performance budgets (#390, #426) keep the page fast at 100,000 posts.
- **Fixtures are synthetic,** shaped after X's files ([ADR-0040](0040-test-the-extension-against-recorded-x-fixtures.md)). A real file is looked at only for its shape (column names, keys, folder names), and none of its data is recorded.
- **When X changes a file,** the vault keeps what it can and says what it skipped. The parser and its fixture change in the same pull request.
- **The Dexie version is taken at merge time,** since other work adds tables too.
- **The playbook needs no new risk:** the vault does nothing on X. E8 gets a line when the archive import moves onto the importer.
- **No new data on any server,** so the privacy page needs no change.

## Alternatives considered

- **Read the person's lists by scrolling them for them.** Scrolling X by itself is the scripting X's rules name. Rejected by the maintainer on 2026-11-23, with every other automatic reading of X.
- **Keep the vault in the cloud.** Breaks ADR-0004, and the reason people trust Xomoni with their archive.
- **Read the files again each time instead of keeping them.** People don't keep X's files, and the analytics export covers only recent months. Keeping them is what makes history possible.
- **Expire vault data after a while.** The vault's value is its history. The person deletes it whenever they want, in one click.

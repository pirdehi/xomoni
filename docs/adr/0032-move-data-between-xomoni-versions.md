# ADR-0032: Moving data between Xomoni versions: one checked file, on the computer, merged without deleting

- Status: Accepted
- Date: 2026-11-21

## Context

Chrome keeps an extension's IndexedDB under its id. Xomoni installed from the zip has an id Chrome derives from its folder. A fixed id (a `key` in `manifest.json`, phase 4 of the install project, #295) or the Chrome Web Store version is a different extension to Chrome. Its database starts empty, and everything the old one keeps stays behind:

- the accounts and their inventory: posts, replies, reposts and likes, from X and from an imported archive;
- jobs and the activity log;
- X's observed limits, the page loads of the last day, and the risk ladder's events;
- the daily numbers (ADR-0026) and the replies others wrote to the person (ADR-0030);
- settings, Watch, the archive's state and the daily view cap learned from X.

Some of this keeps Xomoni safe. Without the risk ladder's events, an account X warned yesterday would run at full pace again. Without the page loads and the log, Xomoni would forget how much of X's limits it used today and the warm-up of a new account (PLAYBOOK A1–A4, B5).

*Export everything* in Settings wrote the accounts, inventory, jobs and log only, with no version and no way to read it back. The sign-out dialog's copy of one account was the same. Nothing could import either.

ADR-0004 keeps X data in the browser, so the move can't go through a server.

## Decision

1. **The move is a file on the person's computer, and nothing else.** *Export everything* (Settings › *Move your data*) saves it in Downloads with the dashboard's download helper. *Import from a file* reads it in the other Xomoni. No server, no account and no network take part (ADR-0004). The page says the file holds the person's posts and others' replies, so it should be kept private.
2. **What is in the file** (`format: "xomoni-export"`, `version: 1`):
   - `app`: the version of the Xomoni that wrote it;
   - `exportedAt`: when, as an ISO 8601 time;
   - `checksum`: `sha256:` and the hex SHA-256 of the header and the data together;
   - `data`: every record of `accounts`, `items`, `jobs`, `logs`, `limits`, `reads`, `risk`, `checks`, `daily` and `incoming`, without auto-increment numbers, and these `kv` values:
     - `settings` and `activeAccount`;
     - per X account: `watchTabs`, `watchResults`, `archive`, `archiveRequest` and `viewCap`.

   Others' replies (ADR-0030) are in it, so a move keeps them, still within that ADR's 90 days and 5,000.
3. **What stays behind, on purpose:**
   - `consents`: informed consent is the person's act in each Xomoni; the new one asks once, and no file stands in for it.
   - The xomoni.com connection (`cloud`) and its device token, a secret that must never be in a file; the new Xomoni signs in with one click (ADR-0025).
   - The sign-in state and short-lived requests from xomoni.com (`signedOut`, `webLeftAt`, `connectRequest`, `websitePlan`, `websiteStop`, `websiteAsk`), what was sent to xomoni.com (`dailyStats`) and release news.
   - The Downloads folder Chrome let this extension read (`downloadsFolder`, `archiveFolderMade`, `archiveFolderChosen`, `archiveFilesSeen:…`), which Chrome grants to one extension only.
   - The theme, kept per screen in `localStorage`.

   `kv` values are moved from a list (`MOVED_VALUES`, `MOVED_ACCOUNT_VALUES`), so a value added later stays behind until someone adds it there. A test fails when a table of the database is neither moved nor listed as left out (`LEFT_OUT_TABLES`).
4. **How the file is checked** (`checkMoveFile`, before anything is written). Anything wrong refuses the whole file and says why:
   - A file larger than 256 MB is refused before it is read.
   - It must be JSON with the format and this version. A newer version asks the person to update this Xomoni; any other version is refused. An older Xomoni's partial *Export everything* gets its own message: export again from an updated Xomoni.
   - The checksum must match. It catches damage and edits that don't recompute it. It is not a signature: the file is only as trustworthy as where the person got it, so the page says to import only a file you exported yourself.
   - Every table must be there, and no other table or `kv` key. No two records of a table may share a key.
   - Records are checked field by field, like runtime messages (`inbound.ts`):
     - ids are X ids, and keys agree with their fields;
     - kinds, states, actions and budgets are ones Xomoni knows;
     - handles can't leave x.com in a link, and avatars come from X's image hosts;
     - times are at most a day ahead, and texts and lists have size limits;
     - accounts, `kv` values, sampled checks and X's limits have caps;
     - only known fields are copied. A field an older Xomoni didn't write yet gets today's default; a field in the wrong shape refuses the file.
   - The export runs every record through the same checks. The file it writes always imports; a damaged record is left out, and the person is told how many.
5. **How the file is merged** (`importData`). An import never replaces more data with less and never deletes anything. Only ADR-0030's limits on others' replies still apply.
   - **Items:** an item Xomoni removed (or X said was gone) stays removed unless X showed it live more than 5 seconds after the removal, the rule live sightings follow (PLAYBOOK E5). A copy read only from an archive since says nothing about X today. Between two copies that agree, the one changed last wins. The copy X showed last gives X's counts. Text, author and dates come from the newer copy and fill in from the other. Sources are joined, and the later like time is kept.
   - **Accounts:** the newer copy, filled in where it is empty.
   - **Days:** each count is the larger of the two, and the profile's counts come from the later copy.
   - **Jobs:**
     - a job here is kept unless the file's copy is newer;
     - a job that hadn't finished arrives cancelled, saying why. Nothing a file brings can resume work on X. A new cleanup with the same rules goes on where the old one stopped, because the inventory knows what was removed.
   - **X's limits:** the newer observation, with its reset believed at most a day ahead.
   - **Rows without a key of their own** (log lines, page loads, risk events, sampled checks) are added unless the same row is here, so importing a file twice adds nothing.
   - **The risk ladder's events** come in, but the person's typed overrides don't: a file can't lift a stop. A full stop that was lifted is lifted again by typing `RESUME` in the new Xomoni.
   - **Settings, the active account and Watch** fill in only what is missing, so what the person set up here stays. Settings pass `normalizeSettings` first: never faster than *Careful* or above one fifth of X's limits (ADR-0012).
   - **Archive state:** the later import time and the later request on X.
   - **View cap:** the lower one, so a move never lets Xomoni read more.
   - **Others' replies:** only those within 90 days come in, and the newest 5,000 per account are kept.
6. **An import runs only while no job does.**
   - It takes the runner's Web Lock (`RUNNER_LOCK`) if free, and refuses, having written nothing, if a job holds it.
   - While it holds the lock, no job can start in any tab.
   - It writes in one IndexedDB transaction: all of it lands, or none of it.
   - The import button is disabled while this tab's runner works.
7. **Every import is written to the activity log:** one line per account in the file, with the version, the export date and what came in.
8. **The move is guided:**
   - Settings › *Move your data* explains the two steps.
   - On a new install, onboarding and Home offer *Coming from another Xomoni? Import your data*. The offer shows while Xomoni hasn't done anything here yet (no job, no log line) and goes away for good with *Not now*.
   - An import's result, *Your data is here* with what came in, stays on screen until the person dismisses it: in Settings, and on Home in the offer's place. The import keeps it in the same transaction as its data, so it is waiting on Home when an import from onboarding turns the dashboard there (#357).
9. **One file format.** The sign-out dialog's copy of one account (#226) is the same file with that account's records and values only, so it can be imported again.

Built in [#300](https://github.com/pirdehi/xomoni/issues/300).

## Consequences

- People can move to the fixed id or the store's version without losing their copy, their history or the safety state that keeps their X account within its limits.
- The file holds post texts and others' replies in plain JSON. It is as private as the person keeps it; Xomoni says so and never sends it.
- A new table, or a new `kv` value worth moving, needs a decision here and a raise of `MOVE_VERSION` if the shape changes. The test that names every table enforces the first part.
- A file from an older Xomoni's *Export everything* (0.4 and older) can't be imported. The Xomoni being left must be updated to a version with this export first. The plan's phase 4 ships both together.
- A crafted file that passes the checks can add records. It can only make Xomoni slower: more page loads, log lines or risk events counted, a lower view cap. It can't make Xomoni faster, lift a stop, give consent or start a job.
- A very large account takes a while to export and import, in the dashboard's memory. The 256 MB limit is far above real accounts. A file above it is refused before it is read.

## Alternatives considered

- **Move through xomoni.com.** The website and the extension already talk in the same browser (ADR-0028). But the two Xomonis can't run at once under one handshake, and X data must not reach a server (ADR-0004).
- **`chrome.storage` or the File System Access API to share a folder between the two.** Each extension's storage is its own, and a shared folder still needs the person to pick it in both. A file in Downloads is the same steps and works everywhere.
- **Replace the database with the file.** Simpler, but a person who already used the new Xomoni would lose what it has, and an older file would undo removals.
- **Sign the file.** A signature needs a key; one kept in the extension can be read by anyone, and one kept by the person is a password to lose. A checksum catches damage, and the shape checks keep a crafted file from doing more than slowing Xomoni down.
- **Bring unfinished jobs in paused.** One click would resume them. But that click would act on X with rules from a file, not ones the person confirmed in this Xomoni, while a new cleanup with the same rules costs a minute and skips what is already done.

---
task: 425
title: 'The vault: the Vault page, X''s analytics CSV, the account''s timeline and a local reminder'
feature: vault
---

# The Vault page

X's own files about the person's account, kept on their computer (#425, [ADR-0043](../adr/0043-the-vault-x-files-kept-on-the-computer.md)): the Vault page shows how fresh each of X's files is and what it holds, takes X's archive (the ZIP) and its analytics export (CSV) dropped or chosen, says what it recognized before anything is written, keeps a ledger of every import, and the account's timeline. Nothing on it acts on X, opens X by itself, or sends anything anywhere.

The tests run the built extension in real browsers, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), with X's files made up by `apps/web/e2e/support/archive.ts` and `apps/web/e2e/fixtures/analytics/`. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-425
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S425-01 · happy

- Given a person whose Xomoni knows @xomoni_fixture, on the Vault page
- When they choose X's archive, a ZIP X made two and a half days ago, with Choose files
- Then Import these files? names X's archive and the ZIP, for @xomoni_fixture, and says nothing is written until Import
- And once they press Import, it says X's archive: 6 rows imported.
- And Your sources says X's archive is Up to date, made by X two days ago, with 4 posts, replies and reposts and 2
  likes, and Imports lists the ZIP with 6 imported
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-02 · happy

- Given the Vault page
- When the person drops X's analytics export of days, ticks that it is theirs, and imports it
- Then it says X's analytics of days: 7 rows imported.
- And Your sources says X's analytics export is Up to date, with 7 days from Oct 26, 2026 to Nov 1, 2026
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-03 · happy

- Given the Vault page
- When the person chooses X's archive and the analytics CSV of days together
- Then one Import these files? lists both, the CSV with its question
- And once they tick it and press Import, both come in, and Imports lists two rows
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-04 · happy

- Given X's analytics CSV of the account's two posts that Xomoni has read
- When the person imports it on the Vault page
- Then it says X's analytics of posts: 2 rows imported., with no question, since the posts are the account's
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-05 · invalid

- Given the Vault page
- When the person chooses another account's archive
- Then Import these files? says the archive belongs to @fixture_friend, not @xomoni_fixture, and nothing was imported
- And Import is disabled, and Imports still has nothing
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-06 · invalid

- Given the Vault page
- When the person chooses a CSV that isn't X's analytics, such as a bank statement
- Then Import these files? says This isn't an X analytics export. Nothing was imported.
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-07 · invalid

- Given an analytics CSV of posts most of which Xomoni doesn't have as the account's
- When the person chooses it on the Vault page
- Then it is refused: fewer than half of its posts are @xomoni_fixture's in Xomoni's copy
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-08 · invalid

- Given the Vault page
- When the person chooses a photo
- Then Import these files? says Xomoni doesn't know this file, and nothing was imported from it
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-09 · error

- Given a file named like X's ZIP that isn't a ZIP at all
- When the person chooses it on the Vault page
- Then an alert says This is not a ZIP file., and no plan opens
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-10 · error

- Given X's ZIP damaged inside, in tweets.js
- When the person imports it
- Then an alert says Not imported: This ZIP file is damaged or incomplete. Download it again from X.
- And Imports lists it as Couldn't finish, and nothing of it is in the Library
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-11 · error

- Given X's ZIP with a part of tweets.js (tweets-part1.js) that isn't X's format
- When the person imports it
- Then an alert says it wasn't imported, and Imports lists it as Couldn't finish
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-12 · security

- Given the Vault page, and every request its browser sends watched
- When the person imports X's archive and the analytics CSV
- Then no request leaves the computer: nothing goes to xomoni.com, X or anywhere else
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-13 · security

- Given an analytics CSV named with markup, <img src=x onerror=…>.csv, whose rows hold <script>
- When the person imports it
- Then Imports shows its name as text: no image is drawn and no script runs
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-14 · security

- Given an import of another X account's in this browser's vault
- When the person opens the Vault page for @xomoni_fixture
- Then Imports and Your sources show nothing of the other account's
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-15 · empty

- Given a new vault
- When the person opens the Vault page
- Then Your sources says Your vault is empty, with links to X's archive page and X's Analytics, opened by the person
- And Imports says No imports yet, and the timeline says Nothing on your timeline yet
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-16 · empty

- Given a vault with only the analytics of days
- When the person opens the Vault page
- Then X's archive says Not yet, Not imported yet, and Get my archive in the Library opens the Library
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-17 · cancel

- Given Import these files? open for X's archive
- When the person presses Cancel, or Escape
- Then the dialog closes and nothing was imported, and choosing the file again opens it again
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-18 · cancel

- Given Import these files? for the analytics CSV of days, which asks whose it is
- When the person presses Import without ticking it
- Then Import is disabled until they tick it, and nothing is written
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-19 · a11y

- Given the Vault page
- When the person uses only the keyboard: Tab to Choose files, Enter, then the dialog's box with Space and Import with
  Enter
- Then the archive comes in
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-20 · a11y

- Given the Vault page empty, Import these files?, and the page with an import
- When axe checks each
- Then none has a serious or critical violation
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-21 · browser

- Given a browser in dark mode, 390 pixels wide, as a phone
- When the person opens the Vault page and imports the archive
- Then the page scrolls only up and down, and has no serious accessibility violation in dark colors
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-22 · persistence

- Given an archive imported on the Vault page
- When the person reloads the dashboard, and opens the Vault page in a second tab
- Then both show the import in Imports and the archive in Your sources
- Test: apps/web/e2e/extension/vault.spec.ts

## S425-23 · persistence

- Given Settings › Vault reminders, on by default
- When the person turns it off and reloads
- Then it is still off
- Test: apps/web/e2e/extension/vault.spec.ts

---
task: 300
title: Move your data to a new Xomoni
feature: move-your-data
---

# Move your data to a new Xomoni

Chrome keeps each copy of Xomoni's data apart, so a person moving to a new Xomoni, such as the store's version, brings their data along in one file (#300, [ADR-0032](../adr/0032-move-data-between-xomoni-versions.md)): *Export everything* in Settings › *Move your data* saves it in Downloads, and *Import from a file* in the new Xomoni, or *Import your data* on its first run, checks all of it, shows what it holds, and adds it to what is there once the person confirms. The file never leaves the computer; a file that isn't whole, or isn't Xomoni's, is refused with nothing imported; an import never deletes, never starts anything on X, and never lets a file make Xomoni faster or lift a stop. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in real browsers on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, whose two posts are from 2020 and 2021. The Xomoni the person leaves is the test's own; the new one is a fresh install in a browser of its own (`newXomoni` in `apps/web/e2e/support/extension.ts`). A hand-made file is the exported one changed in the test, with its checksum written again where the scenario is about a file that is whole but not what Xomoni writes. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-300
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S300-01 · happy

- Given a person whose Xomoni has a copy of their account, @xomoni_fixture, and its 2 posts
- When they press Export everything in Settings › Move your data
- Then the browser saves xomoni-export-<today>.json, and a toast says Saved xomoni-export-<today>.json. It stays on your
  computer: Xomoni never sends it anywhere.
- And the file says it is xomoni-export, version 2, from this Xomoni's version, exported a moment ago, with a sha256
  checksum of its header and data that matches
- And it holds the 15 tables a move carries, the 11 of version 1 and the vault's 4 (#424), the account with its name,
  and the 2 posts
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-02 · happy

- Given that file, and a new Xomoni on its first run, which offers Coming from another Xomoni?
- When the person presses Import your data and picks the file
- Then Import this data? says From Xomoni <version>, exported <day>. The file is complete: its checksum matches., and
  lists @xomoni_fixture: 2 posts, replies and reposts · 0 likes · 0 jobs · 0 log entries
- And once they press Import, the dashboard turns to Home for @xomoni_fixture, with no X window opened
- And Your data is here says Imported from Xomoni <version>. Added … records and updated 0 with newer copies. Nothing
  was replaced with less or deleted, and nothing started on X.
- And Home counts 2 posts, and the Library lists both, newest first
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-03 · happy

- Given a new Xomoni that already knows the account by its handle, from its own X window
- When the person imports the file from Settings › Move your data › Import from a file
- Then the result says Added … records and updated 1 with newer copies: the account here is newer, and the file fills
  in what it didn't know yet, such as the name Fixture Person in the sidebar
- And the Library lists the 2 posts
- And importing the same file again says Everything in the file was already here, and the Library still lists 2
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-04 · happy

- Given a Xomoni where the person turned active hours off and set Custom pacing with 100 deletes a day
- When they export, and import the file in a new Xomoni with no settings of its own
- Then its Settings show active hours off, Custom, and 100 a day for Delete posts & replies
- And in another new Xomoni where the person had set active hours from 9:00 first, the import keeps theirs: active
  hours on, from 9, on Careful
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-05 · invalid

- Given a new Xomoni on its first run
- When the person picks a JSON file that isn't an export, such as {"posts":["hello"]}
- Then the alert Not imported says This isn’t a file from Xomoni’s Export everything. Nothing was imported.
- And no confirmation opens, and the welcome page still offers the import
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-06 · invalid

- Given an exported file whose posts' text was changed by hand afterwards
- When the person picks it in a new Xomoni
- Then the alert says This file was changed or damaged after it was exported: its checksum doesn’t match. Export again
  from the Xomoni you’re leaving. Nothing was imported.
- And no confirmation opens, and the new Xomoni still shows its welcome page
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-07 · invalid

- Given a file that says it is version 2 of the format, from a newer Xomoni, with a checksum that matches
- When the person picks it in Import from a file
- Then the alert says This file was made by a newer Xomoni. Update this Xomoni first, then import it. Nothing was
  imported.
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-08 · invalid

- Given the Export everything file of Xomoni 0.4 and older: no format, the accounts and items at the top
- When the person picks it in Import from a file
- Then the alert says This file comes from an older Xomoni’s Export everything, which doesn’t hold all a move needs.
  Update the Xomoni you’re leaving, export again, and import the new file.
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-09 · invalid

- Given a whole file, its checksum written again, in which one of the two posts has an id X never gives
- When the person picks it in a new Xomoni
- Then the alert says A record in this file isn’t in the shape Xomoni writes. It was changed after it was exported, or
  made by another tool. Nothing was imported.
- And the good post isn't imported either: the new Xomoni still shows its welcome page
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-10 · invalid

- Given a whole file, its checksum written again, with a table Xomoni doesn't have (passwords)
- When the person picks it in Import from a file
- Then the alert says This file holds data Xomoni doesn’t know. It was changed after it was exported, or made by
  another tool. Nothing was imported.
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-11 · error

- Given an exported file whose copy stopped halfway, so only the first half of its text is there
- When the person picks it in a new Xomoni
- Then the alert says This isn’t a file from Xomoni’s Export everything. Nothing was imported.
- And the new Xomoni still shows its welcome page
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-12 · error

- Given a Xomoni with the account's 2 posts, and X out of reach from both browsers: every request to x.com fails
- When the person exports, and imports the file in a new Xomoni
- Then the file holds the 2 posts, the import says Your data is here, and the Library lists both: a move never needs X
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-13 · error

- Given a cleanup job running in one dashboard tab, waiting for active hours
- When the person imports a file from Settings in a second dashboard tab, where no job runs, and confirms
- Then the alert says A job is running. Pause it, then import. Nothing was imported.
- And no result says Your data is here
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-14 · invalid

- Given a cleanup job running in this dashboard tab, waiting for active hours
- When the person opens Settings › Move your data
- Then Import from a file is off, and the card says Import waits until no job runs: pause it first.
- And once they pause the job under Activity, Import from a file is on again, and the note is gone
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-15 · security

- Given a Xomoni with the account's 2 posts, its X window open
- When the person exports, and imports the file in a new Xomoni
- Then neither browser sends a single request while it does: nothing to x.com, xomoni.com or anywhere else, only the
  dashboard's own files from inside the extension
- And the new Xomoni's Library lists the 2 posts
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-16 · security

- Given a cleanup job that hadn't finished, waiting for active hours, in the exported file
- When the person imports it in a new Xomoni
- Then Import this data? counts 1 jobs, and says Jobs that hadn’t finished arrive ended, and nothing starts on X.
- And Activity has no open job; under All, the job says Moved from another Xomoni before it finished. Start a new one
  here to go on: it skips what is already done., with no Resume
- And no X window opened, and nothing was asked of X
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-17 · security

- Given a Xomoni where the person read and accepted the risks before a cleanup
- When they export, import the file in a new Xomoni, and start a cleanup of the 2 posts there
- Then the file holds no consent, and the new Xomoni asks for it again: the risks dialog, Type I UNDERSTAND to continue
- And until the person accepts, nothing starts: no X window opens
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-18 · security

- Given a whole file, its checksum written again, whose settings ask for Custom pacing of deletes 1 to 2 s apart, 5,000
  an hour and 100,000 a day, with active hours off
- When the person imports it in a new Xomoni
- Then Settings show Custom, but no faster than Careful: Delete posts & replies at 80 s at least and 960 a day at most,
  within one fifth of X's limits
- And the rest of the settings come as they were: active hours off
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-19 · security

- Given a whole file, its checksum written again, that carries a xomoni.com connection (cloud) with another account's
  device token
- When the person picks it in a new Xomoni
- Then the alert says This file holds data Xomoni doesn’t know. It was changed after it was exported, or made by
  another tool. Nothing was imported.
- And the new Xomoni still shows its welcome page: no file can connect it to anyone's xomoni.com account
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-20 · empty

- Given a new Xomoni on its first run, with no account yet
- When the person looks at the welcome page
- Then it offers Coming from another Xomoni?, with Import your data and Not now
- And once they press Not now, the offer is gone, and stays gone after a reload
- And Settings › Move your data still has Import from a file, once Xomoni knows the account
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-21 · empty

- Given a whole file, its checksum written again, in which every table is empty
- When the person picks it in Import from a file
- Then the alert says This file holds no Xomoni data. Nothing was imported.
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-22 · cancel

- Given a new Xomoni, and Import this data? open over the welcome page with the file's summary
- When the person presses Cancel
- Then the dialog closes, nothing is imported, and the welcome page still offers the import
- And picking the file again opens the dialog again, and Escape closes it the same way, with no result shown
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-23 · cancel

- Given a new Xomoni whose Home says Your data is here after an import
- When the person presses Dismiss
- Then the result is gone, and the offer doesn't come back: this Xomoni has done something now
- And after a reload neither shows on Home, nor the result in Settings
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-24 · a11y

- Given a person using only the keyboard
- When they Tab to Export everything and press Enter, then in a new Xomoni Tab to Import your data, press Enter and pick
  the file
- Then the browser saves the file, and Import this data? opens with the focus on Import
- And Enter imports, and Space on Dismiss, reached with Tab, puts the result away
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-25 · a11y

- Given Settings › Move your data
- When the person picks a file that isn't JSON, then the exported file, then imports it
- Then the card, the alert Not imported, the dialog and the result have no serious accessibility violation
- And the refusal is an alert, read out at once, and goes once a good file is picked; the result is a status
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-26 · browser

- Given a new Xomoni in a browser set to dark mode
- When the person imports their file from the first-run offer
- Then the offer, Import this data? and Your data is here have no serious accessibility violation in dark colors
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-27 · persistence

- Given a new Xomoni into which the person imported their file
- When they reload the dashboard, and open it in a second tab
- Then Home still says Your data is here and counts 2 posts, and the second tab's Settings show the result too
- And the second tab's Library lists the 2 posts, and its activity log says Moved in from Xomoni <version> (exported …)
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-28 · security

- Given a job X stopped by showing its notice of a limited account, Resume locked for 12 hours, and the person resumed
  anyway by typing RESUME
- When they export, and import the file in a new Xomoni
- Then the file holds that override, and the new Xomoni doesn't take it: Home says Resting after a warning from X, and
  Xomoni can carry on in 11 to 12 hours, at a slower pace
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-29 · persistence

- Given a file that carries the vault (#424, ADR-0032 as amended for version 2): a row of the import ledger, X's
  analytics of a post and of a day, an entry of the account's timeline with markup in its words, and a month of X's
  Under the hood report with markup in a label's meaning (#428)
- When the person imports it in a new Xomoni, and reloads the dashboard
- Then Export everything in that Xomoni writes the same ledger row, the same analytics, the same timeline entry and
  the same month, their words kept as text
- Test: apps/web/e2e/extension/move-your-data.spec.ts

## S300-30 · happy

- Given a file from a Xomoni before the vault, version 1 with its 11 tables, as Xomoni 0.5 writes it
- When the person imports it in a new Xomoni
- Then Import this data? lists @xomoni_fixture with its 2 posts, the import adds them, and the Library lists both
- And Export everything there writes version 2, with the vault's tables empty
- Test: apps/web/e2e/extension/move-your-data.spec.ts

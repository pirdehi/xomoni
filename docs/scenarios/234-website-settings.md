---
task: 234
title: Xomoni's settings on xomoni.com: user scenarios
feature: website-settings
---

# Xomoni's settings on xomoni.com

xomoni.com's Settings place shows Xomoni's settings, read from Xomoni in the same browser, and changes the few the website may: pacing back to Careful (never faster), active hours, the failures in a row before a job pauses, notifications, keeping going while away, and the active X account's Watch searches (#234, [ADR-0029](../adr/0029-xomoni-settings-from-the-website.md)). Xomoni applies each change through its own rules and answers what it stored, which the page then shows. Each change is written to Xomoni's log. Written for #345, the features shipped before the scenarios gate.

The tests run on both sides:

- **xomoni.com** (`apps/web/e2e/website-settings.spec.ts`): the website against the local stack, with Xomoni played at the page. Xomoni signs in with the site's code through `pair_device`, keeps its settings, applies each change as a test says, and records every message.
- **Xomoni** (`apps/web/e2e/extension/website-settings.spec.ts`): the built extension in a real browser, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)). xomoni.com is played at it, sending what the website sends.

Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-234
npm run test:e2e:extension -w @xomoni/web -- --grep @task-234
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S234-01 · happy

- Given a person signed in, with Xomoni in this browser at a custom pace
- When they open Settings
- Then it shows what Xomoni has: the pace, Custom, with its table, active hours from 8 until 23, two failures before a
  pause, notifications and keeping going while away on, and the searches of @ada
- Test: apps/web/e2e/website-settings.spec.ts

## S234-02 · happy

- Given a custom pace
- When the person presses Back to Careful
- Then Xomoni gets that one change and the pace shows Careful, with no Back to Careful left, and the page says it is
  saved in Xomoni and a running job keeps its settings until it is paused and resumed
- Test: apps/web/e2e/website-settings.spec.ts

## S234-03 · happy

- Given active hours from 8 until 23
- When the person sets them from 9, then until 22, then turns them off
- Then Xomoni gets each change in turn, with the hours it already has
- Test: apps/web/e2e/website-settings.spec.ts

## S234-04 · happy

- Given Settings
- When the person chooses one failure before a pause, then turns notifications and keeping going while away off
- Then Xomoni gets each change in turn
- Test: apps/web/e2e/website-settings.spec.ts

## S234-05 · happy

- Given the searches of @ada
- When the person edits the second, adds a third and presses Save searches
- Then Xomoni gets the searches together, trimmed, and there is nothing left to save
- Test: apps/web/e2e/website-settings.spec.ts

## S234-06 · invalid

- Given a search
- When the person types 110 characters
- Then it keeps 100: a search can't be longer
- Test: apps/web/e2e/website-settings.spec.ts

## S234-07 · invalid

- Given two searches
- When the person adds three more
- Then there are five, and Add a search is gone: five is the most
- Test: apps/web/e2e/website-settings.spec.ts

## S234-08 · error

- Given a Xomoni that doesn't take a change
- When the person turns notifications off
- Then the page says Xomoni didn't take that change, so nothing changed, and the switch is as before
- Test: apps/web/e2e/website-settings.spec.ts

## S234-09 · security

- Given a Xomoni signed in to another account, which refuses
- When the person changes a setting
- Then the page says Xomoni in this browser isn't signed in to this account, so nothing changed
- Test: apps/web/e2e/website-settings.spec.ts

## S234-10 · error

- Given a Xomoni that doesn't answer a change
- When the person turns notifications off
- Then the page says Xomoni didn't answer, so nothing changed, and to open it and try again; the switch is as before
- Test: apps/web/e2e/website-settings.spec.ts

## S234-11 · error

- Given a Xomoni older than the page
- When the person opens Settings
- Then it says their Xomoni can't show its settings here yet
- Test: apps/web/e2e/website-settings.spec.ts

## S234-12 · security

- Given a custom pace
- When the person looks for a way to make Xomoni faster
- Then the table only shows the pace, with nothing to type in, custom pacing is set in Xomoni, and only Back to
  Careful goes to Xomoni, with no pace in any change; nothing but reads and changes reaches Xomoni
- Test: apps/web/e2e/website-settings.spec.ts

## S234-13 · security

- Given a search only the person knows
- When they save it
- Then it goes only to Xomoni in this browser: no request to a server carries it
- Test: apps/web/e2e/website-settings.spec.ts

## S234-14 · security

- Given a Xomoni whose rules keep at least two failures before a pause
- When the person chooses one
- Then the page shows two, what Xomoni stored, not what it asked for
- Test: apps/web/e2e/website-settings.spec.ts

## S234-15 · empty

- Given a Xomoni that knows no X account yet
- When the person opens Settings
- Then the searches card says Xomoni doesn't know an X account yet, to open X in Xomoni first, with nothing to edit
- Test: apps/web/e2e/website-settings.spec.ts

## S234-16 · empty

- Given a browser without Xomoni
- When the person opens Settings
- Then it says Xomoni's settings live in Xomoni and change only there, the numbers choice is still there, and Open in
  Xomoni opens the dialog that Xomoni isn't installed
- Test: apps/web/e2e/website-settings.spec.ts

## S234-17 · cancel

- Given a search changed
- When the person changes it back
- Then there is nothing to save, and nothing went to Xomoni
- Test: apps/web/e2e/website-settings.spec.ts

## S234-18 · cancel

- Given a search added and typed
- When the person removes it before saving
- Then there is nothing to save, and nothing went to Xomoni
- Test: apps/web/e2e/website-settings.spec.ts

## S234-19 · a11y

- Given Settings
- When the person uses only the keyboard: Tab to Desktop notifications, then Space
- Then notifications are off, in Xomoni
- Test: apps/web/e2e/website-settings.spec.ts

## S234-20 · a11y

- Given Settings with Xomoni's settings
- When it is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/website-settings.spec.ts

## S234-21 · browser

- Given an iPhone
- When the person presses Open in Xomoni in Settings
- Then the dialog says Xomoni runs on a computer, with Send to my computer (and CI's e2e-edge runs every scenario in
  Microsoft Edge)
- Test: apps/web/e2e/website-settings.spec.ts

## S234-22 · persistence

- Given keeping going while away turned off
- When the person reloads Settings
- Then it is read again from Xomoni, still off, the rest as Xomoni has it
- Test: apps/web/e2e/website-settings.spec.ts

## S234-23 · happy

- Given Settings
- When the person turns notifications off and keeping going while away off, one right after the other
- Then both changes reach Xomoni, both stay, and Xomoni holds both
- Test: apps/web/e2e/website-settings.spec.ts

## S234-24 · happy

- Given settings Xomoni changed meanwhile
- When the person presses Read again
- Then the page shows them as Xomoni has them now
- Test: apps/web/e2e/website-settings.spec.ts

## S234-25 · happy

- Given Xomoni signed in from xomoni.com, with an X account
- When the page reads its settings
- Then Xomoni answers the pace of each of its five actions, the active hours, the failures before a pause, and
  @xomoni_fixture's searches
- Test: apps/web/e2e/extension/website-settings.spec.ts

## S234-26 · happy

- Given Xomoni signed in from xomoni.com
- When the page sets active hours from 9 until 22 and notifications off
- Then Xomoni answers them as stored, reads them back so, and its log says the settings changed on xomoni.com, naming
  both
- Test: apps/web/e2e/extension/website-settings.spec.ts

## S234-27 · invalid

- Given Xomoni signed in from xomoni.com
- When a page asks for a custom or a faster pace, pace numbers, ten failures, an hour 25, six searches, or no change
- Then Xomoni refuses each as invalid, its settings unchanged; Careful is the only pace it takes from a page
- Test: apps/web/e2e/extension/website-settings.spec.ts

## S234-28 · security

- Given Xomoni signed in from xomoni.com
- When a page names another account's device in a read or a change
- Then Xomoni refuses both as another account's, and nothing changes
- Test: apps/web/e2e/extension/website-settings.spec.ts

## S234-29 · security

- Given Xomoni that was never signed in to xomoni.com
- When a xomoni.com page reads or changes its settings
- Then Xomoni refuses both: not connected
- Test: apps/web/e2e/extension/website-settings.spec.ts

## S234-30 · happy

- Given Xomoni signed in from xomoni.com, with an X account
- When the page sets the searches #rust and open source
- Then they are the active account's searches, and Xomoni's Watch shows them
- Test: apps/web/e2e/extension/website-settings.spec.ts

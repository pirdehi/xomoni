---
task: 134
title: Keep a job going while the person does other things
feature: keeps-going
---

# Keeps going while you do other things

Chrome stops drawing a page it doesn't show, so a job needs its X window on screen (#118, PLAYBOOK F5). Two things keep it going while the person does something else (#134, #140, [ADR-0020](../adr/0020-run-hidden-by-sharing-the-x-tab.md)). *Keep going while I’m away*, on by default, keeps the display on while a job runs. Once the person has been away two minutes, it also brings a covered X window forward. *Run hidden* shares the X tab with the dashboard, so Chrome draws it even with the X window minimized. Nothing of the shared tab is read, stored or sent. While the X window is hidden all the same, the job waits for it, says so and goes on by itself. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`). Some of what they need only Chrome and the computer know, so the spec plays it at the page, never in Xomoni's code:

- Headless Chrome draws every page as if on screen. A test makes the X window look hidden to Xomoni's content script by redefining `document.hidden` in the script's own world, through Chrome's DevTools protocol, as Chrome reports a minimized or covered window.
- Whether the person is away (`chrome.idle`) and the display (`chrome.power`) are played and watched in the dashboard, where Xomoni asks them.
- Chrome's picker, which Playwright can't answer, is played in the dashboard. It gives a stream from a blank canvas that says which surface was chosen, records what Xomoni asked it for, and notes anything that reads the stream's frames.

Each test is a fresh install, with active hours off, so a job may run at any time of day. The engine's side, the five seconds on screen, the five minutes between two raises, the day it waits at most, is proven by `apps/extension/tests/hidden-worker.test.ts`, `runner.test.ts`, `presence.test.ts`, `tab-share.test.ts` and `ui/app.test.tsx`. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep "@task-134(\s|$)"
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S134-01 · happy

- Given a person with an X account in Xomoni, on Settings
- When they look at Schedule & safety
- Then Keep going while I’m away is on, and says: Keeps the display on while a job runs. After two minutes without
  keyboard or mouse, a covered X window comes forward and the job continues. On a locked screen it waits.
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-02 · happy

- Given Keep going while I’m away on
- When the person starts a cleanup, and then pauses it
- Then Xomoni asks Chrome to keep the display on while the job runs
- And lets it go once the job is paused
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-03 · happy

- Given a running cleanup, whose banner says to keep part of the X window on screen, or run it hidden
- When the person presses Run hidden and shares the X tab in Chrome's picker
- Then Xomoni says Running hidden: you can minimize or cover the X window now. Xomoni doesn’t record or send it.
- And the banner says Running hidden: the X window may be minimized or covered, with Stop running hidden, while the
  job goes on
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-04 · happy

- Given a cleanup started while the X window is hidden, minimized or covered
- When the job looks at the X window
- Then it waits: Xomoni needs its X window on screen to continue “Delete posts older than Jan 1, 2021”, The X window is
  hidden, and Chrome pauses pages it doesn’t show…, with Run hidden first
- And the sidebar says Keep the X window visible, the card Needs you, Home Keep the X window on screen, and a desktop
  notification asks for it
- And once the window is on screen again, the job goes on by itself: X is ready again — continuing
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-05 · happy

- Given a cleanup waiting for its hidden X window, and the person away from the computer, as Chrome tells Xomoni
- When the job looks at the window again and again
- Then it brings the X window forward, and its log says You’re away: brought the X window forward to continue
- And it does so once, not at every look: at most every five minutes
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-06 · happy

- Given a cleanup waiting for its hidden X window
- When the person presses the alert's Run hidden and shares the X tab, which Chrome then draws as if on screen
- Then the job goes on by itself, running hidden, with Stop running hidden in its banner
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-07 · happy

- Given a person on a 1440 × 900 screen
- When they open the X window
- Then it is a popup window of its own, asked for at 500 × 760 in the screen's bottom-right corner, out of their way
  (#138); headless Chrome keeps its own window size, so the test checks the place, which only that size gives
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-08 · invalid

- Given a running cleanup
- When the person presses Run hidden and chooses a window, not a tab, in Chrome's picker
- Then Xomoni stops sharing it at once: Choose a Chrome tab: the X tab in the small X window.
- And Run hidden is offered again
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-09 · invalid

- Given a cleanup waiting for its hidden X window
- When the person shares another tab than the X window's, so the X window stays hidden
- Then 15 seconds later Xomoni stops sharing it: The shared tab wasn’t the X window’s, so Xomoni stopped sharing it.
  Press Run hidden and choose the tab in the small X window.
- And the alert offers Run hidden again
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-10 · invalid

- Given Keep going while I’m away turned off in Settings
- When a cleanup waits for its hidden X window while the person is away
- Then nothing brings the window forward, and Xomoni never asks Chrome to keep the display on
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-11 · invalid

- Given a cleanup waiting for its hidden X window, and the computer's screen locked
- When the job looks at the window again and again
- Then it brings nothing forward, since a locked screen shows no window, and keeps waiting: Needs you
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-12 · error

- Given a running cleanup, in a browser that can't share a tab
- When the person presses Run hidden
- Then Xomoni says This browser can’t share a tab. Keep part of the X window on screen instead.
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-13 · error

- Given a cleanup running hidden
- When the person presses Chrome's own Stop sharing
- Then the banner offers Run hidden again, and asks to keep part of the X window on screen
- And the job goes on as before
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-14 · error

- Given a running cleanup
- When Chrome's picker fails to start, Could not start video source
- Then Xomoni says so, shares nothing, and offers Run hidden again
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-15 · error

- Given a cleanup waiting for its hidden X window, which nobody shows
- When a day has passed
- Then the job pauses: Waited a day for you. The X window is hidden… Then resume the job.
- Manual: the wait is a day on a timer in a dedicated worker, which Playwright's clock doesn't reach.
  apps/extension/tests/hidden-worker.test.ts proves the day and the pause (waits a day for a hidden window, not an hour,
  then pauses the job)

## S134-16 · security

- Given a running cleanup
- When the person presses Run hidden
- Then Chrome's picker is asked for tabs only, never the dashboard itself, a whole screen or another surface, with no
  audio, at one 64-pixel frame a second at most
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-17 · security

- Given a cleanup running hidden
- When Chrome hands Xomoni the shared tab's frames
- Then nothing reads them: no video element shows the stream, and no frame is captured or processed
- And nothing is sent to any host but x.com
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-18 · security

- Given a cleanup running hidden
- When the person pauses it
- Then the sharing ends with the job: Chrome's stream is stopped, and the banner goes
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-19 · empty

- Given no job running, the X window covered, and the person away
- When some seconds pass
- Then nothing is asked of them: the sidebar says X window ready, no alert, no Run hidden
- And Xomoni never asks Chrome to keep the display on
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-20 · empty

- Given a person with an X account in Xomoni and no job yet
- When they open Activity
- Then it says No open jobs, with no banner and no Run hidden, and nothing holds the display
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-21 · cancel

- Given a cleanup running hidden
- When the person presses Stop running hidden
- Then the sharing ends, the banner offers Run hidden again, and the job goes on
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-22 · cancel

- Given a running cleanup
- When the person presses Run hidden, then closes Chrome's picker
- Then nothing changes: nothing is shared, nothing is said, and Run hidden stays
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-23 · cancel

- Given a cleanup waiting for its hidden X window, with its desktop notification
- When the person presses the alert's Pause
- Then the job is paused, Paused by you., the alert and the notification go, and the display is let go
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-24 · a11y

- Given a running cleanup and someone using only the keyboard
- When they Tab to Run hidden and press Enter, then Tab to Stop running hidden and press Enter, then Tab to Keep going
  while I’m away in Settings and press Space
- Then the X tab is shared, then no longer, and the switch turns off
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-25 · a11y

- Given a cleanup waiting for its hidden X window, then running hidden
- When axe checks the dashboard in each state
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-26 · browser

- Given the system in dark mode
- When a cleanup waits for its hidden X window, then runs hidden
- Then the alert and the banner have no serious or critical violation (and Edge, as CI's e2e-edge runs every scenario)
- Test: apps/web/e2e/extension/keeps-going.spec.ts

## S134-27 · persistence

- Given Keep going while I’m away turned off
- When the person reloads the dashboard and starts a cleanup
- Then the switch is still off, and the job runs without asking Chrome to keep the display on
- Test: apps/web/e2e/extension/keeps-going.spec.ts

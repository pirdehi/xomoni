---
task: 251
title: Xomoni's actions on xomoni.com: user scenarios
feature: website-actions
---

# Xomoni's actions on xomoni.com

xomoni.com's job cards have Pause, Cancel and Resume, and its places have Open in Xomoni (#251, [ADR-0027](../adr/0027-extension-actions-from-the-website.md)):

- **The action goes to Xomoni** in the same browser, through Chrome's own channel. Xomoni acts only for the device it is signed in as, so another account in the browser gets nothing done.
- **Pause and Cancel** stop work, so they apply at once.
- **Resume never runs anything.** It opens Xomoni with its own request, and only the person's yes there starts the job, with the checks every start has ([ADR-0006](../adr/0006-website-is-view-only.md)).
- **When Xomoni can't act from the page**, a dialog says why and what to do: it isn't installed, the browser is a phone, it is signed in elsewhere, or the job runs in another browser.

Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: closing the dialog with Escape or *Close* left the keyboard focus nowhere; it now goes back to the button that opened it (S251-18).

The tests run on both sides:

- **xomoni.com** (`apps/web/e2e/website-actions.spec.ts`): the website against the local stack, with Xomoni played at the page. Xomoni signs in with the site's code through `pair_device`, reports its jobs with `device_report`, and answers each action as the extension does, or as a test says.
- **Xomoni** (`apps/web/e2e/extension/website-actions.spec.ts`): the built extension in a real browser, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)). xomoni.com is played at it, sending what the website sends. A job is the Library's *Complete my copy*, a read that changes nothing on X.

Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-251
npm run test:e2e:extension -w @xomoni/web -- --grep @task-251
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S251-01 · happy

- Given a person signed in on xomoni.com, with Xomoni in this browser running a job
- When they press the job's Pause in Activity
- Then Xomoni gets a pause for that job, by its id in Xomoni and this browser's device, and the page says Pausing: the
  job stops after the action in progress
- Test: apps/web/e2e/website-actions.spec.ts

## S251-02 · happy

- Given a running job
- When the person presses its Cancel
- Then Xomoni gets a cancel for that job, and the page says Cancelling: the job stops after the action in progress
- Test: apps/web/e2e/website-actions.spec.ts

## S251-03 · happy

- Given a paused job, which offers Resume and Cancel
- When the person presses Resume
- Then Xomoni gets a resume, and the page says Xomoni opened on this computer, to choose Resume there: nothing runs
  until they do
- Test: apps/web/e2e/website-actions.spec.ts

## S251-04 · happy

- Given Content on xomoni.com, which says the posts themselves are in Xomoni
- When the person presses Open in Xomoni
- Then Xomoni gets an open of its Library, and the page says Xomoni opened on this computer
- Test: apps/web/e2e/website-actions.spec.ts

## S251-05 · happy

- Given a paused job
- When the person presses its Cancel
- Then the page says The job is cancelled
- Test: apps/web/e2e/website-actions.spec.ts

## S251-06 · invalid

- Given a job that has ended
- When the person looks at its card in Activity
- Then it offers no Pause, Cancel or Resume
- Test: apps/web/e2e/website-actions.spec.ts

## S251-07 · invalid

- Given a job running in another browser of the account, Edge on Windows
- When the person presses its Pause here
- Then a dialog says This job runs in another browser, in Edge on Windows, and to open xomoni.com there, and nothing
  goes to this browser's Xomoni
- Test: apps/web/e2e/website-actions.spec.ts

## S251-08 · error

- Given a job Xomoni no longer has
- When the person presses its Pause
- Then the page says Xomoni in this browser doesn't have this job any more
- Test: apps/web/e2e/website-actions.spec.ts

## S251-09 · error

- Given a job that stopped since the page showed it running
- When the person presses its Pause
- Then the page says The job isn't running, so there is nothing to pause
- Test: apps/web/e2e/website-actions.spec.ts

## S251-10 · error

- Given a job that ended since the page showed it paused
- When the person presses its Resume
- Then the page says The job has already ended
- Test: apps/web/e2e/website-actions.spec.ts

## S251-11 · security

- Given Xomoni in this browser signed in to another account, which refuses
- When the person presses a job's Pause
- Then the page says Xomoni in this browser isn't signed in to this account
- Test: apps/web/e2e/website-actions.spec.ts

## S251-12 · security

- Given a paused and a running job
- When the person resumes one and pauses the other
- Then Xomoni receives only hellos, the sign-in and the two job actions, each a pause, cancel or resume with the job and
  device only: nothing starts, resumes or approves work from the page
- Test: apps/web/e2e/website-actions.spec.ts

## S251-13 · security

- Given a running job
- When the person pauses it
- Then no request to any server carries the action or the job: it goes only to Xomoni in this browser
- Test: apps/web/e2e/website-actions.spec.ts

## S251-14 · empty

- Given a browser without Xomoni
- When the person presses Open in Xomoni
- Then a dialog says they haven't installed Xomoni yet, that its actions run in the extension on this computer, with
  Install Xomoni leading to /install
- Test: apps/web/e2e/website-actions.spec.ts

## S251-15 · error

- Given that dialog, and still no Xomoni
- When the person presses I've installed it
- Then the dialog says Xomoni isn't linked to this page yet, and to press Connect to xomoni.com in Xomoni once
- Test: apps/web/e2e/website-actions.spec.ts

## S251-16 · empty

- Given Xomoni with no job yet
- When the person opens Activity
- Then there is no job action anywhere
- Test: apps/web/e2e/website-actions.spec.ts

## S251-17 · cancel

- Given the dialog that Xomoni isn't installed
- When the person presses Close
- Then it closes, and Open in Xomoni is there to press again
- Test: apps/web/e2e/website-actions.spec.ts

## S251-18 · cancel

- Given that dialog, opened with Open in Xomoni
- When the person presses Escape
- Then it closes, and the focus goes back to Open in Xomoni, so the keyboard carries on from there
- Test: apps/web/e2e/website-actions.spec.ts

## S251-19 · a11y

- Given a running job in Activity
- When the person uses only the keyboard: Tab to its Pause, then Enter
- Then the pause goes to Xomoni once, and its answer shows
- Test: apps/web/e2e/website-actions.spec.ts

## S251-20 · a11y

- Given the dialog that Xomoni isn't installed
- When it is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/website-actions.spec.ts

## S251-21 · browser

- Given a person signed in on an iPhone
- When they press Open in Xomoni
- Then a dialog says Xomoni runs on a computer and that on this phone they can follow what it does, with Send to my
  computer (and CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/website-actions.spec.ts

## S251-22 · persistence

- Given a running job, paused from the page
- When the person reloads Activity
- Then the answer is gone and the job shows as Xomoni last reported it, with its Pause and Cancel: the page kept nothing
  of the action
- Test: apps/web/e2e/website-actions.spec.ts

## S251-23 · happy

- Given Xomoni signed in from xomoni.com, running Complete my copy
- When a xomoni.com page sends a pause for that job
- Then Xomoni answers that it is stopping, the job turns Paused, and the log says xomoni.com asked to pause it
- Test: apps/web/e2e/extension/website-actions.spec.ts

## S251-24 · happy

- Given a job that is ready but not running
- When a xomoni.com page sends a cancel for it
- Then Xomoni cancels it at once: it leaves the open jobs, its card under All says Cancelled from xomoni.com, and its
  next report tells xomoni.com
- Test: apps/web/e2e/extension/website-actions.spec.ts

## S251-25 · security

- Given a job that is ready but not running
- When a xomoni.com page sends a resume for it
- Then Xomoni answers that it asked, and shows xomoni.com asks to resume a job, naming it: the website can only ask, and
  nothing runs on X until the person chooses Resume; the job stays Ready
- Test: apps/web/e2e/extension/website-actions.spec.ts

## S251-26 · cancel

- Given that request in Xomoni
- When the person presses Not now, then, asked again, presses Resume
- Then Not now leaves the job Ready, and Resume starts it, with the risks to accept as for any start
- Test: apps/web/e2e/extension/website-actions.spec.ts

## S251-27 · security

- Given a job in Xomoni
- When a page names another account's device in a pause, cancel, resume or open
- Then Xomoni refuses each as another account's, and the job is untouched
- Test: apps/web/e2e/extension/website-actions.spec.ts

## S251-28 · invalid

- Given a job that is ready, then cancelled
- When a page pauses a job Xomoni doesn't have, pauses the job that isn't running, and resumes it once it ended
- Then Xomoni answers no job, not running and finished
- Test: apps/web/e2e/extension/website-actions.spec.ts

## S251-29 · happy

- Given Xomoni signed in from xomoni.com
- When a page sends an open of Settings
- Then Xomoni opens its Settings page
- Test: apps/web/e2e/extension/website-actions.spec.ts

## S251-30 · security

- Given Xomoni never signed in to xomoni.com, with a job ready
- When a xomoni.com page sends a pause, cancel or resume
- Then Xomoni refuses each, not connected, and the job is untouched
- Test: apps/web/e2e/extension/website-actions.spec.ts

## S251-31 · security

- Given a job that is ready
- When a page sends a start, an approve, a resume marked confirmed, or an open of a page Xomoni doesn't have
- Then Xomoni refuses each as invalid: there is no action that starts or approves work, and the job is untouched
- Test: apps/web/e2e/extension/website-actions.spec.ts

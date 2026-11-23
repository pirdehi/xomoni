---
task: 143
title: Private by design: user scenarios
feature: private-by-design
---

# Private by design

No telemetry, and the person's posts, likes and copy stay in IndexedDB in their browser profile ([ADR-0004](../adr/0004-x-data-stays-local.md)). An account on xomoni.com is optional. Signed in, only job status goes there, and daily counts only if the person turns them on (ADR-0026). What xomoni.com shows from Xomoni in the same browser goes from the extension to the page and is kept only while the page is open ([ADR-0028](../adr/0028-xomoni-data-on-the-website-in-the-same-browser.md)). Post text, likes and post ids never reach a server. It was built by #143 (the extension's policy and manifest: no network but Xomoni's own, no incognito, no outside messages), #149 (the database: no reason stored, private Realtime) and #233 (what xomoni.com shows from the extension in the same browser), and the file carries the first. Written for #345, the features shipped before the scenarios gate. The job status itself has its own scenarios (#39, your jobs live on xomoni.com).

The scenarios run in two places:

- **The extension** (S143-01 to S143-10, S143-17 to S143-21, S143-26): the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), the made-up `@xomoni_fixture` with years behind it (`xHistory: 'long'`). The harness fails a test that sends anything to a host but x.com, and xomoni.com is played at the extension where a scenario needs it (`apps/web/e2e/support/xomoni-site.ts`), keeping every call Xomoni makes.
- **xomoni.com** (S143-11 to S143-16, S143-22 to S143-25): the website on the local Supabase stack, with its real Auth and database. Xomoni in the same browser is played at the page, through the channel Chrome gives xomoni.com (`externally_connectable`).

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-143   # the extension; no Supabase
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-143             # xomoni.com
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S143-01 · happy

- Given the person opened the X window and browsed their profile's tabs on X
- When they open Home
- Then it says @xomoni_fixture · everything Xomoni knows stays in this browser
- And Xomoni's own database in this browser holds the copy: the posts with their text, the replies, the repost and
  the likes
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-02 · security

- Given the person browsed their posts on X, in their own tab, where Xomoni's content script runs
- When x.com's page looks at the databases it can open
- Then Xomoni's isn't among them, and nothing of the copy is there: it belongs to the extension alone
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-03 · empty

- Given a fresh install, with no account
- When the person goes through every page of the dashboard and reloads it
- Then nothing is sent anywhere, not even to x.com: no telemetry and no update check, only the extension's own files
- And the first run says Your posts and likes stay in this browser. Signed in to xomoni.com, only job status goes
  there, and your daily numbers if you turn them on. (#450)
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-04 · security

- Given Xomoni's dashboard
- When something on it tries to send data to another site, load an image from it, or run its script
- Then Xomoni's content security policy refuses all three: the request fails, and the browser reports each
  violation
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-05 · security

- Given Xomoni installed, and the person browsing their profile on X
- When the page loads
- Then X receives only what X's own page asks for: the page, the profile and its posts, and nothing of Xomoni's
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-06 · empty

- Given Xomoni not signed in to xomoni.com
- When the person browses their profile and goes through every page of the dashboard
- Then nothing at all is sent to xomoni.com, and Settings offers Sign in to xomoni.com
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-07 · security

- Given Xomoni signed in to xomoni.com from a xomoni.com page
- When the person opens Settings
- Then Show my numbers on xomoni.com is off, and says it would never send posts, replies, likes or anyone's name
- And Xomoni reported job status, but sent no daily numbers and asked for none
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-08 · security

- Given Xomoni installed
- When the person opens X in a private (incognito) window
- Then Xomoni doesn't run there: its manifest says not_allowed, and Chrome reports no incognito access, so a private
  window's X never reaches this profile's copy
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-09 · a11y

- Given a fresh install
- When the person reads the first run
- Then Private by design says Your posts and likes stay in this browser, and what reaches xomoni.com once signed in, in
  words, and the page has no serious accessibility violation
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-10 · persistence

- Given the copy of the person's posts in this browser
- When they reload the dashboard, and open the Library in a second tab
- Then both find the same copy, kept in this browser profile
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-11 · security

- Given someone who hasn't signed in to xomoni.com
- When they open the home page, /install, /privacy and /risks
- Then xomoni.com sets no cookie, keeps nothing in the browser's storage, and loads nothing from another site
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-12 · security

- Given a signed-in person
- When they go through Activity, Audience, Reports and Browsers
- Then the pages talk only to xomoni.com and its database, and the only cookies are the session's
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-13 · happy

- Given anyone on xomoni.com
- When they open the privacy policy
- Then its short version says the X password, cookies, posts, replies, likes, archive and log never leave the
  computer, that an account is optional and without one nothing is sent, and that there is no tracking
- And it explains what stays on the computer, and what xomoni.com shows from the extension in the same browser
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-14 · invalid

- Given a browser connected to the person's account
- When a job report also carries a post's text, its id, likes, and a reason quoting that text
- Then the report is taken, Activity shows the job, and the text shows nowhere
- And the job's row in the database has only status: no text, no post id, no likes, and an empty reason
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-15 · security

- Given Xomoni in this browser, signed in with the person
- When they open the Library on xomoni.com
- Then it lists the post Xomoni sent the page, and its words are in no request to any server and in no storage of
  the site
- And after a reload the page asks Xomoni again: it kept nothing
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-16 · a11y

- Given the privacy policy
- When someone moves through it by its headings
- Then there is the page's title and a heading per part, and no serious accessibility violation
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-17 · security

- Given Xomoni installed, and the person on x.com
- When x.com's page looks for a way to ask Xomoni for anything
- Then there is none: only xomoni.com may send Xomoni a message, and Chrome gives x.com's page no channel
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-18 · invalid

- Given Xomoni signed in to xomoni.com, with the person's copy
- When a xomoni.com page asks for something of no shape Xomoni knows: everything, extra fields, a negative page, an
  export
- Then each is refused as invalid, with nothing of the copy
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-19 · invalid

- Given Xomoni with the person's copy
- When a xomoni.com page asks for the Library before Xomoni is signed in, and then for another account's browser
- Then the first is refused as not connected, the second as another account
- And only a page naming this browser gets the copy, straight to the page: nothing of it reaches xomoni.com's
  servers
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-20 · cancel

- Given the copy of the person's posts in this browser
- When they sign out of Xomoni with Remove @xomoni_fixture's data from this browser
- Then the signed-out page shows, and the copy is gone from this browser's database
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-21 · error

- Given Xomoni with the person's copy, not signed in
- When a xomoni.com page signs it in with a code xomoni.com refuses
- Then Xomoni answers bad_code and stays signed out: Settings offers Sign in to xomoni.com
- And the one call it made was that refused sign-in: nothing else is sent, then or later
- Test: apps/web/e2e/extension/private-by-design.spec.ts

## S143-22 · browser

- Given a phone, 390 pixels wide
- When someone opens the privacy policy
- Then it reads with nothing to scroll sideways, the short version on screen (and CI's e2e-edge runs every scenario
  in Microsoft Edge)
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-23 · cancel

- Given a signed-in person with a browser connected and a job reported
- When they delete their account, typing DELETE in the dialog that says their browsers and job history go and
  nothing on X is deleted
- Then the account's browsers and jobs are gone from the database, and the browser's token is refused
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-24 · error

- Given a signed-in person in a browser without Xomoni
- When they open the Library on xomoni.com
- Then it says the Library is read from Xomoni on the computer and never reaches xomoni.com's servers, and where to
  open it
- And the page asks no server for it, nor any other site
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-25 · error

- Given Xomoni in this browser, which the person has since signed out of
- When they open the Library on xomoni.com and Xomoni refuses the read
- Then the page says Xomoni didn't answer, to open it and try again, and shows none of the copy, nor keeps any
- Test: apps/web/e2e/private-by-design.spec.ts

## S143-26 · happy

- Given the copy of the person's posts
- When they press Export JSON in the Library
- Then the file downloads, named xomoni-posts-present-<today>.json, made on this computer: nothing is fetched to make
  it
- Test: apps/web/e2e/extension/private-by-design.spec.ts

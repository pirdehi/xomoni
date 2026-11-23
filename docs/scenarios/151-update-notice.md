---
task: 151
title: Hear about new versions: user scenarios
feature: update-notice
---

# Hear about new versions

A browser signed in to xomoni.com hears, in the answer to each status report, whether a newer Xomoni is out and whether it fixes a security problem (#151). The dashboard then says so above every page, links to the release, and lets the person dismiss the notice, unless the release fixes a vulnerability. The answer comes from the releases xomoni.com's database keeps (`extension_releases`), which no one else can read. Updating in one click has its own scenarios (#305). Written for #345, the features shipped before the scenarios gate.

The scenarios run in two places:

- **The extension** (S151-01 to S151-13, S151-20, S151-21): the built extension in a real browser ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), with xomoni.com played at it (`apps/web/e2e/support/xomoni-site.ts`), whose answer names the newest release a test chooses, such as the version after this one.
- **xomoni.com** (S151-14 to S151-19, S151-22): its database's answer on the local Supabase stack, whose migrations hold the releases up to 0.5.2, a security release. A browser connects with a one-time code from *Browsers* and reports with `device_report`, as Xomoni does.

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-151   # the extension; no Supabase
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-151             # xomoni.com
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S151-01 · happy

- Given Xomoni signed in to xomoni.com, which answers that the next version is out
- When the person looks at the dashboard
- Then every page says Xomoni <next> is out, that this browser runs <this version>, and that updating takes a
  minute
- And Download <next> links to the release page on GitHub
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-02 · happy

- Given xomoni.com answers that the next version is out with a security fix
- When the person looks at the dashboard
- Then the notice reads Xomoni <next> is out, with a security fix, in the critical tone, and says to update soon
- And it has no Not now: it can't be dismissed
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-03 · cancel

- Given the notice for the next version, which isn't a security fix
- When the person presses Not now, and reloads the dashboard
- Then the notice is gone, and stays gone
- And once xomoni.com says a later version is out, the notice shows again for that one
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-04 · invalid

- Given Xomoni signed in to xomoni.com
- When xomoni.com names this same version, an older one, or one it can't read (v99.0.0, 99.0, latest), even as a
  security fix
- Then no notice shows
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-05 · empty

- Given Xomoni with an X account, not signed in to xomoni.com
- When the person goes about the dashboard and reloads it
- Then no notice shows, nothing is asked of xomoni.com, and nothing of GitHub
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-06 · error

- Given xomoni.com can't be reached for status reports when Xomoni signs in
- When the person reloads the dashboard
- Then no notice shows, and no error either
- And once xomoni.com answers again, the next report brings the notice
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-07 · error

- Given a xomoni.com whose answer names no release, as one older than the notice did
- When Xomoni reports, and the person reloads the dashboard
- Then no notice shows
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-08 · security

- Given the notice of a security fix
- When the person looks at it, before pressing anything
- Then nothing was downloaded, nor asked of GitHub: the notice only says
- And Download <next> opens GitHub's release page in a new tab, with noopener and noreferrer
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-09 · security

- Given the notice of a newer version
- When the status report that brought it is read
- Then Xomoni sent only its token, its version and its jobs: it asks for nothing more to hear the news
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-10 · a11y

- Given the notice of a newer version
- When the person uses only the keyboard
- Then Tab reaches Download <next>, then Not now, and Enter on Not now hides the notice
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-11 · a11y

- Given the notice of a newer version, then of a security fix
- When each is checked with axe
- Then there is no serious or critical violation
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-12 · browser

- Given a computer in dark mode, and the notice of a security fix
- When it is checked with axe
- Then there is no serious accessibility violation (and CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-13 · persistence

- Given the notice of a security fix
- When xomoni.com can't be reached any more, and the person reloads the dashboard and opens a second tab
- Then both still show it: Xomoni keeps the last answer
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-14 · happy

- Given a browser connected to the person's account, on 0.5.1
- When it reports
- Then xomoni.com answers that 0.5.2 is the newest, and that a newer release fixes a security problem
- Test: apps/web/e2e/update-notice.spec.ts

## S151-15 · happy

- Given a browser on 0.5.2, the newest
- When it reports
- Then xomoni.com answers that 0.5.2 is the newest, with no security news
- Test: apps/web/e2e/update-notice.spec.ts

## S151-16 · invalid

- Given a browser that reports a version xomoni.com can't read: dev, nothing, 0.5
- When it reports
- Then it counts as older than every release: the newest is 0.5.2, with a security fix
- Test: apps/web/e2e/update-notice.spec.ts

## S151-17 · invalid

- Given a browser on 9.9.9, newer than every release, such as a build of the next one
- When it reports
- Then xomoni.com names 0.5.2 as the newest, with no security news, so Xomoni shows no notice
- Test: apps/web/e2e/update-notice.spec.ts

## S151-18 · security

- Given a token xomoni.com never made
- When a report comes with it
- Then it is refused as an unknown browser, and the answer names no release
- Test: apps/web/e2e/update-notice.spec.ts

## S151-19 · security

- Given xomoni.com's list of releases
- When someone asks its database for the list with the public key
- Then they get none of it: only a browser's status report hears the newest
- Test: apps/web/e2e/update-notice.spec.ts

## S151-20 · cancel

- Given the notice of the next version dismissed with Not now
- When xomoni.com says a later version is out, with a security fix
- Then the notice shows for it, with a security fix, and can't be dismissed
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-21 · empty

- Given a fresh install, before the person has opened the X window
- When the first run shows
- Then there is no notice, and nothing was reported to xomoni.com
- Test: apps/web/e2e/extension/update-notice.spec.ts

## S151-22 · error

- Given a browser connected to the person's account
- When its report holds more than 50 jobs, and the database refuses it
- Then the answer names no release, and the browser's next report is answered as before
- Test: apps/web/e2e/update-notice.spec.ts

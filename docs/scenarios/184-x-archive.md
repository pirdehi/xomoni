---
task: 184
title: Your X archive, requested and imported
feature: x-archive
---

# Your X archive, requested and imported

X's archive is the only complete copy of an account: every post, reply, repost and like, even those X no longer shows. In the Library, *Get my archive* asks X for it on X's own page and, once X has made it, presses X's *Download archive* (#186, [ADR-0022](../adr/0022-get-the-x-archive-without-leaving-xomoni.md)); Chrome saves the ZIP in Downloads › Xomoni, and Xomoni imports it from there by itself once the person lets it read that folder (#187, #196). *Already have the ZIP?* takes the ZIP X sent, dropped or chosen, or its unzipped folder (#184). Only `account.js`, `tweets.js` and `like.js` are read, on this computer, and an archive of another account is refused. Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: a refused archive now says why in an alert a screen reader reads out (S184-24).

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X. The archives are made in the test (`apps/web/e2e/support/x-archive.ts`): the made-up `@xomoni_fixture`'s 4 posts, replies and reposts, from 2018 to 2020 (one of them, from 2020, also on its profile), and 2 likes, beside a photo and X's own page that Xomoni never reads. X's archive page is a fixture (`apps/web/e2e/fixtures/x/archive-*.html`): offering a new archive, with one ready, asking for the password, or in a language Xomoni doesn't read. Chrome's folder picker, which Playwright can't answer, is played at the page where a scenario needs it: it gives a folder in the browser's private file system, as the person picks Downloads › Xomoni, or ends as when they close it. *Get my archive* runs a job at Xomoni's reading pace (ADR-0012), so those scenarios wait about half a minute for its page loads. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-184
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S184-01 · happy

- Given a person whose Xomoni has read their profile's 2 posts on X
- When they unfold Already have the ZIP? in the Library and drop X's ZIP (twitter-2026-11-20-….zip) on it
- Then a toast says Imported 4 posts and 2 likes, and the card says Imported <day>: every post, reply and like up to
  that day…, with Last imported <day>
- And Your copy lists X’s archive as Imported just now
- And Posts lists 3: the post from 2020 once, from both the scan and the archive, and the 2018 post only the archive
  has, its text decoded as X shows it (X's archive & nowhere else)
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-02 · happy

- Given X's ZIP dropped in the Library
- When the person looks at Replies, Reposts and Likes
- Then Replies lists the archived reply from 2019, Reposts the post of @fixture_friend's the account reposted, and
  Likes its 2 likes
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-03 · happy

- Given X's archive unzipped in a folder on the computer
- When the person presses Choose unzipped folder and picks that folder
- Then it comes in the same way: Imported 4 posts and 2 likes
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-04 · happy

- Given Cleanup asking to remove everything before Jan 1, 2019, with nothing matching and the warning that old posts
  may be missed without the archive
- When the person imports X's ZIP and opens Cleanup again with the same date
- Then the 2018 post only the archive has matches, and the warning is gone
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-05 · happy

- Given an archive X split into parts: tweets.js, tweets-part1.js and tweets-part2.js
- When the person drops its ZIP
- Then all of it comes in: Imported 3 posts and 2 likes, one from each part
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-06 · happy

- Given X's archive page offering a new archive
- When the person presses Get my archive, closes Chrome's folder picker and accepts the risks
- Then the X window opens X's archive page and presses Request archive, which X turns into Requesting archive
- And the card says Asked X just now. X is making it; Xomoni looks again…, with no Get my archive to press twice
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-07 · happy

- Given X's archive page with the archive ready
- When the person presses Get my archive
- Then the X window presses X's Download archive, and the activity log says Pressed “Download archive” on X’s archive
  page
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-08 · happy

- Given X's ZIP saved by Chrome in Downloads › Xomoni, beside Xomoni's note
- When the person presses Choose the Xomoni folder and picks that folder
- Then the ZIP comes in by itself: a toast counts its 4 posts, the card says Imported <day>, and the 2018 post is in
  the Library
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-09 · invalid

- Given the archive of another account, @fixture_friend
- When the person drops its ZIP
- Then the alert says This archive belongs to @fixture_friend, not @xomoni_fixture. Nothing was imported.
- And the Library still lists the 2 posts, and Your copy says X’s archive Not yet
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-10 · invalid

- Given a ZIP with X's account.js and photos, but no tweets.js and no like.js
- When the person drops it
- Then the alert says No tweets.js or like.js found. Choose the ZIP file X sent you (twitter-….zip), or the “data”
  folder inside it.
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-11 · invalid

- Given an archive without account.js
- When the person drops its ZIP
- Then the alert says account.js is missing. Include it so Xomoni can check the archive belongs to @xomoni_fixture.
- And nothing comes in: the Library still lists the 2 posts
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-12 · invalid

- Given X's ZIP and a text file
- When the person drops both at once
- Then the alert says Choose the ZIP file on its own, without other files.
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-13 · error

- Given X's ZIP whose download stopped halfway, so only its first half is there
- When the person drops it
- Then an alert says why it can't be read, and nothing comes in: the Library still lists the 2 posts, and Your copy
  says X’s archive Not yet
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-14 · error

- Given X's archive page asking for the password first
- When the person presses Get my archive
- Then the job waits for the person: the banner says Xomoni needs them to continue
- And the password field on X's page stays empty: Xomoni never types in it
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-15 · error

- Given X's archive page in a language Xomoni doesn't read, its button named Solicitar archivo
- When the person presses Get my archive
- Then the job pauses having pressed nothing, and the card says X’s archive page doesn’t look as Xomoni expects, so it
  pressed nothing. In the X window, ask X for the archive yourself…
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-16 · security

- Given the Library open, and nothing else open on X
- When the person drops X's ZIP
- Then it is read in this browser: Imported 4 posts and 2 likes, with no request sent anywhere while it comes in
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-17 · security

- Given an archived post whose text is HTML, an image that would load from another site and run a script, as X keeps
  it escaped
- When the person imports the archive and opens Posts
- Then the post's text shows as the person wrote it, as text: no image is made, no script runs, and nothing is asked of
  that site
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-18 · security

- Given a folder named Downloads, with X's ZIP in it
- When the person picks it in Choose the Xomoni folder
- Then Xomoni refuses it: “Downloads” isn’t the Xomoni folder. Chrome saves X’s archive in Downloads › Xomoni…
- And nothing in it is read: Choose the Xomoni folder is still offered, and X’s archive is Not yet
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-19 · empty

- Given an account with no archive yet
- When the person opens the Library, then Cleanup
- Then the card says Recommended, with its four steps, Get my archive and Open X’s page, a link to X's own page
- And Your copy lists X’s archive as Not yet, and Cleanup warns that old posts may be missed without it
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-20 · empty

- Given the archive of an account that never posted nor liked anything
- When the person drops its ZIP
- Then it comes in: Imported 0 posts and 0 likes, X’s archive Imported just now, and the Library still lists the 2
  posts Xomoni read on X
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-21 · cancel

- Given X's archive page offering a new archive
- When the person presses Get my archive and then Not now on the risks
- Then nothing is left behind: Get my archive is there again, Activity has no open job, and X's archive page was never
  loaded
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-22 · cancel

- Given Already have the ZIP? unfolded
- When the person presses Choose unzipped folder and closes the picker, then folds Already have the ZIP? again
- Then nothing comes in and nothing is said, and the drop zone folds away
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-23 · a11y

- Given a person using only the keyboard, and X's archive unzipped
- When they Tab to Already have the ZIP? and press Enter, then Tab to Choose unzipped folder, press Enter and pick the
  folder
- Then the fold opens, and the archive comes in: Imported 4 posts and 2 likes
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-24 · a11y

- Given the archive card with Already have the ZIP? unfolded
- When another account's archive is refused, then X's ZIP comes in
- Then the card, the refusal and the imported archive have no serious accessibility violation
- And the refusal is an alert, read out at once
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-25 · browser

- Given a browser set to dark mode
- When the person unfolds Already have the ZIP? and drops X's ZIP
- Then the card has no serious accessibility violation in dark colors, before and after the import
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/extension/x-archive.spec.ts

## S184-26 · persistence

- Given X's ZIP imported
- When the person reloads the dashboard, then drops the same ZIP again
- Then the archive is still there, Imported, with 3 posts
- And the second import adds nothing twice: still 3 posts and 2 likes
- Test: apps/web/e2e/extension/x-archive.spec.ts

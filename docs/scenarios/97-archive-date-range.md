---
task: 97
title: Archive a date range: user scenarios
feature: archive-date-range
---

# Archive a date range

The Library's *Download a copy* (#97, #185): the posts, replies and reposts of the dates the person picks, as a page that opens in any browser (no scripts, every post escaped, under a policy that forbids scripts) or as JSON, made on this computer from Xomoni's copy and saved in Downloads. Likes are never in it. X's official archive stays the complete copy, with media. Reading X to complete the copy is the Library's reads, with their own scenarios (#185). Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, which joined X on Jan 2, 2017, with years behind it (`xHistory: 'long'`). Once the person has browsed their profile's tabs, Xomoni's copy holds:

- 5 posts: Feb 8, 2024 ("Our launch went well…"), May 20, 2023, Jun 1, 2021, Mar 14, 2020 and Aug 15, 2019;
- 2 replies: Nov 2, 2020 and Mar 14, 2020;
- 1 repost, Jan 10, 2022, of a post by the made-up `@fixture_friend`;
- 2 likes, which no copy holds.

A downloaded page is opened as the person opens it from Downloads, as a file in the browser. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-97
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S97-01 · happy

- Given the person browsed their profile's tabs on X, and opened Download a copy in the Library
- When they keep All time, every kind and the page, and press Download
- Then the dialog reads Posts (5), Replies (2), Reposts (1), and 8 items from Jan 2, 2017, the day they joined
- And xomoni-xomoni_fixture-2017-01-02-to-<today>.html downloads, and the dialog closes
- And opened, the page is titled Archive of @xomoni_fixture, counts 5 posts, 2 replies, 1 repost, and lists the 8
  oldest first, one section a month, the repost of @fixture_friend among them, each with View on X
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-02 · happy

- Given Download a copy, All time
- When the person chooses Data for other tools (JSON) and downloads
- Then xomoni-xomoni_fixture-2017-01-02-to-<today>.json holds the format and its version, the account's id, handle and
  name, the dates, the counts per kind, and each of the 8 items oldest first with its text, link and status
- And the repost links to @fixture_friend's post
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-03 · happy

- Given Download a copy
- When the person chooses dates from Mar 14, 2020 to Nov 2, 2020
- Then it reads Posts (1), Replies (2), Reposts (0), and 3 items from Mar 14, 2020 to Nov 2, 2020: both days included
- And the file, named with the two dates, holds those 3
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-04 · happy

- Given Download a copy, All time
- When the person leaves Replies and Reposts out
- Then it reads 5 items, and the file holds the posts alone, its counts saying 0 replies and 0 reposts
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-05 · invalid

- Given chosen dates
- When the start is after the end
- Then the dialog says Pick a start date on or before the end date, the count reads No dates yet, and Download is off
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-06 · invalid

- Given chosen dates in 2020
- When the person clears the start date, then puts it back and leaves every kind out
- Then a cleared date is refused as a start after the end, with Download off
- And with no kind, it reads 0 items from Jan 1, 2020 to Dec 31, 2020, with Download off
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-07 · invalid

- Given chosen dates from Jan 1, 2020 to Dec 31, 2020
- When the person opens the date pickers
- Then the end can't be after today nor before the start, and the start can't be after the end
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-08 · error

- Given Download a copy, and the computer offline
- When the person downloads JSON
- Then the 8 items download all the same: the copy is made on this computer
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-09 · error

- Given the person signed out of X after browsing their profile
- When they download the page
- Then it holds the 8 items all the same, from what Xomoni already has: nothing is asked of X
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-10 · error

- Given X showed the person's posts, but was over capacity for their Replies tab
- When they open Download a copy and download the page
- Then the dialog reads Posts (5) and Replies (0), and the page holds the 6 posts and reposts X showed
- And it says it was made from what X showed and the imported archive, and that the official X archive is the
  complete copy
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-11 · security

- Given one of the person's posts whose text is markup: an image with an onerror script, and a script
- When they download the page and open it
- Then the post shows the markup as text, the page has no image or script from it, and its title is unchanged
- And the page carries a policy of default-src 'none', with no script source
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-12 · security

- Given Download a copy
- When the person downloads the page and opens it
- Then nothing is sent anywhere to make it, and opening it loads nothing: only the download from the page itself,
  and the file
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-13 · security

- Given the downloaded page
- When the person looks at its links
- Then there is one per item, each to the post on x.com, and the liked posts of @fixture_friend aren't in it
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-14 · empty

- Given the X window open, and nothing browsed or read yet
- When the person opens Download a copy
- Then every kind reads 0, the count reads 0 items, and Download is off
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-15 · empty

- Given the person's copy, whose newest post is from 2024
- When they choose This year, then Last 12 months
- Then each reads 0 items from its first day, with Download off
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-16 · cancel

- Given Download a copy
- When the person presses Cancel, then opens it again and presses Close
- Then the dialog closes each time, and nothing downloads
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-17 · cancel

- Given dates chosen in 2020, with Reposts left out
- When the person presses Escape and opens Download a copy again
- Then the dialog closes, and opens again as they left it: Choose dates, from Jan 1, 2020, without reposts
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-18 · a11y

- Given the Library
- When the person uses only the keyboard: Enter on Download a copy, Enter on Choose dates, Space on Reposts, an arrow
  in Format, Enter on Download
- Then the dialog opens, the dates show, Reposts is left out, JSON is chosen, and the JSON downloads
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-19 · a11y

- Given Download a copy, then a start after the end
- When it is checked with axe
- Then Dates and Include are named groups, Format a named radio group, the count a status that screen readers read
  out, and there is no serious or critical violation, with or without the date problem
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-20 · browser

- Given a computer in dark mode
- When the person chooses dates in Download a copy
- Then there is no serious accessibility violation (and CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-21 · browser

- Given the downloaded page
- When it is opened on a phone, 390 pixels wide
- Then it fits the screen, with nothing to scroll sideways
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

## S97-22 · persistence

- Given a JSON copy downloaded
- When the person reloads the dashboard and downloads the same again
- Then the dialog starts afresh, a page of All time, and the second file holds the same items and counts
- Test: apps/web/e2e/extension/archive-date-range.spec.ts

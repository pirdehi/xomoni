---
task: 367
title: Keep rules: user scenarios
feature: keep-rules
---

# Keep rules

What a cleanup spares although it matches (#367): posts with at least a number of likes, posts whose text contains given words, posts the person pastes the link of, and replies in their own threads, under Cleanup's *Exceptions*. A rule that fails removes something the person wanted to keep, so each kind is proven at its edges: at, under and over a like threshold, the case and the parts of words, every form of a post's link and links that aren't a post's, rules together, and what the preview, the backup, the confirmation and the job leave out. Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: the same post pasted twice counted as two chosen posts (S367-13).

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`, `apps/web/e2e/fixtures/x/graphql/long-history`). Once the person has browsed their profile's tabs, Xomoni's copy holds:

- 5 posts, all more than a year old: Feb 8, 2024 ("Our launch went well…", 3 likes), May 20, 2023 (120 likes), Jun 1, 2021 ("Another made-up post…", no likes), Mar 14, 2020 ("…for Xomoni's browser tests.", 2 likes) and Aug 15, 2019 ("…from before the others.", 1 like);
- 2 replies: Nov 2, 2020, to the made-up `@fixture_friend`, and Mar 14, 2020, continuing the person's own thread;
- 1 repost, Jan 10, 2022, of a post by `@fixture_friend`;
- 2 likes, of `@fixture_friend`'s posts from May 5, 2019 ("An older made-up post…") and Apr 2, 2025 ("A newer made-up post…").

Most scenarios stop at the preview, which shows what the job will remove: the delete itself comes five minutes or more after a new account's first page load (S199-07), so it is the one manual scenario (S367-31). Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-367
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S367-01 · happy

- Given the person's 5 posts on Cleanup, all matching, with Choose what to keep unfolded
- When they keep posts with at least 2 likes
- Then the posts with 2 likes, at the threshold, and with 3 and 120 leave the preview
- And the posts with 1 like, just under it, and with none still match
- And at 3, the post with 2 likes matches again; at 4, so does the one with 3
- And once folded, the exceptions read: Keeps posts with 4+ likes.
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-02 · happy

- Given the person's 5 posts on Cleanup
- When they keep text with LAUNCH, in capitals
- Then the post with "launch" in small letters is kept, and the other 4 still match
- And once folded, the exceptions read: Keeps text with “launch”.
- And xomoni, in small letters, keeps the post with "Xomoni's"
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-03 · happy

- Given the person's 5 posts on Cleanup
- When they keep text with other
- Then the posts with "Another" and "others" are kept: a keyword keeps a post that has it inside a word
- And with launch, other, separated by a comma, the post with "launch" is kept too
- And with launch, other and test on lines of their own, so is the one with "tests": only May 20, 2023 still matches
- And once folded, the exceptions read: Keeps text with “launch”, “other”, “test”.
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-04 · happy

- Given the person's 5 posts on Cleanup
- When they paste, one by one, a post's link on x.com, on twitter.com with ?s=20, on mobile.twitter.com as statuses with
  /photo/1 at its end, as x.com/i/web/status, and a bare id, the last two on one line with a comma between
- Then each keeps its post, and the preview loses one post with each
- And once all five are pasted, nothing matches, and the exceptions read: Keeps 5 chosen posts.
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-05 · happy

- Given the person's 2 replies, one to @fixture_friend and one continuing their own thread
- When they choose Replies on Cleanup
- Then Keep replies in my own threads is on, and the exceptions read: Keeps replies in your own threads.
- And only the reply to @fixture_friend matches, and the confirmation says 1 in your copy match
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-06 · happy

- Given the person's 5 posts on Cleanup
- When they keep posts with at least 2 likes, text with launch and the link of the post from Jun 1, 2021
- Then only Aug 15, 2019 still matches: the post from Feb 8, 2024, kept by its likes and by "launch", is kept once
- And once folded, the exceptions read: Keeps posts with 2+ likes, text with “launch” and 1 chosen post.
- And without the likes rule, May 20, 2023 and Mar 14, 2020 match again, while "launch" still keeps Feb 8, 2024
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-07 · happy

- Given the person's posts before Jan 1, 2025, keeping those with 50+ likes and text with launch
- When they look at Review, download the backup and open the confirmation
- Then Review lists the 3 that match, Jun 1, 2021, Mar 14, 2020 and Aug 15, 2019, and neither kept post
- And the backup holds those 3 only: Backup of 3 items downloaded
- And the confirmation names Delete posts older than Jan 1, 2025, with 3 in your copy match
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-08 · happy

- Given the person's repost and 2 likes on Cleanup
- When they choose Reposts and paste the link of @fixture_friend's post they reposted
- Then the repost is kept: nothing matches, and the exceptions read: Keeps 1 chosen post.
- And for reposts and for likes there is no likes field: the threshold is for the person's own posts and replies
- And on Likes, a keyword keeps a like by the liked post's text: older keeps the like of the older post
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-09 · happy

- Given the person's posts on Cleanup, keeping those with 50+ likes, so May 20, 2023, with 120, is kept
- When X now shows 60 likes on Jun 1, 2021 and 40 on May 20, 2023, and the person sees their posts again on X
- Then the preview follows X's new counts: Jun 1, 2021 is kept, and May 20, 2023 matches
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-10 · invalid

- Given the person's posts on Cleanup, with the likes field unfolded
- When they type fifty, -5, 1e2 or 0 in Keep if it has at least … likes
- Then the field keeps the digits only: nothing for fifty, 5 for -5 and 12 for 1e2, each keeping May 20, 2023 alone
- And 0 keeps nothing: every post matches, and the exceptions read: Nothing is kept: everything that matches is removed.
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-11 · invalid

- Given the person's 5 posts on Cleanup
- When they paste their profile's link, a t.co link, a handle with digits in it, a status link with a 5-digit number, and
  a post's id with a letter after it
- Then none is taken for a post: all 5 still match, and the preview still lists the post from Aug 15, 2019
- And once folded, the exceptions read: Nothing is kept: everything that matches is removed.
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-12 · invalid

- Given the person's 5 posts on Cleanup
- When they keep text with launch tests, separated by a space
- Then it is one phrase: no post has it, so all 5 still match
- And once folded, the exceptions read: Keeps text with “launch tests”.
- And launch, tests, with a comma, keeps the posts with "launch" and with "tests"
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-13 · invalid

- Given the person's 5 posts on Cleanup
- When they paste the post from Aug 15, 2019 three times: its link on x.com, its id, and its link on twitter.com
- Then that post is kept, and the other 4 still match
- And once folded, the exceptions read: Keeps 1 chosen post., not 3
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-14 · error

- Given the person's copy, from browsing their profile
- When the connection drops, and they open Cleanup and keep posts with 50+ likes, text with launch and the post from
  Aug 15, 2019
- Then the preview follows the rules as online: only Jun 1, 2021 and Mar 14, 2020 match
- And nothing is sent to X: the rules read the copy on this computer
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-15 · error

- Given the person's posts on Cleanup, keeping those with 50+ likes
- When they go to their profile again, and X answers its timeline with 429, its rate limit reached
- Then the X tab shows X's error, Something went wrong. Try reloading.
- And the rules use the counts X showed last: May 20, 2023 is still kept for its 120 likes, and the preview is unchanged
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-16 · error

- Given the X window open and a cleanup of posts keeping those with 50+ likes and text with launch, 3 of 5 matching
- When the connection drops, and the person starts it
- Then the job waits for the connection, with 3 remaining: the kept posts are never counted
- And nothing is removed, and nothing is counted as failed
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-17 · security

- Given the person's posts on Cleanup, with active hours off in Settings
- When they keep text with launch, a private phrase and the link of the post from Aug 15, 2019, then start the cleanup
- Then nothing is sent to X while they type and preview
- And when the job loads their profile in the X window, no request to X carries a keep word or the kept post's id
- And no page sends anything to any host but x.com
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-18 · security

- Given the person's 5 posts on Cleanup
- When they paste the link of a post by @fixture_friend, another account
- Then the exceptions read Keeps 1 chosen post., and the same 5 posts match: a link only spares, it never adds a post to
  remove
- And on Likes, the same link keeps the person's like of that post: only the like of the newer post matches
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-19 · security

- Given the person's posts on Cleanup
- When they type a keyword that looks like markup, an image whose error handler changes the page's title, then launch in
  bold
- Then it is kept as text: no post has it, so all 5 still match
- And once folded, the exceptions quote it as typed, in small letters, and no image or bold text appears
- And the page's title is unchanged: nothing it holds ran
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-20 · empty

- Given the person's posts on Cleanup, before they choose anything to keep
- When they look at the folded exceptions, then unfold them
- Then the exceptions read: Nothing is kept: everything that matches is removed.
- And the three fields are empty, with e.g. 50, launch, #mytag and https://x.com/you/status/… as examples
- And commas, spaces and new lines alone keep nothing: all 5 still match, and the summary is unchanged
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-21 · empty

- Given the person's 5 posts on Cleanup
- When they keep posts with at least 1 like and text with another, which together keep every post
- Then 0 match, nothing is previewed, and Download backup (JSON) is off
- And Start cleanup stays on while Sweep X search may find posts the copy hasn't seen, which the same rules then keep or
  remove: the confirmation says 0 in your copy match, plus any that searching X finds
- And with the sweep off, Start cleanup goes off
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-22 · cancel

- Given the person's posts on Cleanup, keeping 50+ likes, text with launch and the post from Aug 15, 2019, 2 matching
- When they clear the link, then the keyword, then the number of likes
- Then the post each rule kept comes back to the preview: Aug 15, 2019, then Feb 8, 2024, then May 20, 2023
- And once folded, the exceptions read: Nothing is kept: everything that matches is removed.
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-23 · cancel

- Given the person's replies on Cleanup, the continuation of their own thread kept
- When they turn off Keep replies in my own threads, then turn it on again
- Then off, both replies match, the thread's continuation too, and the exceptions read Nothing is kept
- And on again, only the reply to @fixture_friend matches
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-24 · cancel

- Given the person's posts before Jan 1, 2025 on Cleanup, keeping 50+ likes and text with launch
- When they fold and unfold the exceptions, then open the confirmation, type DELETE and press Cancel
- Then folded, the exceptions read: Keeps posts with 50+ likes and text with “launch”.
- And unfolded again, and after the confirmation is cancelled, the fields still hold 50 and launch, with 3 matching
- And no job is created: Activity says No open jobs
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-25 · a11y

- Given a person using only the keyboard, on Cleanup
- When they Tab to Choose what to keep and press Enter, Tab to each field and type 50, launch and a post's link, then
  Tab back to Choose what to keep and press Space
- Then the rules unfold and fold, the preview follows what they type, and the exceptions read: Keeps posts with 50+
  likes, text with “launch” and 1 chosen post.
- And on Replies, Tab and Space reach and turn off Keep replies in my own threads
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-26 · a11y

- Given Cleanup with the exceptions folded
- When the person unfolds them, fills them in, and chooses Replies
- Then Choose what to keep says whether they are unfolded (aria-expanded)
- And each field is named by its label and hint, such as Keep if it has at least … likes Leave empty to ignore, and Keep
  replies in my own threads is described by its explanation
- And axe finds no serious or critical violation, folded, filled in, or on Replies
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-27 · browser

- Given the system in dark mode
- When the person fills in the keep rules, then folds them
- Then the rules and their summary have no serious or critical accessibility violation
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-28 · browser

- Given Xomoni installed in Microsoft Edge, as CI's e2e-edge job runs it, or in Chrome
- When the person keeps posts with 50+ likes and text with launch, and starts the cleanup
- Then the browser is the one it says it is, and the job runs as in Chrome, with 3 remaining
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-29 · persistence

- Given a running cleanup that keeps posts with 50+ likes and text with launch, 3 remaining
- When the person reloads the dashboard, then resumes the job
- Then the job is still there, paused, with 3 remaining, and once resumed it still leaves the kept posts out
- And Cleanup's form starts again from Nothing is kept: the rules belong to the job, not to the page
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-30 · persistence

- Given a cleanup with keep rules running in one dashboard tab, 3 remaining
- When the person opens Activity, then Cleanup, in a second dashboard tab
- Then the job shows there with the same 3 remaining
- And that tab's Cleanup has a form of its own, with nothing kept
- Test: apps/web/e2e/extension/keep-rules.spec.ts

## S367-31 · happy

- Given a cleanup of posts with keep rules, past its wait before the first delete
- When Xomoni opens a matching post on X to remove it
- Then it checks the rules again against what X shows now: a post whose text on X has a keep word, or whose like count
  X now shows at or over the threshold, is kept
- And with a like threshold, a post whose like count X didn't show during the job is left alone, never removed on the
  copy's old count
- Manual: as for S199-32, the first delete comes 320 to 480 seconds after the job's first page load on a new account (Careful's 80–120 s, at a quarter on its first day, ADR-0012), and each later one at least 80 seconds after the one before. The job's timers run in a dedicated worker that Playwright's clock doesn't reach, so a browser test would take that long per delete: too long for the merge gate. The engine's tests prove the checks on the post's page, a like count seen on this visit and a keep word X shows now (apps/extension/tests/own-posts.test.ts), the content script's that it refuses to delete a post whose text on X has a keep word (canary.test.ts), and the pilot checks it on the real X.

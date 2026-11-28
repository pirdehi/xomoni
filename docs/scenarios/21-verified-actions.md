---
task: 21
title: Acts only on what it can verify
feature: verified-actions
---

# Acts only on what it can verify

Xomoni's promise not to act on what it can't verify (#21, #22, #144, #145; PLAYBOOK C5, D4, F1, F2): it acts only on the person's own posts, on items whose ids it can verify; it confirms each action from X's own answer to it; and it never clicks anything else on X's page. What a cleanup deletes comes from a copy filled only with what X's answers say the signed-in account wrote, reposted or liked; on X's page, a job takes up only posts X shows by the person and that the copy knows; and right before each action it checks X's page again. Written for #345, the features shipped before the scenarios gate.

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X: the made-up `@xomoni_fixture`, with years behind it (`xHistory: 'long'`), and the other made-up account, `@fixture_friend`, whose posts the fixture account reposted, liked and answered. Some scenarios have X answer otherwise (`answerFrom` in `apps/web/e2e/support/x-fixtures.ts`): the fixture account's posts with a quote of the friend's post and a post whose id no X post could have (`graphql/edge-cases/`), or X saying it has no such post (`graphql/post-not-found/`). The friend's own pages answer from `graphql/friend/`.

Writing them found one bug, fixed with them (#345): when X's page named the account by something other than a handle, such as its `/i/user/<id>` link, the dashboard took it as the account's handle and showed it, and the account's jobs and daily numbers stopped reaching xomoni.com, which takes handles only (S21-11).

A new account's first delete comes 320 to 480 seconds after the job's first page load, in a dedicated worker Playwright's clock doesn't reach, so no browser test waits for one. They prove what the person sees and what a job decides before it acts: what enters the copy a cleanup deletes from, what the job takes up on X's page and what it leaves alone, when it stops before acting, and that nothing counts as removed until X confirms it. The checks at the click itself (the post's author, its id, X's answer, X's buttons) are proven by the unit tests each scenario names. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-21
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S21-01 · happy

- Given a person who browsed their profile's posts, replies and likes on X, whose pages also showed @fixture_friend's
  posts: the one they reposted, and the two they liked, one of which they answered
- When they open Cleanup, then Library › Browse
- Then the copy a cleanup deletes from holds Posts 5 and Replies 2, every one by @xomoni_fixture: searched for
  @fixture_friend, Posts and Replies show Nothing here
- And the friend's posts are there only as what the person did to them: 1 repost to undo and 2 likes to remove
- And X's answers are read for the signed-in account only, its own posts and its own Likes tab, as
  apps/extension/tests/net.test.ts (adds the viewer’s own posts from a timeline to the inventory) and
  apps/extension/tests/parsers.test.ts (records likes only from the viewer’s own Likes timeline) prove
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-02 · happy

- Given the person's repost, on Jan 10, 2022, of @fixture_friend's post
- When they choose Reposts before Jan 1, 2023 on Cleanup, download the backup, and start the cleanup
- Then the preview lists the friend's post under the repost's date, and the backup names the repost, the person's own
  (9000000000000000104), with the friend's post as what it points to
- And the job, Undo reposts older than Jan 1, 2023, loads the profile, where X shows the friend's post as Reposted,
  takes it up, 1 remaining, and waits to undo the repost; no delete is sent to X
- And the undo names the original post and goes through the repost menu's Undo repost, never a guess at which post is
  meant, as apps/extension/tests/canary.test.ts proves (undoes a repost, clicking the Undo repost option X shows at
  that moment; never undoes a repost by guessing which post is meant)
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-03 · happy

- Given a person with an X account in Xomoni, on Settings
- When they read the rules under Always on
- Then the last says Counts an action only when X confirms it
- And the content script reports a delete, an undone repost or an unlike done only once X's own answer to that request,
  for that post, arrives with data: no answer within 15 seconds, an answer without data or an error it doesn't explain
  is a failure, as apps/extension/tests/net.test.ts (waitForNet: confirmation from X’s own response) and
  apps/extension/tests/restrictions.test.ts (a write counts as done only when X’s answer to it says so) prove
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-04 · security

- Given posts before Jan 1, 2022 on Cleanup: the person's own of Jun 1, 2021, Mar 14, 2020 and Aug 15, 2019
- When the job loads their profile, where X also shows @fixture_friend's post of Dec 24, 2021, the one they reposted,
  older than the date
- Then the job takes up the person's 3 posts only, 3 remaining, and waits to delete the first
- And its log names nothing of the friend's post: a post X's page shows by anyone else isn't even looked up
- And at the delete itself, the content script acts only on a post X's page shows by the signed-in account, leaving
  anyone else's alone without opening its menu, so no other option in it, such as Block, can be clicked by mistake, as
  apps/extension/tests/canary.test.ts proves (leaves someone else’s post alone, without even opening its menu)
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-05 · security

- Given the person's copy with their posts, and X in this browser then signed in to @fixture_friend
- When the person browses @xomoni_fixture's replies and likes, signed in as the friend
- Then nothing X showed is recorded: the person's copy still has Replies 0 and Likes 0
- And once the X window names @fixture_friend, its Cleanup has 0 in every card: another account's view of the person's
  posts never becomes anyone's to delete
- And apps/extension/tests/net.test.ts proves it for every answer (adds nothing from a timeline without the viewer’s
  posts; sends the viewer’s own profile, and not anyone else’s)
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-06 · security

- Given the person's copy, filled from X's answers on their profile
- When another script on X's page, once it has loaded, posts a capture shaped like Xomoni's on the window, with a post
  X never sent, and asks for Xomoni's private channel
- Then the channel isn't offered to it, and the forged post never reaches the copy: Posts 5, and Library finds no
  forged post
- And a forged answer can't confirm an action either: X's answers reach the content script only through the private
  channel it handed over before X's scripts ran (#59), as apps/extension/tests/content-channel.test.ts (ignores a
  forged capture posted on the window by another script) and apps/extension/tests/bridge.test.ts (stops offering the
  port once the page has loaded) prove
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-07 · security

- Given a cleanup of posts before Jan 1, 2021 started, its job waiting to load the profile
- When X in this browser is signed in to @fixture_friend meanwhile, as from another tab
- Then the job's page load finds the other account and waits for the person: The X window is signed in to another X
  account. Switch back to @xomoni_fixture.
- And nothing is deleted, and once X is back on @xomoni_fixture the job goes on by itself: 0 removed, 2 remaining
- And the same check runs before every page load and every action (PLAYBOOK D4), from X's twid cookie, as
  apps/extension/tests/parsers.test.ts proves (attention: says what the person has to do, most basic first)
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-08 · invalid

- Given X's answer for the person's profile with a post of theirs, of Sep 9, 2020, whose id has 21 digits, which no X
  post can have, and X's page showing it
- When the person browses their profile, and starts a cleanup of posts before Jan 1, 2021
- Then the copy leaves that post out: Posts 6 in your copy, and the preview lists the other three before 2021
- And on X's page the job leaves it alone, Left alone for now: no current details recorded for this post, with a link
  to it on X, and takes up the other 3
- And a command for such an id is refused before X's page is even read, and the deep clean never opens a page for one,
  as apps/extension/tests/ids.test.ts (parsers drop posts whose id isn’t an X id),
  apps/extension/tests/canary.test.ts (refuses every write for an id that isn’t an X id, before looking at the page)
  and apps/extension/tests/own-posts.test.ts (leaves an inventory row whose id isn’t an X id alone) prove
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-09 · invalid

- Given the person's post of Jul 1, 2020 quoting @fixture_friend's post of May 5, 2019, which X shows inside it with
  its time not a link
- When the person browses their profile, and starts a cleanup of posts before Jan 1, 2021
- Then the quote is the person's own post, in the copy with its own date, Jul 1, 2020, and the quoted post isn't in the
  copy at all: Library finds none of its text
- And on X's page the job takes up 3 posts, the quote among them, and its log never names the quoted post: a post's id,
  author and time come from its own time link, which a quoted post doesn't have, as apps/extension/tests/dom.test.ts
  (reads the id, handle and time from the timestamp link, not from a quoted post) and
  apps/extension/tests/parsers.test.ts (extracts timeline tweets without descending into quoted or reposted posts)
  prove
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-10 · invalid

- Given the person's copy with their posts and their 2 likes of @fixture_friend's posts
- When they open @fixture_friend's Likes tab, where X lists two of the person's own posts the friend liked
- Then the person's copy gains no like: Likes 2 in your copy, their own likes of the friend's posts
- And the friend's profile, which X sent for that page, isn't taken as the person's: the dashboard still names Fixture
  Person @xomoni_fixture
- And a like is only ever taken from the signed-in account's own Likes tab, as apps/extension/tests/parsers.test.ts
  proves (records likes only from the viewer’s own Likes timeline): a cleanup of likes never unlikes, or likes then
  unlikes, a post the person didn't like
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-11 · error

- Given the X window open on X's Home after X changed its page: its sidebar's Profile link names the account by its id,
  /i/user/9000000000000000001, not by a handle
- When the person starts a cleanup of posts
- Then the job loads X's Home again first, at Xomoni's reading pace, as every run does (#377), and stops there for
  safety, before it loads any page of posts: Could not determine your @handle from X. Open your profile once in the X
  window., with 0 removed
- And the dashboard keeps the handle X's profile answer gave, Fixture Person @xomoni_fixture: a link that isn't a
  handle never replaces it (fixed with these scenarios, #345)
- And a page that names no handle yet, as X's while it is still drawing its sidebar, leaves the job the handle Xomoni
  knows: it never uses one X wouldn't allow, in a URL, a search or the check of a post's author, as
  apps/extension/tests/own-posts.test.ts proves (stops before acting when X shows a handle X wouldn’t allow; uses the
  handle Xomoni knows while X’s page names none yet)
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-12 · error

- Given a cleanup of posts before Jan 1, 2021 that visits each known post instead of searching X
- When X answers each post's page that it has no such post, its error 144, and shows its panel saying the page doesn't
  exist
- Then each post is Skipped — The post is no longer available, and the job finishes with 0 removed, 2 skipped and 0
  remaining: Finished “Delete posts older than Jan 1, 2021” — 0 done, 2 skipped, 0 failed
- And Library › Removed has nothing, and no delete was sent to X: a post counts as removed only when X confirms
  Xomoni's own delete of it, never because X doesn't show it
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-13 · empty

- Given a person whose X account Xomoni knows only from the X window on Home, before X has shown any of their posts
- When they open Cleanup
- Then every card says 0 in your copy: Posts, Replies, Reposts and Likes
- And nothing is previewed, and there is no backup to download: the copy holds only what X has shown of the account
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-14 · empty

- Given a cleanup that visits the person's post of Aug 15, 2019, which X says it no longer has
- When the job finishes, having removed nothing
- Then its account health report says Healthy: no warnings from X., and nothing of removals checked again on X
- And only removals X confirmed are checked again later, about one in 25 (PLAYBOOK C5), as
  apps/extension/tests/samples.test.ts proves (queues about one in 25 confirmed actions, due 10–30 minutes later)
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-15 · cancel

- Given a cleanup of posts before Jan 1, 2021 whose job has taken up the person's 2 posts and waits to delete the first
- When the person presses Cancel
- Then the job is Cancelled with 0 removed, and X's page still shows the posts
- And Library › Removed has nothing, and a new cleanup previews the same 2 posts: nothing counts as removed until X
  confirms it
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-16 · cancel

- Given a job that has taken up the person's 2 posts and waits to delete the first
- When the person presses Pause, then Resume
- Then the resumed run loads the profile again and takes up the posts X shows now before it waits to delete one: 0
  removed, 2 remaining
- And each run checks X's page again before its first action of each kind, as apps/extension/tests/preflight.test.ts
  proves (checks once per run, then acts)
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-17 · a11y

- Given a job that left alone the post whose id isn't an X id
- When the person, with the keyboard only, Tabs to Show log under the job's card, presses Enter, and Tabs on
- Then the log opens, its button saying so (expanded), and the focus reaches the line Left alone for now: no current
  details recorded for this post, on its link to the post on X, Open on X
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-18 · a11y

- Given the person's copy with @fixture_friend's post as a repost, Library searched for @fixture_friend, and a job that
  left a post alone
- When axe checks Cleanup on Reposts, the Library, and the job's log
- Then it finds no serious or critical violation
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-19 · browser

- Given the system in dark mode, and a job stopped for safety because X's page in the X window no longer names the
  person's handle
- When the person opens the job's log
- Then the card, its reason and the log have no serious or critical accessibility violation
- And CI's e2e-edge job runs every scenario again in Microsoft Edge
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-20 · persistence

- Given a job that finished with the person's post of Aug 15, 2019 skipped, X saying it had no such post
- When the person reloads the dashboard
- Then the job still says 0 removed and 1 skipped, Library › Removed has nothing, and a cleanup before Jan 1, 2020
  previews nothing
- And once X shows the post on the profile again, more than 5 seconds after it said it had none, the post is back in
  the copy and the preview (PLAYBOOK E5): it was never counted removed
- Test: apps/web/e2e/extension/verified-actions.spec.ts

## S21-21 · happy

- Given a job about to delete the first of the person's posts in a run
- When the delete's turn comes
- Then Xomoni first checks X's page on that post without acting: it opens the post's "…" menu, finds Delete, and closes
  the menu with Escape, clicking nothing in it (PLAYBOOK F1, #21)
- And it deletes only a post X's page shows by the person, whose time there agrees with its id and whose text has none
  of the rule's keep words: it clicks X's own "…" button and confirm button, found by their data-testid, and the Delete
  option of the one menu it opened, found by its label or X's red and looked up again right before the click
- And it counts the post removed only once X's DeleteTweet answer for that post arrives with data; the post then shows
  under Library › Removed, and about one in 25 is checked again on its page 10 to 30 minutes later (#22)
- Manual: a new account's first delete comes 320 to 480 seconds after the job's first page load, in a dedicated worker
  Playwright's clock doesn't reach: too long for the merge gate. S21-04, S21-08, S21-09, S21-15 and S21-16 prove in the
  browser what a job takes up and that nothing counts as removed before X confirms it; apps/extension/tests/canary.test.ts
  (the check, the clicks, the person's own posts and the page asked again), preflight.test.ts, net.test.ts and
  samples.test.ts prove the rest; the pilot sees it on a real account.

## S21-22 · error

- Given a job deleting the person's posts
- When X doesn't confirm a delete: no answer within 15 seconds, an error code Xomoni doesn't know, or an answer without
  data; or when the check before the run's first delete finds X changed its page: the "…" button gone, no Delete in
  the menu, or Escape no longer closing it
- Then an unconfirmed delete counts as failed, never removed, and the post stays in the copy; two failures in a row
  pause the job: 2 failures in a row. X may have changed its page, or the X window is not visible.
- And a changed page stops the job before it acts: X changed its page: … Xomoni stopped before acting. Check for a
  Xomoni update, then resume.
- And X's refusal (403) stops the job, and X's server errors are waited out: neither counts as removed
- Manual: X answers only a delete Xomoni clicked, which comes minutes into a job (S21-21), and the check before acting
  runs just before it. apps/extension/tests/restrictions.test.ts (a write counts as done only when X’s answer to it says
  so), interruptions.test.ts (still counts other failures, which stop the job after two in a row), canary.test.ts
  (reports a changed page …) and preflight.test.ts (stops before any delete when X changed its page) prove it.

## S21-23 · error

- Given deletes X confirmed during a job, about one in 25 of them queued for a check
- When the post's page, 10 to 30 minutes later, still shows a post X said it deleted, or a post still liked or
  reposted
- Then Xomoni records a silent block and stops: Risk level 4, a full stop with no automatic resume, as X confirmed an
  action but did not apply it (PLAYBOOK C5, #22)
- And a page that can't tell drops the check without a verdict
- Manual: a check is due 10 to 30 minutes after a confirmed delete, itself minutes into a job (S21-21).
  apps/extension/tests/samples.test.ts proves it (stops everything when a deleted post is still there; stops when an
  unliked post still shows as liked; does nothing before a check is due, and drops one the page cannot answer); the
  pilot sees it on a real account.

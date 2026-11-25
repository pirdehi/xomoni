---
task: 431
title: Reach on xomoni.com, read from Xomoni in the same browser
feature: website-reach
---

# Reach on xomoni.com

*Reach* on the dashboard (#431, [ADR-0045](../adr/0045-reach-diagnosis-guesses-labelled-as-guesses.md) point 6, [ADR-0028](../adr/0028-xomoni-data-on-the-website-in-the-same-browser.md) as amended) shows what the Reach page in Xomoni shows, read from Xomoni in this browser (`what: 'reach'`): the comparisons in the same five words, a page of the person's posts with their views and their share of usual, X's labels month by month, and the suspected posts, each in a box that can't be hidden: *This is a guess. X doesn't say which posts got a label.* The answer is bounded (`REACH_LIMITS`): at most 8 comparisons, 24 months of 50 labels, 100 posts with 280 characters of text, and 20 suspected posts, each marked `guess: true`; an answer outside those bounds is refused whole. It stays in the page's memory: never stored, logged or sent to a server. The website never starts anything on X (ADR-0006), and nothing on it leads to a cleanup. Without Xomoni here, the place says where Reach lives and offers the dialog of ADR-0027.

The tests play Xomoni at the page, as Chrome exposes an extension that lists xomoni.com in `externally_connectable`: it signs in with the site's code (`pair_device` on the local stack), answers `what: 'reach'` from the summary a test gives it, and records every message. Run them with the local Supabase stack:

```bash
npm run test:e2e -w @xomoni/web -- --grep @task-431
```

CI runs them in Chromium and again in Microsoft Edge.

## S431-01 · happy

- Given Xomoni here, signed in to the person's account, whose Reach has three comparisons
- When the person opens Reach on the dashboard
- Then each comparison shows its title, each side's size and median, and its verdict in Xomoni's words, such as Clearly lower
- And a comparison with enough posts says its ratio and its 95% interval
- Test: apps/web/e2e/website-reach.spec.ts

## S431-02 · happy

- Given Xomoni's answer with posts
- When Reach shows them
- Then they are listed in the order Xomoni gives (most seen first), each with its views, where the number comes from, and its share of usual
- And each has Open on X, a link to the post that opens in a new tab
- Test: apps/web/e2e/website-reach.spec.ts

## S431-03 · happy

- Given Reach shows the most seen posts
- When the person picks Least seen, then Newest
- Then the page asks Xomoni again with that order, and lists what it answers
- Test: apps/web/e2e/website-reach.spec.ts

## S431-04 · happy

- Given Reach over the last 30 days
- When the person picks the last 90 days
- Then the page asks Xomoni for 90 days, and the period says Plus · preview
- Test: apps/web/e2e/website-reach.spec.ts

## S431-05 · happy

- Given Xomoni's answer with two months of X's labels, one of them without labels
- When Reach shows X's labels
- Then the month with a label shows its name and its posts, such as 3 posts
- And the other says No labels that month, never that it was clean
- Test: apps/web/e2e/website-reach.spec.ts

## S431-06 · happy

- Given Xomoni's answer with suspected posts
- When Reach shows them
- Then the box This is a guess. X doesn't say which posts got a label. is above them, and can't be closed
- And each has its reasons and Open on X, and nothing offers to clean it up
- Test: apps/web/e2e/website-reach.spec.ts

## S431-07 · happy

- Given Xomoni's answer with 101 posts, 100 of them on the first page
- When the person presses Next 100
- Then the page asks Xomoni for the next 100, from where the list ended, shows them, and says Posts 101–101 of 101
- Test: apps/web/e2e/website-reach.spec.ts

## S431-08 · happy

- Given Reach on the dashboard
- When the person presses Open Reach in Xomoni
- Then Xomoni is asked to open its Reach page, and nothing else
- Test: apps/web/e2e/website-reach.spec.ts

## S431-09 · empty

- Given Xomoni here, with no post whose views it knows
- When the person opens Reach
- Then it says no post has a number yet, and how to get them in Xomoni: X's analytics export, or the person's profile on X
- Test: apps/web/e2e/website-reach.spec.ts

## S431-10 · empty

- Given Xomoni's answer with posts but no month of X's labels
- When Reach shows X's labels
- Then it says to drop X's file on Xomoni's Vault page, and Suspected posts says Xomoni guesses only from that report
- Test: apps/web/e2e/website-reach.spec.ts

## S431-11 · invalid

- Given Xomoni answers a suspected post without guess: true
- When Reach reads it
- Then nothing of the answer is shown, and the page says Xomoni didn't answer about Reach
- Test: apps/web/e2e/website-reach.spec.ts

## S431-12 · invalid

- Given Xomoni answers 101 posts, more than an answer may hold
- When Reach reads it
- Then nothing of the answer is shown
- Test: apps/web/e2e/website-reach.spec.ts

## S431-13 · invalid

- Given Xomoni answers a comparison with a verdict that isn't one of the five
- When Reach reads it
- Then nothing of the answer is shown
- Test: apps/web/e2e/website-reach.spec.ts

## S431-14 · error

- Given Xomoni here answers for another account than this page's
- When Reach asks it
- Then the page says Xomoni didn't answer about Reach, and shows nothing
- Test: apps/web/e2e/website-reach.spec.ts

## S431-15 · error

- Given a Xomoni older than the page, which doesn't know the reach read
- When Reach asks it
- Then the page says Your Xomoni is older than this page and can't show Reach here yet, with Install the newest Xomoni
- Test: apps/web/e2e/website-reach.spec.ts

## S431-16 · error

- Given Xomoni here doesn't answer
- When Reach asks it
- Then the page says Xomoni didn't answer about Reach, and Try again asks again and shows what it answers
- Test: apps/web/e2e/website-reach.spec.ts

## S431-17 · security

- Given a post whose text is markup, such as an image tag with a script
- When Reach shows it
- Then it is drawn as text: no image, and no script runs
- Test: apps/web/e2e/website-reach.spec.ts

## S431-18 · security

- Given Xomoni's answer with a text only it knows
- When the person reads Reach and changes its order and period
- Then that text never reaches a server, and isn't kept in the site's storage, and every read names this browser's device
- Test: apps/web/e2e/website-reach.spec.ts

## S431-19 · security

- Given Xomoni answers a post whose id isn't X's (javascript:alert(1))
- When Reach reads it
- Then nothing of the answer is shown, so no link to it is ever drawn
- Test: apps/web/e2e/website-reach.spec.ts

## S431-20 · cancel

- Given no Xomoni in this browser
- When the person opens Reach
- Then it says Reach is read from Xomoni on the person's computer, with Open Reach in Xomoni
- And pressing it opens the dialog that says how to get Xomoni here, which Close dismisses with nothing done
- Test: apps/web/e2e/website-reach.spec.ts

## S431-21 · cancel

- Given Reach over the last 90 days
- When the person goes back to the last 30 days
- Then the page asks Xomoni for 30 days again, and the period no longer says Plus · preview
- Test: apps/web/e2e/website-reach.spec.ts

## S431-22 · a11y

- Given Reach with comparisons, posts, labels and guesses, in light mode
- When axe-core checks the page
- Then it finds no serious or critical violation
- Test: apps/web/e2e/website-reach.spec.ts

## S431-23 · a11y

- Given Reach in dark mode
- When the person moves to Least seen with the arrow keys and Enter, and reaches Open on X, and axe-core checks the page
- Then Xomoni is asked for the least seen, and axe-core finds no serious or critical violation
- Test: apps/web/e2e/website-reach.spec.ts

## S431-24 · browser

- Given Reach with every part
- When the page is as wide as a phone
- Then everything fits, and the page doesn't scroll sideways
- Test: apps/web/e2e/website-reach.spec.ts

## S431-25 · persistence

- Given Reach was read
- When Xomoni's Reach changes and the person reloads the page
- Then Reach is read from Xomoni again and shows it as it is now: the site kept nothing of the first answer
- Test: apps/web/e2e/website-reach.spec.ts

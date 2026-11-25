---
task: 430
title: R1 · P5.3 · The public digest of X's open ranking code on xomoni.com/algorithm
feature: algorithm-digest
---

# The algorithm digest on xomoni.com

xomoni.com/algorithm and its month pages (#430, [ADR-0046](../adr/0046-a-public-digest-of-xs-open-ranking-code.md)): the published digests of X's open ranking code, newest first; each month's summary, what it can't tell, the areas of the code that changed, the parameters by name and X's commit messages, all as text; the exact range on GitHub; 404 for a draft or any other address; no cookie and no request to anyone but the site. The tests' build adds three made-up digests of the year 2000: January, published with every part filled in; February, published, whose commit message is markup and which changed no parameter; March, a draft.

## S430-01 · happy

- Given a visitor on xomoni.com
- When they open /algorithm
- Then the page is titled *X’s ranking code, month by month*
- And it lists the published digests newest first, February 2000 before January 2000, with no March 2000
- And each month says how far it goes, its commits and the areas it touched, such as *Up to January 20, 2000 · 12 commits · Ranking, Filters, Parameters*
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-02 · happy

- Given a visitor on /algorithm
- When they open January 2000
- Then /algorithm/2000-01 is titled *What changed in X’s ranking code: January 2000*, with its range, commits and files under it
- And it shows the summary in its two paragraphs, *X hides the real weights*, the table of the three areas with their files,
  the two parameter names with *And 50 more.*, and X's commit message
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-03 · happy

- Given a visitor on January 2000
- When they look at *See every change on GitHub*
- Then it links the digest's exact range on GitHub, `compare/<from>...<to>`, opening in a new tab
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-04 · happy

- Given a visitor on the home page
- When they choose *Algorithm digest* in the footer
- Then /algorithm opens with the list of digests
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-05 · happy

- Given a search engine reading xomoni.com
- When it reads /sitemap.xml
- Then it finds /algorithm and each published month, January and February 2000
- And it doesn't find the draft's address
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-06 · invalid

- Given a visitor
- When they open /algorithm/2000-13, a month that can't exist
- Then the not-found page answers, with a 404
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-07 · invalid

- Given a visitor
- When they open /algorithm/latest, /algorithm/none or /algorithm/2000-1, addresses that aren't a month
- Then each answers the not-found page, with a 404
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-08 · invalid

- Given a visitor
- When they open /algorithm/1999-12, a month with no digest
- Then the not-found page answers, with a 404
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-09 · security

- Given a draft for March 2000, which no maintainer has published
- When a visitor opens its address, /algorithm/2000-03
- Then the not-found page answers, with a 404
- And /algorithm neither lists March 2000 nor shows any of its text
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-10 · security

- Given February 2000, whose commit message is a `<script>` and an `<img onerror>`, and one of whose file names is markup
- When a visitor opens it
- Then the message and the file name show as the text they are
- And no script or image is made from them, nothing in them runs, and the page meets no Content-Security-Policy violation
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-11 · security

- Given a visitor, signed out
- When they open /algorithm and then January 2000
- Then the site sets no cookie
- And the pages ask nothing of any origin but the site's: not Supabase, not GitHub, no analytics
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-12 · security

- Given a visitor on January 2000
- When they follow *See every change on GitHub*
- Then GitHub's range opens in a new tab
- And that tab can't reach back to xomoni.com's page, and isn't told where it came from
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-13 · error

- Given a visitor whose browser fails to load the site's scripts
- When they open January 2000
- Then its title, summary, table of areas and GitHub link all show, rendered on the server
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-14 · error

- Given Supabase is down
- When a visitor opens /algorithm and January 2000
- Then both show in full: the digests ask nothing of Supabase
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-15 · error

- Given GitHub can't be reached
- When a visitor opens January 2000
- Then the digest shows in full, its parameters too
- And only *See every change on GitHub* leads there
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-16 · empty

- Given February 2000, whose range changed no parameter
- When a visitor opens it
- Then it says *No parameter’s definition changed in this range.*, with no list of names
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-17 · empty

- Given xomoni.com before the first digest is published
- When a visitor opens /algorithm
- Then it says *No digest is out yet*, with how a digest is made and what it can't tell
- Manual: the tests' build always carries its sample digests, so the empty list can't be reached in a browser; the
  component test of `DigestList` with no digest proves it (src/modules/algorithm/ui/digest-list.test.tsx)

## S430-18 · cancel

- Given a visitor on January 2000
- When they choose *All digests*
- Then the list of digests opens again
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-19 · cancel

- Given a visitor who opened February 2000 from the list
- When they press the browser's Back
- Then the list shows again, with February 2000 in it
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-20 · a11y

- Given a visitor using the keyboard alone on /algorithm
- When they press Tab until January 2000 has the focus, then Enter
- Then January 2000 opens
- And Tab reaches *See every change on GitHub*
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-21 · a11y

- Given the list, January 2000 and February 2000
- When axe checks each, in light mode and in dark mode
- Then it finds no serious or critical violation
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-22 · a11y

- Given a screen reader on January 2000
- When it reads the page's structure
- Then there is one main heading, then *Summary*, *What this can’t tell you*, *Where the code changed*, *Parameters that
  changed* and *Commit messages*
- And the table names its columns, *Part of the code*, *Files* and *Some of them*, and each area as a row header
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-23 · browser

- Given a visitor on a phone 390 pixels wide, in dark mode
- When they open January 2000
- Then the page doesn't scroll sideways, and the long parameter and file names wrap within it
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-24 · persistence

- Given a link to February 2000, /algorithm/2000-02
- When a visitor opens it directly, then reloads
- Then the same digest shows both times
- Test: apps/web/e2e/algorithm-digest.spec.ts

## S430-25 · happy

- Given a person on Reach in Xomoni
- When they look below their numbers
- Then *What changed in X’s ranking code* says what the digest is and that X hides the real weights
- And *Read the digests on xomoni.com* links https://xomoni.com/algorithm in a new tab, and the page fetches nothing
- Test: apps/web/e2e/extension/reach.spec.ts

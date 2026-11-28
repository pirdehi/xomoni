---
task: 242
title: xomoni.com on a phone: user scenarios
feature: phone-menu
---

# xomoni.com on a phone

Below 768 px, xomoni.com's header folds its links into one *Menu* (#242): *How it works*, *Safety* and *Privacy*, the home page's sections, then *Install* and *GitHub*. It opens and closes with the pointer, a tap or the keyboard, and *Sign in*, or a signed-in person's account menu, stays beside it. The home page, the install guide, the risks, the privacy policy and the terms have this header, and they, the dashboard and the account page end with the full footer: the credits and *Install*, *What's new*, *Risks*, *Privacy*, *Terms*, *Security*, *Support* and *GitHub*. The pages of the signed-in app show only the account corner in the header; the dashboard's own bar on a phone has its own scenarios (#245). Written for #345, the features shipped before the scenarios gate.

The tests run xomoni.com in a real browser at a phone's width, 390 × 844, against the local stack. Where a scenario follows a link to github.com, the test answers for GitHub, so nothing leaves the computer. Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-242
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S242-01 · happy

- Given a visitor on the home page, on a phone, where the header shows the logo, Menu and Sign in, but no section links
- When they open the Menu and choose Safety
- Then the menu closes, the address ends in /#safety, and the Safety section sits at the top of the screen, its
  heading just below the header
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-02 · happy

- Given a visitor on the home page, on a phone
- When they open the Menu and choose GitHub
- Then the project's repository opens, github.com/pirdehi/xomoni
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-03 · happy

- Given a phone
- When the visitor scrolls to the end of the home page, the install guide, the risks, the privacy policy and the terms
- Then each ends with the footer: © 2026 Omid Pirdehi, linked to his GitHub, MIT license, Not affiliated with X Corp.,
  and Install, What's new, Risks, Privacy, Terms, Security, Support and GitHub, in that order, with Terms of sale and
  Refunds after Terms while the pages for paid plans are shown, as in the browser tests (#420)
- And every link fits within the phone's width, and nothing on the page is wider than the screen
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-04 · happy

- Given a visitor on the home page, on a phone
- When they follow the footer's Install, then Risks, Privacy and Terms from each page they land on
- Then each opens its page: the install guide, the risks, the privacy policy and the terms of use
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-05 · happy

- Given a visitor who scrolled the home page down to the footer, on a phone
- When they look up and open the Menu
- Then the header is still at the top of the screen with its Menu, and How it works brings that section back, just
  below the header
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-06 · invalid

- Given a visitor on the risks page, which has no How it works section
- When they choose How it works in the Menu
- Then the home page opens at /#how, with the How it works section at the top of the screen, below the header
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-07 · invalid

- Given a visitor reading the privacy policy, on a phone, with two links named Privacy: one in the Menu, one in the
  footer
- When they choose Privacy in the Menu, then Privacy in the footer
- Then the Menu's leads to the home page's Privacy section, and the footer's back to the privacy policy
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-08 · invalid

- Given a visitor who came from the risks page to the install guide
- When they choose Install in the Menu, the page they are on
- Then the install guide loads again, with the menu closed, and no second entry is added to the tab's history: Back
  leads to the risks page
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-09 · invalid

- Given a visitor at the home page's How it works, who scrolled back to the top
- When they choose How it works in the Menu again, the address already ending in /#how
- Then the section comes back to the top of the screen, with no new entry in the tab's history: Back leaves /#how
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-10 · invalid

- Given the Menu open on the home page, on a phone
- When the screen gets shorter but stays a phone's width, then the phone is turned on its side, 844 px wide
- Then the menu stays open under its button while the screen is narrow, and closes once it turns: the header has room
  for How it works, Safety, Privacy, GitHub and Install, and no menu floats over the logo
- And turned upright again, the Menu is closed until it is opened, and opens with its five links
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-11 · error

- Given a browser whose session cookie can't be read, such as one damaged or cut short
- When it opens the home page, on a phone
- Then the header shows Sign in, as to a visitor, with no account menu and no error, and the Menu opens with its five
  links, Install leading to the install guide
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-12 · error

- Given a signed-in person whose browser can't reach Supabase
- When they open the home page on a phone
- Then the header still shows their account menu, read from this browser's cookie, and the Menu opens with its five
  links, Install leading to the install guide
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-13 · error

- Given a phone on which the page's JavaScript doesn't run, blocked or failed to load
- When the visitor looks for the install guide, the risks or the terms
- Then the footer lists every page, and its links lead there as plain links: Install, Risks and Terms each open their
  page
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-14 · error

- Given a visitor on the install guide, on a phone, while github.com can't be reached
- When they choose GitHub in the Menu, and go Back from the browser's error page
- Then the install guide is back, with the menu closed, and the Menu opens again with its five links
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-15 · error

- Given the logo's image failing to load
- When a visitor on the install guide looks at the header and follows the logo
- Then the logo is still a link named Xomoni, the image being decorative, and it leads to the home page
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-16 · security

- Given a visitor on /install?from=newsletter, on a phone
- When they choose GitHub in the Menu
- Then GitHub opens in the same tab, not a new one, so it has no hold on xomoni.com's page (`window.opener` is null)
- And GitHub is told only the site's origin as the referrer, never the page's path or its query
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-17 · security

- Given a visitor, signed out, on the home page, on a phone
- When they open the Menu and look at the footer
- Then the header offers Sign in and no account menu, and every link in the menu and the footer is one of the site's
  public pages or sections or the project on github.com, over https: no Dashboard, Account or Sign out
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-18 · security

- Given a signed-in person on the home page, on a phone, with their account menu beside the Menu
- When they open the Menu and look at the footer
- Then both have exactly a visitor's links, with no Dashboard, Account or Sign out in the Menu
- And no link carries the person's email, their account's id or their session
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-19 · empty

- Given a first visit, nothing of xomoni.com in this browser yet
- When the visitor opens the home page on a phone, opens the Menu, and closes it with Escape
- Then Sign in stands beside the Menu, the menu shows its five links, and opening and closing it adds no cookie and
  nothing to the browser's storage
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-20 · empty

- Given a new account with nothing yet, signed in
- When the person opens their account page on a phone
- Then the header has no Menu and no section links, only their account menu, and the page ends with the full footer
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-21 · cancel

- Given the Menu open on the home page, on a phone
- When the visitor taps the page outside it
- Then the menu closes, nothing is followed, and the page stays where it was
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-22 · cancel

- Given the Menu open, its button saying it is expanded
- When the visitor presses Menu again
- Then the menu closes, the button no longer says it is expanded, and the page stays the same
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-23 · cancel

- Given the Menu opened with the keyboard, the focus on How it works
- When the visitor presses Tab, then opens it again and presses Shift+Tab
- Then Tab closes it and moves on to Sign in, and Shift+Tab closes it and moves back to the logo
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-24 · cancel

- Given the Menu opened with the keyboard, and the focus moved up to GitHub
- When the visitor presses Escape
- Then the menu closes without following GitHub, and the focus is back on the Menu button
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-25 · a11y

- Given a visitor using the keyboard alone, at the top of the home page on a phone
- When they press Tab twice, then Space, then the arrow keys, Home and End
- Then Tab reaches the logo, then Menu; Space opens it on How it works; Down and Up go round the five items, from
  GitHub back to How it works and the other way; Home and End go to the first and the last
- And Enter on Install opens the install guide
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-26 · a11y

- Given a screen reader on the home page, on a phone
- When it reads the header, opens the Menu, and reads the footer
- Then the header's links are a navigation named Main, the footer's a navigation named Site; the button is named Menu
  and says it opens a menu, and that it is expanded while open; the menu is named Menu, and each item by its link
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-27 · a11y

- Given a phone, in light mode, then in dark mode
- When the Menu is open on the install guide, the risks, the privacy policy and the terms, and then the footer is in
  view
- Then axe finds no serious or critical violation
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-28 · browser

- Given an iPhone, used by touch
- When the visitor taps Menu, then Safety
- Then the menu opens, closes as Safety is reached at the top of the screen, and nothing is wider than the screen
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-29 · browser

- Given a window 767 px wide, then 768 px
- When the visitor looks at the header
- Then at 767 px it shows the Menu and hides the links; from 768 px it shows How it works, Safety, Privacy, Install and
  GitHub, each leading where the menu's would, and no Menu
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-30 · persistence

- Given a visitor at the home page's Safety section, with the Menu open again
- When they reload the page
- Then the address still ends in /#safety, the Safety section is in view, the menu is closed, and it opens again
- Test: apps/web/e2e/phone-menu.spec.ts

## S242-31 · persistence

- Given a visitor who went from the risks page to the install guide through the Menu
- When they go Back, then Forward
- Then Back shows the risks page with the menu closed, and Forward the install guide
- Test: apps/web/e2e/phone-menu.spec.ts

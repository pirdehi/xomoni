---
task: 420
title: 'R1 · CB.1.4: the terms of sale, the refund policy and the privacy page'
feature: terms-of-sale
---

# The terms of sale, the refund policy and the privacy page

xomoni.com's pages for paid plans (#420, [ADR-0042](../adr/0042-payments-and-entitlements-with-polar.md)): the terms of sale at /terms-of-sale, the refund policy at /refunds, and the parts of /privacy and /terms about paid plans. Their texts are drafts that wait for the maintainer's approval, so they show only while the server's `BILLING_PAGES` is `1`, as on a Preview where the maintainer reviews them, and as in the browser tests below. Each page says it is a draft. While the switch is off, as in production until the texts are approved, /terms-of-sale and /refunds answer 404, the footer and the sitemap don't list them, and /privacy and /terms read as before: the unit tests of each page, the footer and the sitemap prove that state. Nothing here sells anything yet: checkout and /pricing come with #421 and #422.

## S420-01 · happy

- Given a visitor on xomoni.com, with the pages for paid plans shown
- When they open /terms-of-sale
- Then the Terms of Sale show, with a Draft notice saying nothing on the page is in force yet and paid plans aren't on
  sale
- And they say Polar, the merchant of record, sells the plans and keeps the card, and Xomoni never sees it
- And they cover what is bought, the price and taxes, renewing and cancelling, a plan that ends, refunds, no promise
  about X, a plan that stops, the visitor's rights, and changes and contact
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-02 · happy

- Given a visitor with the pages for paid plans shown
- When they open /refunds
- Then the Refund Policy shows, with its Draft notice
- And it gives 14 days after a first payment, after buying a one-time pass, and after an unwanted renewal
- And it says to ask by email, with the address linked, and that Polar pays the refund back to the card or account
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-03 · happy

- Given a visitor on the home page
- When they look at the footer
- Then Terms of sale and Refunds follow Terms
- And each opens its page: the Terms of Sale and the Refund Policy
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-04 · happy

- Given a visitor on the privacy policy, with the pages for paid plans shown
- When they read it
- Then a Draft notice says the parts about paid plans wait for the maintainer's approval
- And what is stored lists the plan, only if one is bought: its plan, status and dates and Polar's ids, never the card,
  the billing address or anything about the X account
- And the service providers name Polar as the merchant of record, which never receives anything about the X account
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-05 · happy

- Given a visitor on the terms of use, with the pages for paid plans shown
- When they read the research project's paragraph
- Then it says paid plans are sold under the Terms of Sale, linked, and that Xomoni still comes with no guarantee
- And following the link opens the Terms of Sale
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-06 · invalid

- Given a visitor who types /refund, without the s
- When the page loads
- Then the site's not-found page shows, with a 404, and none of the refund policy
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-07 · invalid

- Given a visitor who types /Terms-of-Sale, with capitals
- When the page loads
- Then the not-found page shows, with a 404: the address is the lower-case one
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-08 · invalid

- Given a visitor who adds a part to the address, /terms-of-sale/plus or /refunds/2026
- When the page loads
- Then the not-found page shows, with a 404, and no part of either page
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-09 · error

- Given a visitor whose browser can't reach xomoni.com's Supabase
- When they open /terms-of-sale
- Then the whole text shows, with its headings and its Draft notice: the page needs no database
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-10 · error

- Given a visitor whose browser fails to load the site's scripts
- When they open /refunds
- Then the whole policy still shows, as the server wrote it, with its headings, its email link and its Draft notice
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-11 · error

- Given a visitor whose browser fails to load the site's scripts
- When they open the terms of use and follow the link to the Terms of Sale
- Then the Terms of Sale open, as a plain link does without scripts
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-12 · security

- Given a visitor on /terms-of-sale, then /refunds
- When they look for anything to fill in
- Then neither page has a form, a text box or a card field: they ask for nothing
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-13 · security

- Given a visitor who opens /terms-of-sale and /refunds
- When the pages have loaded
- Then the browser asked only xomoni.com and its Supabase for anything, never Polar or another site
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-14 · security

- Given a visitor who reads both pages
- When they look for what a plan does on X
- Then the Terms of Sale say a plan changes nothing about how X treats the account, and promise no reach, no fewer
  limits and no locked or suspended account back
- And the Refund Policy says a refund can't undo anything on X
- And neither page promises a result on X anywhere
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-15 · security

- Given a visitor who opens /terms-of-sale and /refunds
- When the server answers
- Then each comes with the site's security headers: no framing by another site, and the site's Content-Security-Policy
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-16 · empty

- Given a visitor with no Xomoni account, signed out
- When they open both pages
- Then each shows in full, with Sign in in the header, and nothing sends them to sign in first
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-17 · empty

- Given a visitor before sales open
- When they look over both pages
- Then there is nothing to buy: no Buy, Upgrade, Subscribe or Checkout button or link
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-18 · cancel

- Given a visitor on the Terms of Sale
- When they read Renewal and cancelling
- Then it says a subscription renews until cancelled, can be cancelled at any time from Polar's customer portal, and
  stays until the end of the period paid for, with no further charge
- And that a one-time pass has nothing to cancel, and deleting the Xomoni account cancels the subscription first
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-19 · cancel

- Given a visitor who opened the Refund Policy from the home page's footer
- When they go back
- Then the home page shows again
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-20 · a11y

- Given both pages and the privacy policy, in light and in dark mode
- When axe checks them
- Then it finds no serious or critical violation, the Draft notice included
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-21 · a11y

- Given a keyboard user on the home page, with the focus on the footer's Terms
- When they press Tab, then Tab again
- Then Terms of sale and then Refunds take the focus, by those names
- And Enter on Refunds opens the Refund Policy, with one main heading and its sections as headings below it
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-22 · browser

- Given a phone, 390 pixels wide
- When the visitor opens /terms-of-sale and /refunds
- Then nothing is wider than the screen, the Draft notice included
- Test: apps/web/e2e/terms-of-sale.spec.ts

## S420-23 · persistence

- Given a visitor on the Refund Policy
- When they reload it, and open the Terms of Sale in a second tab
- Then each still shows its text and its Draft notice: the draft is the page's, not the visit's
- Test: apps/web/e2e/terms-of-sale.spec.ts

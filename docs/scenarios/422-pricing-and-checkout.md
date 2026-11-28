---
task: 422
title: 'R1 · CB.3: /pricing, /account/billing and buying a plan, with the fake Polar'
feature: paid-plans
---

# The plans, buying one and managing it

xomoni.com's `/pricing` and `/account/billing` (#422, [ADR-0042](../adr/0042-payments-and-entitlements-with-polar.md)), on the checkout, the portal and the webhook of #421. They are pages for paid plans, so they show only while the server's `BILLING_PAGES` is `1`, as in the browser tests (production keeps them off until the maintainer approves the texts, as for /terms-of-sale). Sales are closed until the maintainer opens them (`billing_settings.live`); the tests open them with the service-role key, as the maintainer does, and close them again. Polar is the fake of `apps/web/e2e/support/polar.ts` on this computer: its checkout page offers *Pay* and *Back*, and *Pay* sends its signed event to the site's own webhook. No price is shown: Polar shows it at checkout.

## S422-01 · empty

- Given a visitor, before sales open
- When they open /pricing
- Then Free, Plus, Pro and 30 days of Plus show, each paid plan marked Plus · preview, with a line that paid plans
  aren't on sale yet
- And each paid plan's button says Coming soon and does nothing, there is no Buy button, and Polar is asked nothing
- Test: apps/web/e2e/pricing.spec.ts

## S422-02 · happy

- Given a person signed in on Free, once sales are open
- When they press Buy Plus, monthly, then Pay on Polar's checkout
- Then Polar's checkout names their account and Plus monthly, with no discount
- And they come back to Billing, which says Your plan: Plus, and their plan is Plus, active, from a subscription
- Test: apps/web/e2e/pricing.spec.ts

## S422-03 · happy

- Given a person signed in on Free, once sales are open
- When they choose Yearly and buy Pro
- Then the checkout is Pro yearly with the founders' discount
- And once paid, Billing says Your plan: Pro, and the plan is marked as a founding one
- Test: apps/web/e2e/pricing.spec.ts

## S422-04 · happy

- Given a person who pays for Plus
- When they press Manage billing on Billing
- Then Polar's customer portal opens
- Test: apps/web/e2e/pricing.spec.ts

## S422-05 · happy

- Given a person signed in on Free, once sales are open
- When they buy 30 days of Plus and pay
- Then Billing says Your plan: Plus, from a one-time pass
- Test: apps/web/e2e/pricing.spec.ts

## S422-06 · invalid

- Given a person on /pricing whose page was changed to ask for a plan named gold
- When they press Buy
- Then the page says that plan isn't one we sell, and no checkout is made
- Test: apps/web/e2e/pricing.spec.ts

## S422-07 · invalid

- Given a person on /pricing whose page was changed to ask for a weekly Pro
- When they press Buy
- Then the page says that plan isn't one we sell, and no checkout is made
- Test: apps/web/e2e/pricing.spec.ts

## S422-08 · invalid

- Given a person who opened /pricing on Free, and whose Plus started since, in another tab
- When they press Buy Pro, monthly on the page they had open
- Then they are sent to Billing, which says Your plan: Plus, and no second checkout is made
- Test: apps/web/e2e/pricing.spec.ts

## S422-09 · error

- Given Polar can't be reached
- When a person presses Buy Plus, monthly
- Then the page says Polar couldn't be reached and nothing was charged, and they have no plan
- Test: apps/web/e2e/pricing.spec.ts

## S422-10 · error

- Given Polar's event is late
- When a person pays and comes back to Billing
- Then Billing says it is confirming the payment
- And Refresh asks Polar, says the plan is up to date, and after a reload Billing says Your plan: Plus
- Test: apps/web/e2e/pricing.spec.ts

## S422-11 · error

- Given a person who pays, and Polar can't be reached
- When they press Manage billing
- Then the page says Polar couldn't be reached, and they stay on Billing
- Test: apps/web/e2e/pricing.spec.ts

## S422-12 · security

- Given a visitor on /pricing, once sales are open
- When they press Sign in to buy Plus and sign in
- Then they sign in at /login, and come back to /pricing, where they can buy
- Test: apps/web/e2e/pricing.spec.ts

## S422-13 · security

- Given a visitor who isn't signed in
- When they open /account/billing
- Then they are sent to sign in, to come back to Billing after
- Test: apps/web/e2e/pricing.spec.ts

## S422-14 · security

- Given one person who pays for Pro
- When another person opens Billing
- Then they see their own plan, Free, and nothing of the other's
- Test: apps/web/e2e/pricing.spec.ts

## S422-15 · security

- Given a signed-in person, once sales are open
- When they open /pricing and Billing
- Then the browser asks only the site and its Supabase for anything, and Polar is asked nothing until a purchase
- Test: apps/web/e2e/pricing.spec.ts

## S422-16 · security

- Given an event in Polar's shape, for a person's account
- When it is sent to the webhook without Polar's signature, or with a signature an hour old
- Then the webhook refuses it, and the person has no plan
- Test: apps/web/e2e/pricing.spec.ts

## S422-17 · empty

- Given a person who never bought, once sales are open
- When they open Billing and press Manage billing
- Then Billing says Your plan: Free, and that they haven't bought a plan yet, so there is nothing to manage
- Test: apps/web/e2e/pricing.spec.ts

## S422-18 · empty

- Given a signed-in person, before sales open
- When they open Billing
- Then it says Your plan: Free, and that paid plans aren't on sale yet
- Test: apps/web/e2e/pricing.spec.ts

## S422-19 · cancel

- Given a person on Polar's checkout for Plus
- When they press Back instead of Pay
- Then they are on /pricing again, can still buy, and have no plan
- Test: apps/web/e2e/pricing.spec.ts

## S422-20 · cancel

- Given a person who canceled their Plus, which runs 12 more days
- When they open Billing
- Then it says the plan is canceled, until when it stays, and that it won't renew, with Manage billing still there
- Test: apps/web/e2e/pricing.spec.ts

## S422-21 · a11y

- Given /pricing before and after sales open, and Billing with a payment Polar is retrying
- When axe checks each, in light and in dark mode
- Then it finds no serious or critical violation
- Test: apps/web/e2e/pricing.spec.ts

## S422-22 · a11y

- Given a person on /pricing who uses the keyboard alone
- When they move the billing period to Yearly with the arrow keys, Tab to Buy Plus, yearly, and press Enter
- Then Polar's checkout opens
- Test: apps/web/e2e/pricing.spec.ts

## S422-23 · browser

- Given a phone, 390 pixels wide
- When a person who pays opens /pricing and Billing, in light and in dark mode
- Then nothing is wider than the screen, and axe finds no serious or critical violation
- Test: apps/web/e2e/pricing.spec.ts

## S422-24 · persistence

- Given a person who pays for Pro, on Billing
- When they reload it, and open it in a second tab
- Then each says Your plan: Pro
- Test: apps/web/e2e/pricing.spec.ts

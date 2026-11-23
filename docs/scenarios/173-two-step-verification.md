---
task: 173
title: Two-step verification: user scenarios
feature: two-step-verification
---

# Two-step verification

An account on xomoni.com can ask for a code from an authenticator app after the password or Google (#173, #148, [ADR-0036](../adr/0036-two-step-verification-with-an-authenticator-app.md)). The account page adds apps, by a QR code or a key shown once, and removes them. Once an app is added, the server holds a session that has only the password at the code page: Row Level Security and Supabase Auth refuse it every private row and every change to the account. Each app added or removed is told to the account's address. Written for #345, the features shipped before the scenarios gate.

The tests run the website against the local stack's real Supabase Auth and Mailpit. They make each code from the secret the page shows, as an authenticator app would (`e2e/support/totp.ts`), and some sign in through the API, as someone who has only the password would. Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-173
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S173-01 · happy

- Given a person signed in, with no authenticator app
- When they turn two-step verification on, scan the QR code and enter the app's first code
- Then it is on, the app is listed and the key is no longer shown, and their address gets Authenticator app added
- And signing in again asks for a code after the password: a wrong one is refused, with no serious accessibility
  violation, and the right one opens the dashboard
- Test: apps/web/e2e/two-factor.spec.ts

## S173-02 · security

- Given an account with an app, signed in with the password alone
- When the person, or someone with their password, opens the dashboard, a report, the account page, the new-password
  page or the sign-in page
- Then the server sends each to the code page, keeping where it was going, and shows nothing of the account
- Test: apps/web/e2e/two-factor.spec.ts

## S173-03 · security

- Given an account with an app, and someone who has only its password, calling the API directly
- When they read the devices, ask for a pairing code, delete the account, remove or add an app, or change the password
- Then the database shows them no device, and every one of those is refused until a code is given; the owner, with a
  code, reads the account as before
- Test: apps/web/e2e/two-factor.spec.ts

## S173-04 · security

- Given a challenge answered with its code
- When the same challenge is answered again with the same code
- Then it is refused: each challenge works once
- Test: apps/web/e2e/two-factor.spec.ts

## S173-05 · cancel

- Given the person halfway through adding their first app, the key shown
- When they leave the page without a code, then sign out and in
- Then nothing changed: it is off, sign-in asks for no code, and adding an app again works
- Test: apps/web/e2e/two-factor.spec.ts

## S173-06 · happy

- Given two-step verification on with one app
- When the person removes it and confirms in the dialog, which says two-step verification turns off
- Then it is off, their address gets Authenticator app removed, and signing in asks for no code
- Test: apps/web/e2e/two-factor.spec.ts

## S173-07 · security

- Given an account with an app
- When the person resets their password from the emailed link
- Then the link alone leads to the code page, and only after a code can they choose the new password
- Test: apps/web/e2e/two-factor.spec.ts

## S173-08 · happy

- Given two-step verification on
- When the person changes their password, with the current one and a code
- Then it is saved, their address is told, no app is removed, and the new password signs in with a code
- Test: apps/web/e2e/two-factor.spec.ts

## S173-09 · invalid

- Given the code page
- When the person sends no code, five digits, or a letter among the digits
- Then the field says Enter the 6-digit code from your app, The code has 6 digits, or The code has only numbers, and
  they stay on the code page
- Test: apps/web/e2e/two-factor.spec.ts

## S173-10 · invalid

- Given the person adding their first app
- When they enter a code that isn't the app's, then the app's
- Then the first is refused, That code didn't work, with nothing turned on, and the second turns it on
- Test: apps/web/e2e/two-factor.spec.ts

## S173-11 · invalid

- Given an app named Authenticator app
- When the person adds another app with the same name
- Then the form says You already have an app with that name, and shows no QR code
- Test: apps/web/e2e/two-factor.spec.ts

## S173-12 · happy

- Given two-step verification on
- When the person adds a second app, named Tablet
- Then both are listed, either app's code signs in, and the address is told of each app added
- Test: apps/web/e2e/two-factor.spec.ts

## S173-13 · cancel

- Given two-step verification on with one app
- When the person starts removing it and presses Cancel in the dialog
- Then the app stays, two-step verification stays on, and no email says an app was removed
- Test: apps/web/e2e/two-factor.spec.ts

## S173-14 · cancel

- Given the QR code of the first app on screen
- When the person presses Cancel
- Then it is off, with Turn on two-step verification, and sign-in asks for no code
- Test: apps/web/e2e/two-factor.spec.ts

## S173-15 · error

- Given the code page
- When the person enters a code the app showed five minutes ago
- Then it is refused, That code didn't work, the field is emptied for the newest code, and the newest one signs in
- Test: apps/web/e2e/two-factor.spec.ts

## S173-16 · error

- Given the code page after the password
- When the person presses Sign out there instead
- Then the half-done sign-in ends: the dashboard asks them to sign in from the start
- Test: apps/web/e2e/two-factor.spec.ts

## S173-17 · empty

- Given an account with no app
- When the person opens the account page, then signs out and in
- Then it says Off, and how to add an app, with Turn on two-step verification and no list of apps, and sign-in needs
  only the password
- Test: apps/web/e2e/two-factor.spec.ts

## S173-18 · a11y

- Given the code page
- When the person uses only the keyboard: types the code as the app shows it, in two groups of three, and presses Enter
- Then the field had the focus from the start, and the dashboard opens
- Test: apps/web/e2e/two-factor.spec.ts

## S173-19 · a11y

- Given the step that shows the QR code and the key
- When it is checked with axe, in light and dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/two-factor.spec.ts

## S173-20 · browser

- Given a phone's screen
- When the person adds an app
- Then the QR code, the key and the field fit, with nothing to scroll sideways (and CI's e2e-edge runs every scenario
  in Microsoft Edge)
- Test: apps/web/e2e/two-factor.spec.ts

## S173-21 · persistence

- Given a session that gave its code
- When the person reloads and opens other private pages, then signs in from another browser
- Then the session asks for no code again, and the other browser asks for its own
- Test: apps/web/e2e/two-factor.spec.ts

## S173-22 · security

- Given the person adding an app
- When the QR code shows, and they turn it on
- Then it is drawn in the page from the key, an image of the page's own rather than one fetched from a QR code service,
  and no request carries the key, through to the app's first code
- Test: apps/web/e2e/two-factor.spec.ts

## S173-23 · security

- Given the code page, and an app that is lost
- When the person opens Lost your authenticator app?
- Then the only way in without a code is to write from the account's address, after which the apps are removed only
  days later, with the address told; the page offers nothing else than Verify and Sign out
- Test: apps/web/e2e/two-factor.spec.ts

## S173-24 · empty

- Given a session that owes no code: an account with no app, or no one signed in
- When it opens the code page's address
- Then there is no code to give: the account goes on to the page it asked for, and the visitor to sign in
- Test: apps/web/e2e/two-factor.spec.ts

## S173-25 · error

- Given an account with two apps, one of them since removed
- When the person signs in with a code from the removed app, then from the other
- Then the removed app's code is refused, That code didn't work, and the other app's signs in
- Test: apps/web/e2e/two-factor.spec.ts

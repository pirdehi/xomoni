---
task: 244
title: A checklist that ticks itself on /welcome: user scenarios
feature: welcome
---

# A checklist that ticks itself: /welcome

When Xomoni is installed, it opens its dashboard and, in front of it, xomoni.com/welcome with its id in the address's fragment, `#ext=<id>`, which never reaches a server (#244, [ADR-0025](../adr/0025-one-sign-in-for-the-website-and-the-extension.md)). Only an install opens it, never an update. The page keeps the id in the browser, clears it from the address bar, and shows three steps, each ticked from what the page sees by itself:

- **Install Xomoni in this browser**: Xomoni answers the page's hello there.
- **Sign in to xomoni.com, or create a free account**: someone is signed in on xomoni.com in this browser.
- **Xomoni signs in with you, in this browser**: Xomoni reports a connection; the one sign-in brings it about by itself.

Under the steps is the next one's button: *Install Xomoni*, *Create a free account* and *Sign in*, or, once all three are done, *Open your dashboard*. Signing up or in from the page comes back to it, the confirmation email included. Once Xomoni answers, the page says how to pin it to the toolbar. *Continue without an account* closes the tab, or says it can be closed. An account stays optional, and the page asks Xomoni nothing but how it stands until someone signs in.

Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: a person sent from /welcome to create an account who pressed *Already have an account? Sign in* lost the way back, and landed on the dashboard after signing in; the links between /signup and /login now keep `?next=` (S244-15).

The tests run on both sides:

- **xomoni.com** (S244-01 to S244-22, `apps/web/e2e/welcome.spec.ts`): the website against the local stack, with Xomoni played at the page, as Chrome exposes an extension that lists xomoni.com in `externally_connectable`. It answers a hello as installed, as gone (Chrome's `lastError`), not at all, or out of shape, signs in with the site's code through `pair_device`, and signs out.
- **Xomoni** (S244-23 to S244-27, `apps/web/e2e/extension/welcome.spec.ts`): the built extension in a real browser ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)). At install, the harness lets the xomoni.com/welcome tab go and blocks it, as if xomoni.com were out of reach; a test that needs xomoni.com plays it at the extension (`apps/web/e2e/support/xomoni-site.ts`) and loads the tab again.

What one sign-in does once a page has found Xomoni, the messages and who may send them, is in [`232-one-sign-in.md`](232-one-sign-in.md); the same checklist on /install is in [`299-install-page.md`](299-install-page.md).

Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-244
npm run test:e2e:extension -w @xomoni/web -- --grep @task-244
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S244-01 · happy

- Given Xomoni just installed in this browser, with no account
- When it opens xomoni.com/welcome with its id in the fragment
- Then the page says Welcome to Xomoni, and its steps read Install Xomoni in this browser: done, then Sign in to
  xomoni.com, or create a free account, and Xomoni signs in with you, in this browser, both to do
- And it offers Create a free account (/signup?next=%2Fwelcome) and Sign in (/login?next=%2Fwelcome), how to pin
  Xomoni to the toolbar (the puzzle icon, then the pin; Show in toolbar in Edge), and Continue without an account
- And the address bar reads /welcome, the id is kept in this browser, and Xomoni was only asked how it stands
- Test: apps/web/e2e/welcome.spec.ts

## S244-02 · happy

- Given /welcome opened by Xomoni, and a person with no account
- When they press Create a free account, fill in the form, and open the confirmation email's link
- Then the link carries next=/welcome, and confirming it brings them back to /welcome, signed in
- And the page hands Xomoni a one-time code by itself, Xomoni signs in with the new account, and all three steps read
  done, with Open your dashboard, which opens the dashboard
- Test: apps/web/e2e/welcome.spec.ts

## S244-03 · happy

- Given /welcome opened by Xomoni, and a person with an account
- When they press Sign in and sign in
- Then they come back to /welcome, where the steps tick as Xomoni signs in, announced politely, until all three read
  done
- And Create a free account and Sign in are gone; Open your dashboard opens the dashboard
- Test: apps/web/e2e/welcome.spec.ts

## S244-04 · invalid

- Given a /welcome address whose fragment names no extension id: capital letters, 16 letters, or letters past p
- When the page opens
- Then it keeps no id, sends nothing to that id, and shows Install Xomoni as the next step, with no pin hint
- Test: apps/web/e2e/welcome.spec.ts

## S244-05 · invalid

- Given Xomoni in this browser answering the page's hello out of shape (a version that isn't text, a connection that
  isn't one)
- When it opens /welcome
- Then the page takes it as no answer: Install Xomoni is the next step, there is no pin hint, and it asks Xomoni
  nothing more
- Test: apps/web/e2e/welcome.spec.ts

## S244-06 · invalid

- Given the sign-in page opened from /welcome's Sign in
- When the person types a wrong password
- Then it says That email and password don’t match an account., stays at /login?next=%2Fwelcome, and Xomoni is
  handed nothing
- And with the right password they come back to /welcome, all three steps done
- Test: apps/web/e2e/welcome.spec.ts

## S244-07 · error

- Given an id the site kept, of a Xomoni removed or turned off since: Chrome answers that nobody is there
- When /welcome opens
- Then Install Xomoni in this browser is to do, with Install Xomoni to /install and no pin hint, and the id is kept
  to ask again
- And once Xomoni answers again, the page ticks the step and shows the pin hint as soon as it comes back into view
- Test: apps/web/e2e/welcome.spec.ts

## S244-08 · error

- Given a Xomoni in this browser that never answers
- When /welcome opens with its id
- Then the first and last steps read checking… and no Install Xomoni shows while the page waits
- And after 5 seconds without an answer, both are to do and Install Xomoni is the next step, with no pin hint
- Test: apps/web/e2e/welcome.spec.ts

## S244-09 · error

- Given /welcome opened by Xomoni, and xomoni.com failing to make the one-time code that signs Xomoni in
- When the person signs in from the page
- Then they come back to /welcome with Xomoni signs in with you to do, and the page says Xomoni signs in with you by
  itself in this browser. If it hasn’t, open Xomoni and press Sign in to xomoni.com once., with no Open your dashboard
- And Xomoni is handed nothing; once xomoni.com makes codes again, the page signs Xomoni in as it comes back into view
  and all three steps read done
- Test: apps/web/e2e/welcome.spec.ts

## S244-10 · security

- Given /welcome opened by Xomoni with its id in the fragment
- When the person signs in from it and Xomoni signs in with them
- Then no request to xomoni.com or its database carries the id, in its address, its referrer or its body, and the
  address bar no longer shows it
- Test: apps/web/e2e/welcome.spec.ts

## S244-11 · security

- Given no one signed in on xomoni.com, and Xomoni signed in to an account a minute ago
- When /welcome opens, comes back into view and is reloaded
- Then the page only asks Xomoni how it stands: it never signs it in or out, and Xomoni keeps its account
- And the steps read Install Xomoni in this browser: done, Sign in to xomoni.com to do, and Xomoni signs in with you:
  done, since Xomoni is signed in here
- Test: apps/web/e2e/welcome.spec.ts

## S244-12 · security

- Given /welcome opened by a new Xomoni
- When the person signs in from the page
- Then Xomoni gets exactly one one-time code, through Chrome's channel, naming no connection to replace; the code is in
  no address the page went to and in neither of the page's storages
- And once Xomoni is one of the account's browsers, a reload or the page coming back into view hands it nothing more
- Test: apps/web/e2e/welcome.spec.ts

## S244-13 · empty

- Given a browser with no Xomoni and no one signed in
- When the person opens /welcome
- Then all three steps are to do, Install Xomoni is the next step and leads to /install, and there is no pin hint, no
  Create a free account and no Open your dashboard
- And the site keeps no id
- Test: apps/web/e2e/welcome.spec.ts

## S244-14 · empty

- Given a person signed in on xomoni.com, in a browser with no Xomoni yet
- When they open /welcome
- Then Sign in to xomoni.com reads done, and installing Xomoni is the next step, with no Create a free account, no
  Sign in and no Open your dashboard
- Test: apps/web/e2e/welcome.spec.ts

## S244-15 · cancel

- Given the sign-up form opened from /welcome's Create a free account
- When the person changes their mind and presses Already have an account? Sign in, then signs in
- Then the sign-in page is /login?next=%2Fwelcome, its New to Xomoni? Create an account goes back to
  /signup?next=%2Fwelcome, and signing in brings them back to /welcome, all three steps done
- Test: apps/web/e2e/welcome.spec.ts

## S244-16 · cancel

- Given /welcome in a tab with nothing before it in its history, as the one Xomoni opens
- When the person presses Continue without an account
- Then the tab closes, no account is made, and Xomoni was only asked how it stands
- Test: apps/web/e2e/welcome.spec.ts

## S244-17 · cancel

- Given /welcome in a tab the person came to from another page of the site, which a page can't close
- When they press Continue without an account
- Then the page stays and says You can close this tab: Xomoni is ready on your computer., the steps as they were, and
  Xomoni was only asked how it stands
- Test: apps/web/e2e/welcome.spec.ts

## S244-18 · a11y

- Given a person using only the keyboard on /welcome, opened by Xomoni
- When they Tab to Create a free account, Sign in and Continue without an account, and press Enter on each
- Then each does what a click does: the sign-up and sign-in pages bound for /welcome, and the note that the tab can be
  closed
- And the checklist is a region named Getting started, whose steps are announced politely as they tick
- Test: apps/web/e2e/welcome.spec.ts

## S244-19 · a11y

- Given /welcome with Xomoni here and no one signed in, the same after Continue without an account, and once every
  step is done
- When axe checks each, in light and in dark mode
- Then none has a serious or critical violation
- Test: apps/web/e2e/welcome.spec.ts

## S244-20 · browser

- Given an iPhone, 390 pixels wide, with no Xomoni
- When the person opens /welcome
- Then the title, the three steps, Install Xomoni and Continue without an account show, and nothing is wider than the
  screen
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/welcome.spec.ts

## S244-21 · persistence

- Given /welcome opened once by Xomoni, which named itself in the fragment
- When the person reloads it, and opens /welcome in a second tab with no id in its address
- Then both find Xomoni from the id kept in this browser: Install Xomoni in this browser: done, with the pin hint
- Test: apps/web/e2e/welcome.spec.ts

## S244-22 · persistence

- Given a person signed in from /welcome, with all three steps done
- When they sign out on xomoni.com, open /welcome again, and sign in from it
- Then signing out signs Xomoni out too, and /welcome then shows only Xomoni installed done
- And signing in from it brings them back there, signs Xomoni in again, and ticks all three steps
- Test: apps/web/e2e/welcome.spec.ts

## S244-23 · happy

- Given a browser where Xomoni has just been installed
- When Xomoni starts for the first time
- Then it opens its dashboard, and right after it, in front, one tab at https://xomoni.com/welcome#ext= followed by its
  own id
- Test: apps/web/e2e/extension/welcome.spec.ts

## S244-24 · empty

- Given the welcome tab Xomoni opened on install
- When xomoni.com answers and the tab loads, and its page says hello to the id in its own address
- Then Xomoni answers with the version in its manifest, no connection, never signed out and never left: installed,
  with no account yet
- And Xomoni has asked xomoni.com's database nothing
- Test: apps/web/e2e/extension/welcome.spec.ts

## S244-25 · error

- Given xomoni.com out of reach when Xomoni is installed
- When the welcome tab can't load
- Then it shows the browser's error page, and Xomoni works as ever: its dashboard says Welcome to Xomoni, and Open X
  window opens the X window and takes the dashboard to Home
- Test: apps/web/e2e/extension/welcome.spec.ts

## S244-26 · security

- Given the welcome tab Xomoni opened on install
- When it loads xomoni.com/welcome
- Then the request asks for https://xomoni.com/welcome alone: the id stays in the fragment, and no request carries it
- And installing sent nothing else: Xomoni asked xomoni.com's database nothing, and no host but x.com was reached
- Test: apps/web/e2e/extension/welcome.spec.ts

## S244-27 · persistence

- Given Xomoni installed, its welcome tab and dashboard closed
- When Chrome restarts it from its folder after an update, first one made by hand, then a one-click update, recorded
  as Xomoni's updater records it
- Then the update made by hand opens nothing, and the one-click update opens only Xomoni's dashboard, to say how it
  went: xomoni.com/welcome never opens again
- Test: apps/web/e2e/extension/welcome.spec.ts

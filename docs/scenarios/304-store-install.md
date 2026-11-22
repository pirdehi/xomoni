---
task: 304
title: Install from the Chrome Web Store and Edge Add-ons: user scenarios
feature: store-install
---

# Install from the stores

What changes once a store lists Xomoni (#304, #302): xomoni.com/install becomes one button for the visitor's browser, with the zip's guide folded under *Advanced: install from a zip* and the answer *How do I move from the zip to the store?*; the home page's calls to action become that button; Xomoni loaded from a zip shows on Home the four steps to the store's Xomoni; and xomoni.com finds Xomoni by the stores' fixed ids, with no `#ext=` in an address. Each step of the move is the person's own: Xomoni never removes itself, and the data travels only in the file *Export everything* saves. Written for #345, the features shipped before the scenarios gate. The install page while no store lists Xomoni has its own scenarios ([`299-install-page.md`](299-install-page.md)).

No store lists Xomoni yet, so the listings in the code are empty, and the tests choose theirs:

- **xomoni.com** (`apps/web/e2e/store-install.spec.ts`): a build for the end-to-end tests reads a test's listings from the page (`NEXT_PUBLIC_E2E_STORE_LISTINGS=1`), checked like the configured ones. Browsers are told apart by their user agent and Chromium's brands.
- **The fixed id** (`apps/web/e2e/fixed-id.spec.ts`): a test extension whose manifest carries a key, loaded in Playwright's Chromium, so Chrome gives it the id the key makes, as it will the store's copy.
- **Xomoni** (`apps/web/e2e/extension/store-move.spec.ts`): the built extension, built a second time as it will be once both stores list it (`e2e/support/store-build.ts` sets the two listings in `src/shared/store-listings.ts`), and installed unpacked, as a zip install is, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)). No test opens a store.

Run them with:

```bash
supabase start
npm run test:e2e -w @xomoni/web -- --grep @task-304
npm run test:e2e:extension -w @xomoni/web -- --grep @task-304
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`), but for the fixed id's, which load their test extension in Playwright's Chromium only.

## S304-01 · happy

- Given Chrome, and both stores listing Xomoni
- When the person opens /install
- Then the page is one primary button, Add to Chrome, to the Chrome Web Store's listing, with no download at the top
- And Where you are says to add Xomoni with the button above
- And Advanced: install from a zip, closed, opens to the download and the five steps, whose answers are still reached
  by their links
- Test: apps/web/e2e/store-install.spec.ts

## S304-02 · happy

- Given Edge, and both stores listing Xomoni
- When the person opens /install
- Then its button is Get it for Edge, to Edge Add-ons, and there is no Add to Chrome
- Test: apps/web/e2e/store-install.spec.ts

## S304-03 · happy

- Given Brave, and both stores listing Xomoni
- When the person opens /install
- Then its button is the Chrome Web Store's Add to Chrome, saying it is also for Brave and the other browsers built on
  Chromium
- Test: apps/web/e2e/store-install.spec.ts

## S304-04 · happy

- Given Chrome, and both stores listing Xomoni
- When the person opens the home page
- Then both of its calls to action are Add to Chrome, to the store's listing, with no Get the extension and no word
  that a listing is coming
- Test: apps/web/e2e/store-install.spec.ts

## S304-05 · happy

- Given Chrome, the Chrome Web Store listing Xomoni, and a link to /install#move-to-store, as Xomoni's card gives
- When the person follows it
- Then the answer How do I move from the zip to the store? has its four steps and links Xomoni in the Chrome Web
  Store, and the list of questions leads to it
- Test: apps/web/e2e/store-install.spec.ts

## S304-06 · happy

- Given Chrome, and the Chrome Web Store listing Xomoni
- When the person follows a link to /install#install-from-a-zip
- Then Advanced is open and in view, with the install steps
- Test: apps/web/e2e/store-install.spec.ts

## S304-07 · empty

- Given Chrome, and no store listing Xomoni, as today
- When the person opens /install
- Then it is the zip's guide as before the stores: the download at the top, the steps, no store's button, no Advanced
  and no answer about moving to the store
- Test: apps/web/e2e/store-install.spec.ts

## S304-08 · empty

- Given Chrome, and only Edge Add-ons listing Xomoni
- When the person opens /install
- Then nothing is offered for Chrome but the zip: the download shows and Advanced doesn't, while the answer about
  moving to the store is there
- Test: apps/web/e2e/store-install.spec.ts

## S304-09 · invalid

- Given Firefox, and both stores listing Xomoni
- When the person opens /install
- Then it says this browser can't run Xomoni, with no store's button, no download and no Advanced, and Firefox marked
  as their browser in the answer about browsers
- Test: apps/web/e2e/store-install.spec.ts

## S304-10 · invalid

- Given Safari, and both stores listing Xomoni
- When the person opens /install
- Then it says this browser can't run Xomoni, with nothing to install
- Test: apps/web/e2e/store-install.spec.ts

## S304-11 · security

- Given Chrome, and a listing for the Chrome Web Store that isn't its own page: a lookalike host, plain http, an
  address with a user name, or Edge Add-ons' address
- When the person opens /install
- Then no store's button shows and nothing links to that address: the zip's guide stays, as with no listing
- And the store's own listing page, given the same way, is the button
- Test: apps/web/e2e/store-install.spec.ts

## S304-12 · invalid

- Given Chrome, and a listing that is the Chrome Web Store's listings path with no item in it
- When the person opens /install
- Then it counts as no listing: the steps show, with no Add to Chrome and no Advanced
- Test: apps/web/e2e/store-install.spec.ts

## S304-13 · browser

- Given Edge, and only the Chrome Web Store listing Xomoni
- When the person opens /install
- Then its button is Get it from the Chrome Web Store, saying Edge adds extensions from there too once they choose
  Allow extensions from other stores (and CI's e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/store-install.spec.ts

## S304-14 · browser

- Given an iPhone, and both stores listing Xomoni
- When the person opens /install
- Then it says Xomoni runs on a computer, with no store's button and no download, and nothing wider than the phone
- Test: apps/web/e2e/store-install.spec.ts

## S304-15 · browser

- Given Chrome in a window as narrow as a phone, and the Chrome Web Store listing Xomoni
- When the person opens /install, Advanced and every step
- Then the button, Advanced and its steps fit with no sideways scrolling
- Test: apps/web/e2e/store-install.spec.ts

## S304-16 · a11y

- Given Chrome, and the Chrome Web Store listing Xomoni
- When the person uses only the keyboard on /install
- Then Tab reaches Add to Chrome, then Advanced, which Enter opens, showing the download, and closes again
- Test: apps/web/e2e/store-install.spec.ts

## S304-17 · a11y

- Given Chrome, both stores listing Xomoni, and Advanced open
- When /install is checked with axe, in light and in dark mode
- Then there is no serious or critical violation
- Test: apps/web/e2e/store-install.spec.ts

## S304-18 · happy

- Given a copy of Xomoni whose manifest carries the store item's key, loaded in Chrome
- When Chrome installs it
- Then its id is the one the key makes, the id xomoni.com looks for
- Test: apps/web/e2e/fixed-id.spec.ts

## S304-19 · security

- Given that copy installed, and nothing that named its id to xomoni.com
- When the person opens /install, then /welcome
- Then the install step ticks by itself and /welcome says how to pin Xomoni: the site found it at its fixed id, kept
  no id, and only said hello to it
- Test: apps/web/e2e/fixed-id.spec.ts

## S304-20 · error

- Given that copy installed, and a link whose #ext= names a zip install that is gone
- When the person opens /welcome from it
- Then the copy at the fixed id is found all the same, the id leaves the address bar, and the named id is kept to ask
  first should that copy come back
- Test: apps/web/e2e/fixed-id.spec.ts

## S304-21 · happy

- Given that copy installed, and an account on xomoni.com
- When the person signs in on xomoni.com, then signs out there
- Then the copy is signed in at once with one code, the Browsers page lists this browser, and signing out signs it out
- Test: apps/web/e2e/fixed-id.spec.ts

## S304-22 · happy

- Given Xomoni loaded from a zip, a store listing it for the browser, and the import offer of a new install answered
- When the person opens Home
- Then the card Xomoni is in the Chrome Web Store: it updates itself says a zip install never updates by itself, and
  that the data comes along only in the file of step 1
- And its four steps are Export everything, Remove this copy, Install it from the store and Import the file, with the
  store's listing opening in a new tab, and Open these steps on xomoni.com leading to /install#move-to-store
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-23 · happy

- Given the card on Home
- When the person presses Export everything
- Then xomoni-export-<today>.json downloads, holding the account's copy, and the first step reads Export everything:
  done, saying the file was saved in Downloads
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-24 · security

- Given the card on Home
- When the person exports everything
- Then no request leaves the browser, to any host: the file is made and saved on the computer
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-25 · security

- Given the card on Home
- When the person presses Open the extensions page
- Then the extensions page opens on Xomoni's details, where only the person can press Remove, and Xomoni is still
  installed and running, its card still on Home
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-26 · error

- Given the card on Home, and a browser that refuses to open the tab
- When the person presses Open the extensions page
- Then a message says it couldn't open it, why, and to type chrome://extensions into a new tab (edge://extensions in
  Edge), and the card stays
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-27 · error

- Given the card on Home, and a browser that can't make the file
- When the person presses Export everything
- Then a message says Couldn't export, with why, and the first step stays to do, its button there to try again
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-28 · empty

- Given Xomoni loaded from a zip, as the build people have today, which no store lists
- When the person opens Home, past the import offer
- Then there is no card and no steps to move: there is no store to move to
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-29 · empty

- Given a new install, with nothing done yet, and a store listing Xomoni
- When the person opens Home
- Then it offers to import data from another Xomoni, and the card waits until they answer: after Not now on the offer,
  the card shows, never both at once
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-30 · cancel

- Given the card on Home
- When the person presses Not now on it
- Then the card is put away, and Home goes on: all is well, New cleanup there
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-31 · persistence

- Given the card put away with Not now
- When the person reloads the dashboard, and opens Home in another tab
- Then the card stays away in both
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-32 · cancel

- Given the card on Home, with everything exported
- When the person opens the extensions page and closes it without removing Xomoni
- Then the card is as it was: the first step still done, Open the extensions page there for later
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-33 · a11y

- Given the card on Home
- When Home is checked with axe, before and after the export, and in dark mode
- Then there is no serious or critical violation: the card is a region named by its title, its steps a list named
  Steps to move to the store, and a step done says so to a screen reader
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-34 · a11y

- Given the card on Home
- When the person uses only the keyboard: Tab to Export everything and Enter, then Tab to Not now and Enter
- Then the file is saved and the first step done, then the card is put away
- Test: apps/web/e2e/extension/store-move.spec.ts

## S304-35 · browser

- Given both stores listing Xomoni
- When the person opens the card in their browser
- Then it sends them to their own store, and only there: Edge Add-ons in Edge, the Chrome Web Store in Chrome (and CI's
  e2e-edge runs every scenario in Microsoft Edge)
- Test: apps/web/e2e/extension/store-move.spec.ts

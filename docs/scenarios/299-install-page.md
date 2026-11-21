---
task: 299
title: Install with one click · 1: a simpler /install now
feature: install-guide
---

# The install page

How a person uses xomoni.com/install while no store lists Xomoni: the download from the latest GitHub release (#44), the steps told for their browser and computer, one at a time, with *Where you are* ticking by itself and the illustrations (#299), and the install questions (#306). The page once a store lists Xomoni (#304) belongs to the store-install feature; scenarios S299-25, 26, 33 and 34 open its *Advanced: install from a zip* only because that is where the illustrations show.

The tests play Xomoni at the page (`chrome.runtime` stubbed, as Chrome exposes it to xomoni.com) and serve the download without the network. Run them with the local stack up (`supabase start`):

```bash
npm run test:e2e -w @xomoni/web -- --grep @task-299
```

## S299-01 · happy

- Given a visitor on the home page
- When they press Get the extension
- Then /install opens with the heading Install Xomoni
- And Download the latest version links to xomoni-extension.zip in the latest GitHub release
- Test: apps/web/e2e/install.spec.ts

## S299-02 · happy

- Given a visitor on /install, at step 1
- When they press Download the latest version at the top
- Then xomoni-extension.zip downloads
- And the guide moves on to step 3 of 5, Unzip it into a folder you keep, with the focus on its title
- And the address stays /install
- Test: apps/web/e2e/install.spec.ts

## S299-03 · happy

- Given a visitor on /install
- When they press Next through the five steps, then Show all steps, then One step at a time
- Then each step says Step n of 5 with the progress bar at n, from Read what can go wrong to Follow it here (optional), and the last has no Next
- And Show all steps lists the five titles, and One step at a time returns to the step they were on
- Test: apps/web/e2e/install.spec.ts

## S299-04 · happy

- Given /install open in a tab, and Where you are above the steps
- When Xomoni, just added to this browser, opens /welcome in a new tab and names itself there
- Then /welcome says how to pin Xomoni to the toolbar
- And back on /install, with no reload, Install Xomoni in this browser is ticked done
- And the guide moves on to step 5 of 5, saying Xomoni is installed in this browser
- Test: apps/web/e2e/install.spec.ts

## S299-05 · happy

- Given a visitor on step 2, Download Xomoni
- When they press that step's own Download xomoni-extension.zip
- Then the zip downloads
- And the guide moves on to step 3, with the focus on Unzip it into a folder you keep
- Test: apps/web/e2e/install.spec.ts

## S299-06 · happy

- Given a visitor on step 4, adding Xomoni to the browser
- When they press the step's Trouble? link Where is Developer mode?
- Then the page scrolls to that answer, its heading clear of the sticky header
- And the address ends in #developer-mode, and the guide is still on step 4
- Test: apps/web/e2e/install.spec.ts

## S299-07 · happy

- Given a visitor on /install
- When they look at Install help
- Then its nine questions are listed as links, each leading to its answer under the same heading
- And the answer about where to ask links to the project's GitHub issues
- Test: apps/web/e2e/install.spec.ts

## S299-08 · happy

- Given xomoni-extension.zip downloaded from the latest release, in Chrome on a Mac or Edge on Windows
- When the person unzips it as step 3 says, turns on Developer mode and drops the folder onto the extensions page as step 4 says
- Then the browser adds Xomoni, and Xomoni opens xomoni.com/welcome by itself
- Manual: Playwright can't open chrome:// or edge:// pages, nor drag a folder from the system's file manager or answer its folder dialog. A test extension loaded at launch (apps/web/e2e/fixed-id.spec.ts) covers what happens once Xomoni is in the browser.

## S299-09 · invalid

- Given a link to /install whose #ext= isn't a valid extension id
- When the page opens
- Then nothing is kept as Xomoni's id
- And Install Xomoni in this browser stays to do, with the guide at step 1
- Test: apps/web/e2e/install.spec.ts

## S299-10 · invalid

- Given something at the id a link named answers the page's hello, but not in Xomoni's shape
- When /install opens with that id
- Then it doesn't count as Xomoni: Install Xomoni in this browser stays to do, with the guide at step 1
- Test: apps/web/e2e/install.spec.ts

## S299-11 · invalid

- Given an iPad asking for the desktop page, so its browser says it is Safari on a Mac
- When it opens /install
- Then its touch screen gives it away, and the page says Xomoni runs on a computer
- And there is no download and no steps
- Test: apps/web/e2e/install.spec.ts

## S299-12 · error

- Given Chrome on a Mac at step 4, and a browser that refuses the page the clipboard
- When the person presses Copy chrome://extensions
- Then the page says Couldn't copy: select it and copy it yourself
- And the address stays on the page, to select by hand
- Test: apps/web/e2e/install.spec.ts

## S299-13 · error

- Given Xomoni's id is known from a link Xomoni opened, but that Xomoni was removed or turned off, so Chrome answers that nobody is there
- When /install opens
- Then Install Xomoni in this browser stays to do, and Where you are says to follow the steps below
- And the guide stays at step 1
- Test: apps/web/e2e/install.spec.ts

## S299-14 · error

- Given the browser takes the page's hello to Xomoni, but no answer ever comes
- When /install opens
- Then Install Xomoni in this browser says checking… while the page waits
- And after its 5 seconds it stays to do, with the guide at step 1
- Test: apps/web/e2e/install.spec.ts

## S299-15 · error

- Given GitHub can't be reached
- When the person presses Download the latest version
- Then the browser shows its own error page in the tab
- And Back returns to /install, with the download there to try again
- Test: apps/web/e2e/install.spec.ts

## S299-16 · security

- Given Xomoni opens /install with its id in the address (#ext=)
- When the page loads
- Then the id leaves the address bar, kept only in this browser's storage
- And no request the page makes carries it
- Test: apps/web/e2e/install.spec.ts

## S299-17 · security

- Given Xomoni installed in this browser, and nobody signed in
- When /install looks for Xomoni, at first and every few seconds after
- Then every message it sends Xomoni is a hello, asking how it stands, and none asks it to act ([ADR-0006](../adr/0006-website-is-view-only.md))
- Test: apps/web/e2e/install.spec.ts

## S299-18 · security

- Given another site that would show /install in a frame, to trick a click on its download
- When the browser loads /install
- Then its headers forbid framing: frame-ancestors 'none' and X-Frame-Options: DENY
- And through every step, the browser blocks nothing under the page's Content-Security-Policy
- Test: apps/web/e2e/install.spec.ts

## S299-19 · empty

- Given a first visit: no Xomoni, nobody signed in, nothing remembered
- When /install opens
- Then Where you are lists its three steps, none done, says to follow the steps below, and offers no account yet
- And the guide starts at step 1 of 5, Read what can go wrong, which links the risks
- Test: apps/web/e2e/install.spec.ts

## S299-20 · empty

- Given Xomoni installed in this browser, and no account yet
- When /install opens
- Then Install Xomoni in this browser is done, and the next step offers Create a free account and Sign in
- And both bring the person back to /install afterwards
- Test: apps/web/e2e/install.spec.ts

## S299-21 · cancel

- Given a visitor on step 3
- When they press Back, twice
- Then the guide goes back to step 2, with the focus on Download Xomoni, then to step 1
- And step 1 has no Back
- Test: apps/web/e2e/install.spec.ts

## S299-22 · cancel

- Given the guide moved itself on to step 5 because Xomoni answered
- When the person presses Back, to step 4
- Then the guide stays on step 4 while the page keeps looking for Xomoni and finding it
- Test: apps/web/e2e/install.spec.ts

## S299-23 · a11y

- Given a person using only the keyboard on /install
- When they Tab to Next and press Enter, step after step, then Shift+Tab to Show all steps and press Enter
- Then each step's title takes the focus as the step appears
- And step 5 has no Next, and all five steps show
- Test: apps/web/e2e/install.spec.ts

## S299-24 · a11y

- Given Xomoni installed in this browser, and a person using a screen reader
- When /install opens on step 5 and they show all steps
- Then the page's heading, Where you are, Install steps and the progress bar (Step 5 of 5) are named
- And the four steps before it read "done" after their titles, and step 5 is marked as the current step
- Test: apps/web/e2e/install.spec.ts

## S299-25 · a11y

- Given a person whose system asks for reduced motion, and a store listing, so the guide is under Advanced: install from a zip
- When they reach step 4's illustrations
- Then both stand still on their last frame, with no animation and no Pause button
- And their captions still say in words what they show
- Test: apps/web/e2e/install-visuals.spec.ts

## S299-26 · a11y

- Given Chrome on a Mac, and a store listing, so the guide is under Advanced: install from a zip, at step 4
- When the illustrations play and the person presses Pause, then Play
- Then Pause holds every animation where it is, and Play goes on
- And each figure is named by its caption, which says in words what the drawing shows
- Test: apps/web/e2e/install-visuals.spec.ts

## S299-27 · browser

- Given Edge on Windows
- When the person shows all steps
- Then step 4 is Add it to Edge, with Developer mode in the panel on the left, and unzipping says Extract All…
- And dragging the folder onto the extensions page comes first, and Copy edge://extensions copies that address, saying Copied
- Test: apps/web/e2e/install.spec.ts

## S299-28 · browser

- Given a computer's browser window as narrow as a phone, 390 pixels
- When the person goes through every step, then shows all steps
- Then nothing on the page is wider than the window
- Test: apps/web/e2e/install.spec.ts

## S299-29 · browser

- Given an iPhone
- When it opens /install
- Then the page says Xomoni runs on a computer
- And there is no download and no steps, and nothing is wider than the phone
- Test: apps/web/e2e/install.spec.ts

## S299-30 · browser

- Given Firefox, before any store lists Xomoni
- When it opens /install
- Then the steps start with This browser can't run Xomoni., and say to open the page in Chrome, Edge or Brave
- And the answer about browsers is marked Your browser
- Test: apps/web/e2e/install.spec.ts

## S299-31 · browser

- Given Edge on Windows
- When the person reads Install help
- Then the answer about Developer mode marks Edge's line, Your browser: edge://extensions, in the panel on the left
- And the answer about updating names edge://extensions
- Test: apps/web/e2e/install.spec.ts

## S299-32 · browser

- Given an iPhone
- When it opens /install
- Then Install help is still there, its answer about browsers marked Your device and saying phones and tablets can't run Xomoni
- And nothing is wider than the phone
- Test: apps/web/e2e/install.spec.ts

## S299-33 · browser

- Given Edge on Windows, and a store listing, so the guide is under Advanced: install from a zip, at step 4
- When the illustrations show
- Then they draw edge://extensions with Developer mode in the panel on the left, in a Windows window
- And step 5's illustration pins Xomoni with the eye
- Test: apps/web/e2e/install-visuals.spec.ts

## S299-34 · browser

- Given Brave on a Mac, and a store listing, so the guide is under Advanced: install from a zip, at step 4
- When the illustrations show
- Then they draw brave://extensions, laid out like Chrome's
- Test: apps/web/e2e/install-visuals.spec.ts

## S299-35 · persistence

- Given Xomoni opened /install once with its id, and the guide moved on to step 5
- When the person reloads the page
- Then the address has no id, and Xomoni is found again from this browser's memory
- And Install Xomoni in this browser is done, with the guide on step 5, saying Xomoni is installed
- Test: apps/web/e2e/install.spec.ts

## S299-36 · persistence

- Given a person signed in to xomoni.com in this browser
- When they open /install, then sign out and open it again
- Then Sign in to xomoni.com, or create a free account is done while they are signed in
- And it is to do again once they have signed out
- Test: apps/web/e2e/install.spec.ts

# ADR-0034: Distribution through the browsers' stores: one button on xomoni.com, the zip kept as Advanced

- Status: Accepted
- Date: 2026-11-21

## Context

Xomoni is installed from a zip today: download it, unzip it into a folder that must stay where it is, turn on *Developer mode* and press *Load unpacked*. Each step loses people (the [install analysis](../INSTALL-UX-2026-11-21.fa.md)). The browser warns about developer-mode extensions, a moved folder turns Xomoni off, and Chrome never updates such an extension.

The maintainer chose the stores as the way to install (the [install project](../INSTALL-PROJECT-2026-11-21.fa.md), phases 6 and 8):

- the Chrome Web Store, Unlisted at first;
- Edge Add-ons, Hidden at first;
- the zip for whoever wants it, with one-click updates ([ADR-0033](0033-one-click-updates-for-the-zip-install.md)).

Several things shape how:

- **A store install is another extension to Chrome.** Its database starts empty. Even with the fixed id of phase 4 (#302), the zip copy must be removed first, and removing it deletes its data. Data can only move in a file the person saves ([ADR-0032](0032-move-data-between-xomoni-versions.md)).
- **The listings' addresses are unknown** until the store accounts exist and review passes. The website and the extension can't import each other ([ADR-0007](0007-npm-workspaces-monorepo.md)).
- **An extension can't install another one**, and Chrome's inline install is gone. Only the person can add Xomoni from a store, or remove it.
- **Xomoni promises no tracking.** X data never reaches a server ([ADR-0004](0004-x-data-stays-local.md)), and the site runs no analytics ([privacy policy](../../apps/web/src/app/privacy/page.tsx)).

## Decision

1. **The stores are the main way to install.**
   - Chrome, Brave and the other browsers built on Chromium (Opera, Vivaldi, Arc) install from the Chrome Web Store.
   - Edge installs from Edge Add-ons. While only the Chrome Web Store lists Xomoni, Edge installs from there, after the person allows other stores, and the page says so.
   - Firefox, Safari, phones and tablets can't run Xomoni from any store. The page says so, as it does today.
2. **The listings' addresses are code, in two files kept equal by a test:**
   - `apps/web/src/shared/config/store-listings.ts` for xomoni.com;
   - `apps/extension/src/shared/store-listings.ts` for the extension.

   `CHROME_WEB_STORE_URL` and `EDGE_ADDONS_URL` are empty until a listing is published, and an empty value is no listing. Any other value must parse as an https address on that store's own host (`chromewebstore.google.com`, `microsoftedge.microsoft.com`), under its listings' path, with no user name or port. Otherwise the tests and the build fail; the address is compared after `new URL`, never as text.

   `tests/store-listings.test.ts` in the extension reads the website's file as text and fails when the two differ. Adding a listing is one line in each file. While both are empty, nothing a person sees changes.
3. **/install shows one button for the visitor's browser** (`installOffer`, `modules/landing`):
   - *Add to Chrome*, *Get it for Edge*, or *Get it from the Chrome Web Store* in Edge without its own listing;
   - with what to know: free, no developer mode, it updates itself, and the risks, read first.

   The zip's download and the whole step-by-step guide stay, unchanged and working, under *Advanced: install from a zip* (`/install#install-from-a-zip`, which opens it). The install questions keep their anchors. *How do I move from the zip to the store?* (`/install#move-to-store`) is added once a store lists Xomoni.

   The server renders the Chrome Web Store's button, the likeliest, and the browser's own replaces it after hydration, as the guide's words do. `InstallButton` gives other pages, such as the home page, the same button, or a link to /install where no store serves the browser.
4. **A zip install is invited to move, and never moved.** Home shows a card only while all of these hold:
   - Xomoni was loaded unpacked: `chrome.management.getSelf` says `development`, and needs no permission;
   - a store lists Xomoni for this browser;
   - the person hasn't said *Not now*;
   - Home isn't offering the first-run import.

   Its four steps are the person's own, the same as on xomoni.com:
   1. *Export everything*, the export Settings runs;
   2. remove this copy, while no job runs, on the extensions page, which the card only opens;
   3. add Xomoni from the store;
   4. *Import* the file in the new Xomoni.

   Xomoni never removes itself: no `uninstallSelf`, and a test checks the source for it. Nothing says or implies that data moves by itself. It moves only in the file the person saved.
5. **The zip stays.** Every release still ships `xomoni-extension.zip` on GitHub. ADR-0033 keeps it updating. The stores get the store build of the same code, without that updater, since a store updates Xomoni itself ([RELEASING](../RELEASING.md)).
6. **No tracking.** How many people install Xomoni is read only from the stores' own counts (install project, task 8.4).
   - No analytics on the site or in the extension.
   - No campaign parameters on the store links.
   - No install ping to xomoni.com.
7. **Tests choose listings only in a build made for them.** With `NEXT_PUBLIC_E2E_STORE_LISTINGS=1`, set by `playwright.config.ts` and never in Vercel, /install reads listings a test put in the page, checked like the configured ones. In any other build that check is false when the site is built, and the code is dropped.
8. **Listings start Unlisted (Chrome) and Hidden (Edge).** Anyone with the link from /install can install. Making them public is the maintainer's decision (install project, task 8.1), and changes nothing here.

Built in [#304](https://github.com/pirdehi/xomoni/issues/304) and [#306](https://github.com/pirdehi/xomoni/issues/306).

## Consequences

- Installing takes one click and no developer mode, and store installs update themselves.
- A store may be slow or refuse Xomoni. The zip guide is complete under *Advanced*, and ADR-0033 keeps zip installs updating.
- Moving from the zip costs the person four steps and a file. There is no way around it: the browser keeps each extension's data apart, and only the person can remove one extension and add another.
- The website changes when a listing is merged, while the extension's card appears only with the next release. The website's answer (`#move-to-store`) is therefore always there before a card can link to it.
- Two constants must change together. The sync test enforces it, and [RELEASING](../RELEASING.md) says where the addresses come from.
- Until a store's own counts exist, nobody knows how many people moved. That is the price of not tracking.

## Alternatives considered

- **The addresses in a shared package.** That would avoid the sync test. But they aren't part of the messages the two apps exchange (`@xomoni/bridge`), and a package for two strings costs more than the test that keeps them equal.
- **The addresses as environment variables (Vercel).** The extension can't read them. A value nobody reviews could also point the button anywhere.
- **Telling the browser apart on the server, from the User-Agent header.** The page would no longer be static. Brave looks like Chrome there, and Chromium's own hints reach only the browser.
- **Moving people automatically.** An extension can't install another one. Removing itself after an export it can't confirm landed would risk the person's data, and the person must stay in control (ADR-0032).
- **Counting clicks on the store buttons** (campaign parameters, analytics or a ping). That breaks the promise of no tracking, and the stores already count installs.

---
task: 426
title: 'The vault: Export my vault, the Your vault card on xomoni.com, performance and accessibility'
feature: vault-export
---

# Export my vault, and Your vault on xomoni.com

*Export my vault* on the Vault page writes the vault as one ZIP the person keeps and reads without Xomoni (#426, [ADR-0044](../adr/0044-an-open-export-of-the-vault.md)): `README.txt`, `schema.json` (`xomoni-vault-export@1`), `index.html` (no script), and each chosen part as CSV and JSON. The replies others wrote to the person are left out unless ticked. The file is made on the computer, saved in Downloads, and never sent anywhere.

The card *Your vault* on xomoni.com (S426-31 on) shows, beside the Library, what the vault in Xomoni holds, read in this browser with `what: 'vault'` as counts and dates only ([ADR-0028](../adr/0028-xomoni-data-on-the-website-in-the-same-browser.md) as amended); it never stores, logs or sends what it reads, and never starts an import ([ADR-0006](../adr/0006-website-is-view-only.md)). Its tests run the website against the local Supabase stack, with Xomoni played at the page (`apps/web/e2e/vault-card.spec.ts`).

The tests run the built extension in real browsers, on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), and open the downloaded ZIP with Node's own zlib. Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-426
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S426-01 · happy

- Given a person whose vault holds X's archive of @xomoni_fixture, on the Vault page
- When they press Export my vault
- Then the browser saves xomoni-vault-xomoni_fixture-<today>.zip, and a toast says it stays on their computer
- And the ZIP holds README.txt, schema.json, index.html, and each of their parts as CSV and JSON
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-02 · happy

- Given that ZIP
- When the person opens its files without Xomoni
- Then README.txt says no Xomoni is needed and names each file's columns, schema.json names xomoni-vault-export@1, and
  posts.csv has the archive's posts under the header its schema lists
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-03 · happy

- Given the Vault page
- When the person leaves only CSV ticked and exports
- Then the ZIP holds the parts as CSV only, beside README.txt, schema.json and index.html
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-04 · happy

- Given the Vault page
- When the person chooses dates, from 2019 on, and exports
- Then posts.csv holds only the posts from those dates
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-05 · invalid

- Given the Vault page
- When the person chooses dates whose start is after their end
- Then it says Pick a start date on or before the end date., and Export my vault is disabled
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-06 · invalid

- Given the Vault page
- When the person unticks both CSV and JSON
- Then it says Tick CSV, JSON or both., and Export my vault is disabled
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-07 · invalid

- Given the Vault page
- When the person unticks every part
- Then it says Tick at least one part to export., and Export my vault is disabled
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-08 · error

- Given a browser that refuses to make the file
- When the person exports
- Then an alert says The export wasn't made, with why, and nothing is downloaded
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-09 · error

- Given a browser whose compression fails while the ZIP is written
- When the person exports
- Then an alert says The export wasn't made, with why, and nothing is downloaded
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-10 · error

- Given Chrome set to ask where to save each download
- When the person exports and closes Chrome's save dialog
- Then no file is saved, and the vault is as it was
- Manual: Chrome's own save dialog can't be driven by Playwright, which takes every download itself.

## S426-11 · security

- Given the Vault page, and every request its browser sends watched
- When the person exports
- Then no request leaves the computer: nothing goes to xomoni.com, X or anywhere else
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-12 · security

- Given a post whose text starts like a spreadsheet formula, and a reply holding <script>
- When the person exports and opens the files
- Then the CSV has a ' before the formula, and index.html has no script, the archive's CSP, and the <script> as text
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-13 · security

- Given replies others wrote to the person, kept by Xomoni (ADR-0030)
- When the person exports without ticking them
- Then the ZIP holds none of those words, and the box beside them says they hold other people's words
- And ticked, they come in, and README.txt says the person chose to include them
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-14 · empty

- Given an account whose vault is empty
- When the person exports
- Then the ZIP still holds README.txt, schema.json, index.html, and each part with its header and no rows
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-15 · empty

- Given an account whose vault is empty
- When the person looks at Export my vault
- Then each part shows its count, 0 where there is nothing yet, and the estimate is small
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-16 · cancel

- Given an export under way
- When the person presses Cancel
- Then nothing is downloaded, a toast says Export cancelled. Nothing was saved., and Export my vault can be pressed again
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-17 · cancel

- Given the replies to the person ticked
- When the person unticks them again and exports
- Then the ZIP holds none of them
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-18 · a11y

- Given the Vault page
- When the person uses only the keyboard: Tab to Export my vault, then Enter
- Then the ZIP downloads
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-19 · a11y

- Given Export my vault, with the replies' warning and a date problem showing
- When axe checks the page
- Then it has no serious or critical violation
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-20 · browser

- Given a browser in dark mode, 390 pixels wide, as a phone
- When the person exports
- Then the card fits the width, the ZIP downloads, and the page has no serious violation in dark colors
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-21 · persistence

- Given X's archive imported, and the dashboard reloaded
- When the person exports
- Then the ZIP still holds the archive's posts and the import in imports.csv
- Test: apps/web/e2e/extension/vault-export.spec.ts

## S426-31 · happy

- Given a person signed in, with Xomoni in this browser holding X's archive and analytics
- When they open the Library on xomoni.com
- Then Your vault lists X's archive (987,654 rows, 40 days old, Due for a new copy), X's analytics of posts (12 posts,
  Up to date) and X's analytics of days (Not imported yet)
- And it says X made the newest archive on Oct 15, 2026, with 3 imports in all, read as counts and dates only
- Test: apps/web/e2e/vault-card.spec.ts

## S426-32 · happy

- Given Your vault on xomoni.com
- When the person presses Open the vault in Xomoni, named apart from the Library's Open in Xomoni beside it
- Then Xomoni is asked to open its Vault page, and nothing else: no import, no plan, no job
- Test: apps/web/e2e/vault-card.spec.ts

## S426-33 · happy

- Given a vault with nothing in it
- When the person opens the Library
- Then Your vault says it is empty, and how to fill it: from X, by the person, then on Xomoni's Vault page
- Test: apps/web/e2e/vault-card.spec.ts

## S426-34 · invalid

- Given a Xomoni whose answer carries a file name
- When the card reads it
- Then the whole answer is refused: the card says Xomoni didn't answer about the vault, and the name is nowhere on the page
- Test: apps/web/e2e/vault-card.spec.ts

## S426-35 · invalid

- Given a Xomoni whose answer writes a count as text
- When the card reads it
- Then the answer is refused, and no list is shown
- Test: apps/web/e2e/vault-card.spec.ts

## S426-36 · invalid

- Given a Xomoni whose answer names a freshness the site doesn't know
- When the card reads it
- Then the answer is refused
- Test: apps/web/e2e/vault-card.spec.ts

## S426-37 · error

- Given a Xomoni that doesn't answer
- When the card reads the vault
- Then it says Xomoni didn't answer about your vault. Open it on this computer and try again.
- Test: apps/web/e2e/vault-card.spec.ts

## S426-38 · error

- Given a Xomoni older than the page, which doesn't know the read
- When the card reads the vault
- Then it says the Xomoni is older than this page and can't show the vault yet, with Install the newest Xomoni
- Test: apps/web/e2e/vault-card.spec.ts

## S426-39 · error

- Given a Xomoni signed in to another account
- When the card reads the vault
- Then it shows nothing of that vault
- Test: apps/web/e2e/vault-card.spec.ts

## S426-40 · security

- Given every request the page sends watched
- When the card shows the vault
- Then no request and no storage carries its counts, and every read names this browser's device
- Test: apps/web/e2e/vault-card.spec.ts

## S426-41 · security

- Given a visitor signed out
- When they open the Library's address
- Then they are sent to sign in, and Xomoni is never asked
- Test: apps/web/e2e/vault-card.spec.ts

## S426-42 · security

- Given Your vault on xomoni.com
- When the card reads the vault
- Then the read asks only for the vault, with the device, and the card shows no link and nothing of X's content
- Test: apps/web/e2e/vault-card.spec.ts

## S426-43 · empty

- Given a browser with no Xomoni
- When the person opens the Library
- Then Your vault says it is kept by Xomoni on their computer, and Open the vault in Xomoni says how to install it
- Test: apps/web/e2e/vault-card.spec.ts

## S426-44 · empty

- Given a vault with only the analytics
- When the person opens the Library
- Then X's archive says Not imported yet, and no archive date is shown
- Test: apps/web/e2e/vault-card.spec.ts

## S426-45 · cancel

- Given the dialog that says how to install Xomoni, opened from Your vault
- When the person closes it with its button
- Then it closes, and nothing opens
- Test: apps/web/e2e/vault-card.spec.ts

## S426-46 · cancel

- Given the same dialog
- When the person presses Escape
- Then it closes
- Test: apps/web/e2e/vault-card.spec.ts

## S426-47 · a11y

- Given Your vault
- When the person reaches Open the vault in Xomoni and presses Enter
- Then Xomoni is asked to open its Vault page
- Test: apps/web/e2e/vault-card.spec.ts

## S426-48 · a11y

- Given Your vault with its files
- When axe checks the page
- Then it has no serious or critical violation
- Test: apps/web/e2e/vault-card.spec.ts

## S426-49 · browser

- Given a phone's width, 390 pixels, in dark mode
- When the person opens the Library
- Then Your vault fits the width with no sideways scroll, and has no serious violation in dark colors
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/vault-card.spec.ts

## S426-50 · persistence

- Given Your vault shown
- When the person reloads the page
- Then the card reads the vault again from Xomoni, and shows it the same: nothing was kept by the site
- Test: apps/web/e2e/vault-card.spec.ts

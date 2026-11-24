---
task: 426
title: 'The vault: Export my vault, the Your vault card on xomoni.com, performance and accessibility'
feature: vault-export
---

# Export my vault

*Export my vault* on the Vault page writes the vault as one ZIP the person keeps and reads without Xomoni (#426, [ADR-0044](../adr/0044-an-open-export-of-the-vault.md)): `README.txt`, `schema.json` (`xomoni-vault-export@1`), `index.html` (no script), and each chosen part as CSV and JSON. The replies others wrote to the person are left out unless ticked. The file is made on the computer, saved in Downloads, and never sent anywhere.

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

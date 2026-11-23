# Architecture decision records

Why Xomoni is built the way it is. Each record captures one decision; see [ADR-0001](0001-record-architecture-decisions.md) for the format and [`template.md`](template.md) to write a new one.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-drive-x-ui-not-the-api.md) | Drive X's own UI instead of the X API | Accepted |
| [0003](0003-no-credentials-no-evasion.md) | Never touch X credentials or session cookies, and never evade detection | Accepted |
| [0004](0004-x-data-stays-local.md) | X data stays in the browser; the cloud stores job status only | Accepted |
| [0005](0005-supabase-and-vercel.md) | Supabase and Vercel for accounts and the website | Accepted |
| [0006](0006-website-is-view-only.md) | The website cannot start deletions | Accepted |
| [0007](0007-npm-workspaces-monorepo.md) | One repository with npm workspaces | Accepted |
| [0008](0008-hexagonal-modules-for-the-website.md) | Hexagonal feature modules for the website, enforced by dependency-cruiser | Accepted |
| [0009](0009-documentation-is-a-merge-gate.md) | Documentation is a merge gate | Accepted |
| [0010](0010-configuration-as-code.md) | Configuration as code | Accepted |
| [0011](0011-email-and-password-sign-in.md) | Email and password sign-in, alongside Google | Accepted |
| [0012](0012-one-fifth-of-every-x-limit.md) | Use at most one fifth of every limit X announces | Accepted |
| [0013](0013-risk-ladder.md) | A risk ladder that backs off one step before X does | Accepted |
| [0014](0014-security-headers-and-a-static-csp.md) | Security headers and a static Content-Security-Policy | Accepted |
| [0015](0015-architecture-styles-principles-and-patterns.md) | Architecture styles, principles and patterns, named | Accepted |
| [0016](0016-strict-typescript-and-type-aware-lint.md) | Strict TypeScript and type-aware lint in every workspace | Accepted |
| [0017](0017-test-standard.md) | Backend and frontend tests for every feature, enforced by the merge gate | Accepted |
| [0018](0018-pair-the-extension-with-a-one-time-code.md) | Pair the extension with a one-time code; it holds a device token, not a session | Accepted |
| [0019](0019-fluent-ui-everywhere.md) | Fluent UI for every Xomoni interface; Tailwind is removed | Accepted |
| [0020](0020-run-hidden-by-sharing-the-x-tab.md) | Run hidden by sharing the X tab with the dashboard | Accepted |
| [0021](0021-watch-x-search-read-only.md) | Watch X's search for phrases and #hashtags, read-only and within the read budget | Accepted |
| [0022](0022-get-the-x-archive-without-leaving-xomoni.md) | Get X's archive without leaving Xomoni: X's own page, the person's password on X, the ZIP read here | Accepted |
| [0023](0023-sign-out-of-xomoni-in-the-extension.md) | Sign out of Xomoni in the extension: a signed-out state, not just a disconnect | Accepted |
| [0024](0024-connect-a-browser-with-one-click.md) | Connect a browser with one click: the extension asks, xomoni.com hands over the one-time code | Accepted |
| [0025](0025-one-sign-in-for-the-website-and-the-extension.md) | One sign-in for xomoni.com and the extension in the same browser | Accepted |
| [0026](0026-daily-numbers-in-the-cloud.md) | Daily numbers in the cloud: counts per day, never X content | Accepted |
| [0027](0027-extension-actions-from-the-website.md) | The extension's actions on xomoni.com, in the same browser, confirmed in Xomoni | Accepted |
| [0028](0028-xomoni-data-on-the-website-in-the-same-browser.md) | Xomoni's own data on xomoni.com, read in the same browser and kept nowhere | Accepted |
| [0029](0029-xomoni-settings-from-the-website.md) | Xomoni's settings on xomoni.com, applied by Xomoni in the same browser within its safety rules | Accepted |
| [0030](0030-replies-to-you-kept-on-the-computer.md) | Replies to you, kept by Xomoni on the computer and never acted on | Accepted |
| [0031](0031-weekly-email-of-the-daily-numbers.md) | A weekly email of the daily numbers, only for those who ask, sent by the database | Accepted |
| [0032](0032-move-data-between-xomoni-versions.md) | Moving data between Xomoni versions: one checked file, on the computer, merged without deleting | Accepted |
| [0033](0033-one-click-updates-for-the-zip-install.md) | One-click updates for the zip install: signed releases, written into Xomoni's own folder | Accepted |
| [0034](0034-distribution-through-the-browsers-stores.md) | Distribution through the browsers' stores: one button on xomoni.com, the zip kept as Advanced | Accepted |
| [0035](0035-xomoni-has-its-own-mark.md) | Xomoni has its own mark, and never shows a platform's to stand for itself or for the platform | Accepted |
| [0036](0036-two-step-verification-with-an-authenticator-app.md) | Two-step verification with an authenticator app, required by the server and the database | Accepted |
| [0037](0037-one-written-gate-for-every-merge-and-release.md) | One written gate for every merge and every release | Accepted |
| [0038](0038-user-scenarios-for-every-user-facing-task.md) | At least 20 user scenarios for every user-facing task, each proven in a browser | Accepted |
| [0039](0039-the-readme-comes-from-the-feature-registry.md) | The README's feature list and status come from one registry | Accepted |
| [0040](0040-test-the-extension-against-recorded-x-fixtures.md) | Test the extension in a real browser against recorded X fixtures, never the real X | Accepted |
| [0041](0041-docs-sorted-by-kind-with-one-map.md) | Docs sorted by kind, with one map: living documents at the root of `docs/` on a list, dated reports by month | Accepted |
| [0042](0042-payments-and-entitlements-with-polar.md) | Payments and entitlements: Polar as merchant of record, only the plan in the cloud, and a paywall a fork can remove | Accepted |
| [0043](0043-the-vault-x-files-kept-on-the-computer.md) | The vault: X's official files read and kept on the computer, with an import ledger | Accepted |
| [0044](0044-an-open-export-of-the-vault.md) | An open export of the vault that needs no Xomoni to read | Accepted |
| [0045](0045-reach-diagnosis-guesses-labelled-as-guesses.md) | Reach diagnosis from X's own files: numbers on the computer, guesses labelled as guesses | Accepted |
| [0046](0046-a-public-digest-of-xs-open-ranking-code.md) | A public digest of X's open ranking code, made from public code only | Accepted |
| [0047](0047-an-email-when-x-warns-an-account.md) | An email when X warns an account, only for those who ask, sent by the database | Accepted |

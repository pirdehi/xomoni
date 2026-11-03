# Changelog

Notable changes to the Xomoni extension and xomoni.com. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). A release ships the extension as a zip on [GitHub Releases](https://github.com/pirdehi/xomoni/releases); see [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added

- An install guide at xomoni.com/install: download the latest release, load it in Chrome, Edge or Brave, and connect it with a code. The site's install buttons lead there.
- Connect the extension to a xomoni.com account with a one-time code, and follow its jobs live on the dashboard. Only job status is sent (ADR-0018).
- Learn each account's daily view cap from X's refusals, and stop below it (PLAYBOOK A4).
- Half the page loads for accounts not known to be Premium (PLAYBOOK A6).
- Likes and reposts of posts X no longer shows are skipped, not failed (PLAYBOOK E6).
- Export the activity log as CSV or JSON, with a link to each post.
- Archive a date range: read it from X and download it as a page or as JSON.
- Work sessions with rests, varied delays, pop-ups closed or handed to you, and clock-skew correction.

### Changed

- The job card is redesigned with Fluent UI: a progress ring, colored counts, when the job should end, and a bar that fills toward the end of each wait. Xomoni's interfaces move from Tailwind to Fluent UI (ADR-0019).
- The whole extension dashboard is on Fluent UI, in light and dark: a Fluent navigation, toasts and dialogs, tables, inputs, switches and a chart in colors color-blind readers can tell apart. Tailwind is gone from the extension.
- xomoni.com renders Fluent UI with its styles from the server, in the visitor's light or dark mode from the first paint, and shares Xomoni's themes with the extension (`@xomoni/fluent-theme`).
- xomoni.com's home page is redesigned on Fluent UI: a centered hero with the new dashboard in the visitor's light or dark mode, icon cards, the safety rules as lists, a question accordion and a closing call to action. The header, footer, risks, privacy and terms pages follow, and the copy now says how a browser is connected (a one-time code) and what an account stores.
- Sign-in, sign-up, password, account and dashboard pages on xomoni.com are on Fluent UI: Fluent fields with a live password checklist, message bars, skeletons while loading, and job cards like the extension's (a status badge, colored counts, a progress bar). Deleting the account and disconnecting a browser now ask in a dialog. Tailwind and lucide-react are gone from the website, so no Xomoni interface uses Tailwind (ADR-0019).
- Custom pacing can never be faster than Careful.
- A safety stop that arrives as you pause still records its warning and ends the job as stopped for safety.

### Fixed

- An open redirect after sign-out and Google sign-in.
- No cleanup ever deleted a post. X's menus never closed with Escape, so every cleanup stopped as "X changed its page"; once that was fixed, Xomoni clicked a Delete option X had already replaced, so nothing happened. Escape is now pressed from inside the open menu, and menu options and confirm buttons are looked up right before they are clicked.
- A job stopped as "X changed its page" when its X window was hidden, for example fully covered by another window. It now waits for the window to be on screen and continues by itself, without counting a failure.
- The Cleanup page could start before it knew whether an archive was imported, and treated a cleared date as today.

## [0.1.0] - 2026-10-30

- First public version: cleanup by date with keep rules, archive import, the risk ladder, warm-up, the canary check, sampled checks and the one-fifth rule.

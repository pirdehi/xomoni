# Changelog

Notable changes to the Xomoni extension and xomoni.com. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). A release ships the extension as a zip on [GitHub Releases](https://github.com/pirdehi/xomoni/releases); see [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added

- Import X's archive as the ZIP X sends, without unzipping it: drop it on the Inventory page, even straight from Chrome's downloads, or choose it in a picker that opens in Downloads. Only `account.js`, `tweets.js` and `like.js` are read from it; photos, videos and messages never are, so a large archive opens in moments. A damaged or altered ZIP is refused and nothing is imported (#184).
- A browser connected to xomoni.com says when a newer version of the extension is out, and whether it fixes a security problem. A zip install never updates by itself, so this is how you hear about fixes until the Chrome Web Store ships updates (#151).
- xomoni.com/.well-known/security.txt says where to report a vulnerability, and SECURITY.md says what watches the code and who is alerted. CodeQL scans the code and the workflows on every push and pull request (#150).
- Watch: follow up to five phrases or #hashtags in X's search, two tabs to start. Xomoni checks each about once a minute, within its read limits, and shows the 10 newest posts, each linked to X. It only reads; nothing is liked, replied to or posted (ADR-0021).
- Run hidden: press it on the dashboard and share the X tab in Chrome's picker, and a job keeps going with the X window minimized or covered. Only the tab is shared; nothing of it is recorded or sent (ADR-0020).
- Keep going while you're away (on by default): the display stays on while a job runs, and after two minutes without keyboard or mouse a covered X window comes forward so the job continues. A hidden window is waited for up to a day instead of an hour.
- Connect the extension to a xomoni.com account with a one-time code, and follow its jobs live on the dashboard. Only job status is sent (ADR-0018).
- Learn each account's daily view cap from X's refusals, and stop below it (PLAYBOOK A4).
- Half the page loads for accounts not known to be Premium (PLAYBOOK A6).
- Likes and reposts of posts X no longer shows are skipped, not failed (PLAYBOOK E6).
- Export the activity log as CSV or JSON, with a link to each post.
- Archive a date range: read it from X and download it as a page or as JSON.
- Work sessions with rests, varied delays, pop-ups closed or handed to you, and clock-skew correction.

### Changed

- The account corner of the extension's sidebar opens a **Connections** panel: a map of X, this browser and xomoni.com, with dots flowing along live links and dashes along one waiting for you, then a card for the X account and one for xomoni.com, each with its state and actions. Settings shows the same map. On xomoni.com, pairing is animated the same way and a browser that just connected is highlighted; the header leaves out *Dashboard* on the dashboard. Motion stops when the system asks for less of it (#182).
- xomoni.com's header shows who is signed in on every page, with a menu for the dashboard, the account and *Sign out*; visitors see *Sign in*. The sign-in pages show a placeholder while they load, and say so when JavaScript is off. In the extension, the account at the bottom of the sidebar opens a menu: the X account (its profile, X's own sign-out) and the xomoni.com connection (which account, its dashboard, disconnect or connect) (#180).
- Connecting a browser to xomoni.com now shows which account the code belongs to, its email masked, and sends nothing until you confirm it is yours (#149).
- xomoni.com sends your current password to Supabase with a password change, so it can be checked there too, signs a browser out after 30 days unused instead of 400, and doesn't offer two-factor enrollment until it has a page for it (#148).
- xomoni.com's database exposes nothing unless granted by name, never stores a job's reason, accepts only encrypted connections, and forgets a browser's token after 90 days without a report. Such a browser is asked to connect again (#149).
- The xomoni.com dashboard updates live through broadcasts that only you can receive, on your private channel. The tables are no longer published to Realtime, so nobody else hears of a change, not even of a deletion (#149).
- Releases are built with a read-only token, signed with build provenance and reproducible: anyone can rebuild a tag and compare the checksum ([releasing](docs/RELEASING.md#checking-a-download)). Workflow actions are pinned by commit SHA.
- The extension is locked down: its pages can connect only to Xomoni's own API, it asks for no host permissions, and it doesn't run in incognito (#143).
- xomoni.com enforces Trusted Types, reports policy violations, loads images only from itself and Google's avatar host, keeps its files from being embedded elsewhere (except the email logo), and refuses a sign-out posted from another site (#147).
- The X window opens small (500 × 760) in the bottom-right corner of the screen, as a window without tabs, so it stays out of your way and your own tabs never end up in it. The dashboard can be minimized while a job runs; only the X window needs to be on screen.
- The job card is redesigned with Fluent UI: a progress ring, colored counts, when the job should end, and a bar that fills toward the end of each wait. Xomoni's interfaces move from Tailwind to Fluent UI (ADR-0019).
- The whole extension dashboard is on Fluent UI, in light and dark: a Fluent navigation, toasts and dialogs, tables, inputs, switches and a chart in colors color-blind readers can tell apart. Tailwind is gone from the extension.
- xomoni.com renders Fluent UI with its styles from the server, in the visitor's light or dark mode from the first paint, and shares Xomoni's themes with the extension (`@xomoni/fluent-theme`).
- xomoni.com's home page is redesigned on Fluent UI: a centered hero with the new dashboard in the visitor's light or dark mode, icon cards, the safety rules as lists, a question accordion and a closing call to action. The header, footer, risks, privacy and terms pages follow, and the copy now says how a browser is connected (a one-time code) and what an account stores.
- Sign-in, sign-up, password, account and dashboard pages on xomoni.com are on Fluent UI: Fluent fields with a live password checklist, message bars, skeletons while loading, and job cards like the extension's (a status badge, colored counts, a progress bar). Deleting the account and disconnecting a browser now ask in a dialog. Tailwind and lucide-react are gone from the website, so no Xomoni interface uses Tailwind (ADR-0019).
- Custom pacing can never be faster than Careful.
- A safety stop that arrives as you pause still records its warning and ends the job as stopped for safety.

### Fixed

- The sign-in page on xomoni.com showed no form in browsers where an extension had made a Trusted Types policy of its own: the site's startup stopped before the form was drawn. It now carries on with the policy it finds (#178).
- A browser connected to xomoni.com stopped reporting once Watch had run: the website doesn't take Watch jobs, and the whole report was refused. Watch jobs now stay in the browser, and reporting carries on (#168).
- The extension trusts only its own messages (#145). The service worker stores only what Xomoni's content script on x.com sends, checked field by field and capped in size. Commands reach X's page only from Xomoni's dashboard. Captures from X's page can't be rewritten by a page script that patches the browser's built-ins, and only requests to x.com are read. Before deleting, Xomoni checks that the post's id, its stored date and the time X shows agree, and that the text on the page has none of the words the rule keeps. A rate-limit reset more than a day ahead no longer parks a job.
- "Delete local data" now deletes everything Xomoni keeps about your posts, including the post ids it sampled to check later and your consents, and disconnects xomoni.com. It keeps only when pages were loaded and the risk ladder's warnings, so X's limits still hold after a wipe. If xomoni.com can't be reached when you disconnect, Xomoni tells you to remove the browser there (#151).
- The xomoni.com token is kept where X's page can't read it, archive files larger than 512 MB are refused with a clear message, and a downloaded archive page can't run scripts (#151).
- A delete now checks that the page shows the post by your own account. Anyone else's post, or one whose author can't be read, is left alone without its menu being opened. Post ids that aren't X ids are dropped from archives and X's responses and never acted on. Such posts count as skipped, not failed.
- A reply or a bio that quoted X's "account suspended" or "temporarily limited" wording could stop a job and raise the risk level. Only X's own banners, alerts and pop-ups count now, and Xomoni reports the notice in its own words.
- The display stayed on after the dashboard was closed in the middle of a job. It is let go when the dashboard closes.
- The X window opened behind the dashboard, where macOS kept it hidden and the job waited until it was brought forward. It now opens in front, and the dashboard says where to keep it: partly on screen, not minimized or fully covered.
- An open redirect after sign-out and Google sign-in.
- No cleanup ever deleted a post. X's menus never closed with Escape, so every cleanup stopped as "X changed its page"; once that was fixed, Xomoni clicked a Delete option X had already replaced, so nothing happened. Escape is now pressed from inside the open menu, and menu options and confirm buttons are looked up right before they are clicked.
- A job stopped as "X changed its page" when its X window was hidden, for example fully covered by another window. It now waits for the window to be on screen and continues by itself, without counting a failure.
- The Cleanup page could start before it knew whether an archive was imported, and treated a cleared date as today.

## [0.1.0] - 2026-10-30

- First public version: cleanup by date with keep rules, archive import, the risk ladder, warm-up, the canary check, sampled checks and the one-fifth rule.

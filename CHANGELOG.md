# Changelog

Notable changes to the Xomoni extension and xomoni.com. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). A release ships the extension as a zip on [GitHub Releases](https://github.com/pirdehi/xomoni/releases); see [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added

- **Comments on xomoni.com** (#256), in the browser where Xomoni runs. Needs Xomoni 0.5.0 or newer.
  - *Your replies:* find your replies by date, at most a number of likes, who you replied to and words, with or without your own threads.
  - See who you reply to most, and pick someone to see only your replies to them.
  - Pick replies and press *Review and remove in Xomoni*: Xomoni opens its Cleanup page with only those, and removes nothing until you confirm there.
  - Xomoni now keeps who each reply answers, from X and from your archive.
  - *Replies to you:* how many replies you got each day, who replies most, and each reply with *Open on X*, where you can hide it.
  - Xomoni keeps the replies to your posts that X shows it, on your computer only, for 90 days and at most 5,000 per account. It never hides, blocks or reports anyone ([ADR-0030](docs/adr/0030-replies-to-you-kept-on-the-computer.md)).

### Fixed

- Cleanup on xomoni.com says that X began in 2006 when a date is earlier, instead of asking Xomoni for a plan it refuses.

## [0.4.0] - 2026-11-20

Install this version to use the Library, Watch, Account health, Settings and Cleanup places on xomoni.com. Xomoni 0.3.0 can’t answer them, and the site says so.

### Added

- **Plan a cleanup on xomoni.com, start it in Xomoni** (#235).
  - The same three questions as Xomoni: what to remove, how old, and what to keep.
  - In the browser where Xomoni runs, how many items the plan matches in Xomoni's copy, and how many days it takes at the current pace.
  - *Review and start in Xomoni* opens Xomoni's Cleanup page with the plan filled in. Nothing starts until you confirm there.
  - The plan is kept in the page's address, so *Send to my computer* on a phone carries it to your computer.
  - Changing the account or period no longer drops a place's own choices from the address.

- **Settings on xomoni.com** (#234), in the browser where Xomoni runs.
  - See Xomoni's pace with each action's caps, and set custom pacing back to Careful.
  - Change active hours, the failures in a row before a job pauses, notifications and *Keep going while away*.
  - Edit the active account's Watch searches.
  - Xomoni applies its own rules to every change, so nothing goes faster than Careful or above a fifth of X's limits. It writes the change to its activity log, and a running job keeps its settings until it is paused and resumed ([ADR-0029](docs/adr/0029-xomoni-settings-from-the-website.md)).
  - *Show my numbers on xomoni.com* is here too, on any device.

- **Your Library, Watch and account health on xomoni.com** (#233), in the browser where Xomoni runs.
  - The Library: your posts, replies, reposts and likes, newest first, with each kind's count, a search, 100 at a time, and *Open on X*.
  - Account health: each X account's level and why, its pace, and when a hold ends.
  - Watch: each search, when it last looked and what it found.
  - The site reads them from Xomoni in this browser and keeps them only while the page is open: nothing reaches our servers ([ADR-0028](docs/adr/0028-xomoni-data-on-the-website-in-the-same-browser.md)). On a phone or another computer, each place says where its data lives.

- **Engagement on xomoni.com** (#255), from your daily numbers.
  - Likes, replies, reposts and quotes, views and the engagement rate, each against the period before.
  - What your posts received each day by type, views, and the rate over time.
  - How many of your posts Xomoni saw had at least one like.
  - Marked as estimates, with how many sightings they rest on; your most-liked replies stay in Xomoni.

- **Content on xomoni.com** (#254), from your daily numbers.
  - Posts, replies, reposts and quotes published, each against the period before.
  - What you published each day (or week) by type, stacked, with a legend and a table view.
  - The weekday you publish most.
  - Your best hour, top posts, posts no one engaged with and the age of what is still online stay in Xomoni, with your posts.

- **Audience on xomoni.com** (#253), from your daily numbers.
  - Followers, gained, lost and the best and worst days, and followers per account you follow.
  - Followers and following over time, and what you gained or lost each day, losses below the line.
  - Milestones reached, and how many to the next.
  - Who followed or unfollowed you is found in Xomoni, by comparing two of your X archives; the names stay on your computer.

- **Overview shows your numbers** (#252), once you turn them on.
  - Followers, posts, likes and replies received, and the engagement rate, each against the period before.
  - Followers over time, and what you published each day (or week, over a long period).
  - Each chart answers on hover and by keyboard, and has a table view.
  - What was received is marked as an estimate, with how many of your posts Xomoni saw.

## [0.3.0] - 2026-11-20

### Security

- **xomoni.com runs Next.js 16.4.6** (from 16.4.3). It carries the fixes for four advisories in Next.js's `use cache`: cross-tenant and cross-user cache disclosure, a cache leak across root parameters, and cache poisoning of shared fallback shells ([GHSA-mfr8-8qww-v76h](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h), [GHSA-vc7v-qv4w-wrv8](https://github.com/vercel/next.js/security/advisories/GHSA-vc7v-qv4w-wrv8), [GHSA-vvgp-ww4w-46vf](https://github.com/vercel/next.js/security/advisories/GHSA-vvgp-ww4w-46vf), [GHSA-rhh4-g77r-r9qj](https://github.com/vercel/next.js/security/advisories/GHSA-rhh4-g77r-r9qj)).

### Added

- **Show my numbers on xomoni.com** (#250, ADR-0026): a switch in the extension's xomoni.com card and on the dashboard's Overview, off until you turn it on.
  - While it is on, Xomoni sends each day's counts with its reports: up to 400 days back the first time, then the days since.
  - Turning it off, in either place, deletes every day already sent.
  - The privacy policy and the landing page's *Synced when you sign in* list say so.

- **The database side of daily numbers on xomoni.com** (#250, ADR-0026). Off until the person turns them on; then a connected browser can store one row of counts per X account per day, and nothing else: no text, no ids, only whole numbers from 0 to 10⁹, for the last 400 days. Turning them off deletes every row already sent.

- **Daily numbers in the extension** (#249, ADR-0026), kept in this browser.
  - One row per X account per day: followers, following, posts and likes from the profile X showed that day.
  - What your posts and replies received that day, from the rise Xomoni saw in their likes, replies, reposts, quotes and views, with how many posts it saw (an estimate).
  - What you published and what Xomoni removed each day, from the Library and the activity log.
  - Nothing new is asked of X: only pages X already showed count. A day without an X page has no row.

- **Xomoni's actions on xomoni.com** (#251, ADR-0027).
  - Job cards have *Pause*, *Cancel* and *Resume*, and places whose lists live in Xomoni have *Open in Xomoni*. They go to Xomoni in the same browser, for jobs of this browser.
  - When Xomoni can't act from here, one dialog says why: *You haven't installed Xomoni yet* (with the install steps), *Xomoni runs on a computer* (with *Send to my computer*), or *Sign in to Xomoni in this browser*.
- **The extension hears xomoni.com's actions** in the same browser (#251, ADR-0027).
  - Pause and cancel a job: they apply at once, in the tab that runs it, and the log says xomoni.com asked.
  - Resume asks you in Xomoni first: nothing runs on X until you choose *Resume* there.
  - Open one of Xomoni's pages.
  - Only for the xomoni.com account this browser is connected to; anything else is refused.

- **The dashboard's places on xomoni.com** (#245, the first step of the full dashboard, #248).
  - Every place has its own address: Overview, Audience, Content, Engagement, Reports, Library, Comments, Cleanup, Watch, Activity, Account health, Browsers and Settings.
  - A sidebar on a computer, and a bottom bar with *More* on a phone.
  - An account and period picker on every page, kept in the address.
  - Without a connected browser, Overview stays in view with one slim bar, instead of a full-page *Connect your browser*.
  - Overview shows *Needs you*, risk, what Xomoni removed in the period, and the recent jobs.
  - Places not built yet say what they will show and where their data will come from.

- **One sign-in for xomoni.com and the extension** in the same browser (#232, ADR-0025).
  - Sign in on xomoni.com, and Xomoni signs in by itself. No code, no extra click.
  - Press *Sign in to xomoni.com* in Xomoni and sign in once there; both are signed in.
  - Sign out on either side, and the other signs out too. On xomoni.com, the extension's job pauses and its X window closes. In Xomoni, xomoni.com signs out the next time its page is shown.
  - Signing in with another account on the website switches Xomoni to it.
  - The dashboard marks *This browser*.
  - An account stays optional: Xomoni without one is never signed out by the website.

- **Sign out of Xomoni** in the extension (#226, ADR-0023). It sits at the foot of the account menu and opens a dialog that names the account and says what will happen:
  - the running job pauses, and continues after signing in again;
  - this browser disconnects from xomoni.com;
  - the X window Xomoni opened closes;
  - nothing more is recorded from X.
- Two choices in the dialog:
  - remove the account's data from this browser, with a copy to download first; X's limits still hold;
  - also sign out of X, on X's own page.
- A signed-out page. Signing in again takes *Continue as @handle*, so an X session left open doesn't sign you straight back in.

- **Connect a browser to xomoni.com with one click** (#228, ADR-0024). In Xomoni, press *Connect to xomoni.com* (Settings) or *Connect this browser* (account menu). xomoni.com opens: sign in if needed, then press *Connect this browser* on the page that names your account. No code to copy or type.
  - The website hands the one-time code to the extension that asked, and only that one.
  - The extension accepts it only from xomoni.com, with a nonce it made in the last 15 minutes, once.
  - A typed code still works, folded under *Use a one-time code instead*.

### Changed

- **A UX pass on xomoni.com** (#239):
  - The landing page states the real default pace: 80–120 s between deletes, at most 40 an hour and 960 a day. It said 6–12 s and 150 an hour. A test now ties it to the extension's Careful preset.
  - The landing page's screenshot is today's Home, in light and dark.
  - The landing page describes one sign-in instead of a one-time code.
  - Job cards use the extension's numbers and words: removed, skipped, failed and remaining, with the percentage next to the bar.
  - The dashboard no longer repeats the header's *Account* and *Sign out*.
  - The header's avatar and the dashboard's show the same initials.
- **A UX pass on the extension's dashboard** (#240):
  - Library: once X's archive is imported, its card says so in one line and offers *Get a newer archive*, instead of the four steps and a primary button. The browse table's last column stays inside the card.
  - Settings: both pacing folds sit inside the pacing card and look like every other fold. Cards are as tall as their content. *Always on* is in plain words, without HTTP codes. *Test* is now a *Send a test* button.
  - Watch: *Save* lines up with the phrase field, and a disabled *Start watching* says why.
  - Home: the counters show a dash, not 0, while your copy is counted. *Recent activity* shows each post's text.

- In Xomoni, *Connect to xomoni.com* and *Connect this browser* are now *Sign in to xomoni.com*, and *Disconnect* is *Sign out of xomoni.com*. The signed-out page offers it first (#232).
- On xomoni.com/connect, a signed-in person no longer presses *Connect this browser*: Xomoni signs in at once (#232).

- The manifest lets xomoni.com's pages message the extension (`externally_connectable`, no new permission warning). The service worker takes only a one-time code from them (ADR-0024).
- *Disconnect* from xomoni.com asks to confirm. *Sign out of X* moved from the account menu into the sign-out dialog (#226).

### Fixed

- A React warning on every page of xomoni.com, *The result of getServerSnapshot should be cached*, from the one sign-in (#239).

## [0.2.1] - 2026-11-14

Choosing the Xomoni folder works in a Chrome that asks where to save each file, and xomoni.com has an install guide.

### Added

- A connected browser hears that 0.2.0 is out (#151).
- An install guide at xomoni.com/install: download the latest release, load it in Chrome, Edge or Brave, and connect it with a code. The site's install buttons lead there (#44).

### Fixed

- *Choose the Xomoni folder* still did nothing in a Chrome that asks where to save each file (#220). Xomoni opened the folder picker while Chrome's *Save As* dialog for its folder note was still up, and macOS never showed it. Now, while Chrome asks, the card says to press Save there and then the button again; the folder is remembered once the note is saved.

## [0.2.0] - 2026-11-14

The first release since the pilot began. Cleanups now really delete, and keep going while you work in other windows. *Get my archive* asks X for your archive and imports it by itself. The dashboard is simpler: Home says what to do next, the Library shows your copy in one card, and Activity has jobs and the log in one place. xomoni.com and the release pipeline went through a security review.

### Added

- *Get my archive* in the Library gets X's archive for you (#186). Xomoni opens X's archive page in its X window and presses X's own *Request archive*, then *Download archive* once X has made it, and nothing else. If X asks for your password or a code, Xomoni waits while you type it on X's page; it never sees it. While X makes the archive (a day or more), Xomoni looks again by itself and downloads it, and the ZIP is imported from your Downloads folder on whichever page of the dashboard is open. A page Xomoni doesn't recognize stops the job with nothing pressed, and says which button to press yourself.
- Xomoni can find X's archive in your Downloads folder and import it by itself (#187). Choose the folder once, read-only, in the Library. From then on, a ZIP named like X's archive (`twitter-YYYY-MM-DD-….zip`) that lands there is imported while the Library is open, once per file. Only files named like X's archive are opened, and nothing leaves the computer.
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

- A cleaner, more modern look, in light and dark (#207). Cards have a lighter edge, a soft shadow and more room inside. Page titles are larger, explanations are quieter, and the page you are on is bold in the menu. Only Fluent UI's own tokens are used (ADR-0019).
- Each count says what it counts (#206). Home's counters are *in your copy*: what Xomoni knows is still on X, and what it removed. X's own count, which can be larger, is in the Library with how much of it Xomoni has. Cleanup says *1,222 in your copy* instead of *known*.
- Plain words across the extension (#205). The window Xomoni works in is always *the X window*, never *X worker*, *worker window* or *Xomoni window*. *Inventory* is now *your copy*. Job cards no longer show the engine's phase. Account health reads *Caution: X rate-limited Xomoni in the last hour. Removals checked again on X: 4 confirmed and 1 still to check.*, without a level number. xomoni.com shows a job's phase in words, such as *Searching X*.
- The Activity log reads like a summary (#204). A run of the same action within one job and one day is one line, such as *Deleted 31 posts and replies, 01:01–01:32*, and opens to its entries. Each entry shows the post's text when Xomoni has it. Warnings and errors are never folded away.
- The Library shows your copy in one card (#203). How complete it is and where it came from sit at the top, with X's archive below as the recommended way to complete it. Reading from X is folded under *Other ways*, with a line saying when it last ran. Two cards with two main buttons used to say the same thing.
- Jobs and the Activity log are one page, *Activity*, with two tabs: *Jobs* and *Log* (#202). The menu goes from seven places to six, and links and notifications land on the right tab.
- Overview is now *Home*, and it answers "what now?" first (#201). One status at the top says whether all is well, what is running, or what X needs, with the one button that does something about it (*Resume*, *Open X window*). A new person sees three steps to get started (sign in, get the archive, a first cleanup) until they are done. The counts sit in one row above the chart. *Limits & pacing* moved to Settings, folded under *Today's use of X's limits*.
- When X needs you, it shows at the top of every page, even when no job runs (#200). Being signed out of X, an X check or a locked account each get a banner with *Open X window*, instead of a line cut short at the bottom of the sidebar. The sidebar now names the X window plainly (*X window ready*, *Sign in to X*). A covered window only warns while a job runs, since that is the only time it matters.
- A cleanup takes three choices (#199): what, how old, and the review with *Start*. What to keep is folded under *Exceptions*, with a line saying what is kept, such as *Keeps posts with 50+ likes*. How Xomoni finds the posts moved under *Advanced*, with a line saying what it will do; both ways stay on by default.
- Settings open on the pace most people keep (#198). *Careful* now reads as a few lines, such as *Delete posts & replies: up to 960 a day · 40 an hour*, instead of a table of 35 number fields. The table shows only when you choose *Custom*, and *Pause after this many failures in a row* moved under *Advanced*.
- The archive card in the Library was redesigned after a review of the whole journey (#186). Four steps show where getting the archive stands, and one line says what is happening or what X needs from you, with *Open X window* when X asks for your password. *Get my archive* asks for the Downloads folder in the same click, so the archive comes in by itself, and keeps you in the Library instead of sending you to Jobs; declining the risks dialog no longer leaves a job behind. The time Xomoni looks again respects your active hours, and says it needs Xomoni open. *Look now* appears only once a look is due, and importing a ZIP by hand is folded under *Already have the ZIP?*. The job card shows what X needs from you in full, and the risks text, the Cleanup warning and the README now point to *Get my archive*.

- The Archive and Inventory pages are now one **Library** (#185). *Your copy* shows how much of X's own count Xomoni has, and when each source was last read: recent posts, replies and likes, the full history, and X's archive. *Complete my copy* reads all of them from X in one job. X's archive comes in on the same page, and *Download a copy* saves any dates (all time, the last 12 months, this year or chosen dates) as a page or as JSON. Old links to Archive and Inventory open the Library.
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

- *Choose the Xomoni folder* did nothing in a Chrome set to ask where to save each file (#220). Chrome asked where to save Xomoni's folder note, and by the time you pressed Save, the click could no longer open the folder picker. Xomoni now makes the folder only once, and when Chrome asked, it says the folder is ready and to press the button once more. Chrome asks the same for X's archive: press Save, and the Xomoni folder is already chosen.
- X's archive now reaches Xomoni from Downloads (#196). Chrome never lets an extension read the Downloads folder itself, only a folder inside it, so choosing Downloads always failed with *“can't open this folder because it contains system files”*. While Xomoni gets your archive, Chrome now saves X's ZIP in **Downloads › Xomoni**. *Get my archive* makes that folder and opens the picker in Downloads: open **Xomoni** and press **Select**. Any other folder is refused, with the reason. This needs Chrome's *downloads* permission, which Xomoni uses only to choose where X's archive is saved: no other download is moved or recorded.
- The Activity log no longer shows Chrome's own wording when X's page stops answering for a moment. It now says *The X page changed while Xomoni was reading it* or *The X page didn't answer Xomoni* (#196).
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

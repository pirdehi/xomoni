[فارسی](PHASE-11-REPORT.fa.md)

# Phase 11 report: the X archive without the chores

> How getting X's archive into Xomoni went from more than ten steps by hand to one press, plus the password X asks for, typed on X. Covers what changed, how the archive job behaves, what keeps it safe, what was found along the way and what is left. None of it uses X's API. The tasks are in [ROADMAP.md](ROADMAP.md#phase-11--the-x-archive-without-the-chores), and the decision in [ADR-0022](adr/0022-get-the-x-archive-without-leaving-xomoni.md).
>
> Date: 9 November 2026 · Code: `main` after [#191](https://github.com/pirdehi/xomoni/pull/191)

## Summary

- Getting X's archive now takes one press of *Get my archive* in the Library. The person also types the password on X's own page if X asks, and chooses the Downloads folder once. Xomoni does the rest while its dashboard is open.
- Three of the phase's four tasks are closed. The fourth, the archive job ([#186](https://github.com/pirdehi/xomoni/issues/186)), is built and merged, and waits for one check on X's real archive page with the maintainer.
- The Archive and Inventory pages became one page, the Library.
- The extension asks for no new permission. It still has no access to any site; it reads only the Downloads folder, and only after the person chooses it in the browser's own picker, read-only.
- The maintainer's browser runs this code since 9 November.

## The journey, before and after

| Before (by hand) | Now |
| --- | --- |
| 1. Find X's settings page for the archive. | 1. Library → *Choose Downloads folder* (once). |
| 2. Type the password and the code X sends. | 2. *Get my archive*. |
| 3. Press *Request archive*. | 3. Type the password on X's page, if X asks. |
| 4. Wait 24 to 72 hours, watching the email. | Xomoni looks at X's page by itself while X makes the archive. |
| 5. Go back to X and type the password again. | Xomoni presses *Download archive* when it's ready. |
| 6. Download the ZIP. | Chrome saves the ZIP in Downloads. |
| 7. Unzip it and find its `data` folder. | Xomoni reads the ZIP as it is. |
| 8. Open Xomoni, open the Archive page. | Xomoni imports it by itself, on any page of the dashboard. |
| 9. Choose the folder and import. | |
| 10. Open the Inventory page to see the result. | The Library shows the copy and how complete it is. |

## What changed

| Issue | Change | Pull request |
| --- | --- | --- |
| [#184](https://github.com/pirdehi/xomoni/issues/184) The ZIP as it is | The ZIP X sends is read in place: only its directory and `account.js`, `tweets.js` and `like.js`. Photos, videos and messages are never read. A damaged or altered ZIP is refused before anything is imported. *Choose ZIP file* opens in Downloads, and the ZIP can be dropped straight from Chrome's downloads. | [#188](https://github.com/pirdehi/xomoni/pull/188) |
| [#185](https://github.com/pirdehi/xomoni/issues/185) One Library | Archive and Inventory became the Library. *Your copy* shows how much of X's own count Xomoni has, and what each source (recent posts, full history, X's archive) holds and when it was read. *Complete my copy* reads everything in one job. *Download a copy* takes its dates when you download. Old links open the Library. | [#189](https://github.com/pirdehi/xomoni/pull/189) |
| [#187](https://github.com/pirdehi/xomoni/issues/187) From Downloads by itself | Once the person chooses Downloads, a ZIP named like X's archive (`twitter-YYYY-MM-DD-….zip`) that lands there is imported by itself, once per file. Only files with that name are opened. | [#190](https://github.com/pirdehi/xomoni/pull/190) |
| [#186](https://github.com/pirdehi/xomoni/issues/186) The archive job | *Get my archive* runs a job in the X window on X's archive page. It presses X's *Request archive*, and *Download archive* once X has made the archive, and nothing else. While X makes it, the dashboard looks again by itself. After the download, it imports the ZIP. | [#191](https://github.com/pirdehi/xomoni/pull/191) |

In the same days, outside this phase: the Connections panel shows X, the browser and xomoni.com as one animated map, with a pairing animation on the site ([#182](https://github.com/pirdehi/xomoni/issues/182), [#183](https://github.com/pirdehi/xomoni/pull/183)).

## How the archive job behaves

The job reads what X's archive page shows and does one thing for each:

| X's page shows | The job |
| --- | --- |
| Its password or code form | Waits as *Needs you* and notifies the person, who types it on X. The job never reads, fills or closes that form. It stays on the page afterwards, since loading it again could make X ask again. |
| *Request archive* | Presses it, but only when the person asked (*Get my archive*) and only once a run. Then it remembers the request. |
| That the archive is being made | Remembers it. The dashboard looks again a day after asking, then every six hours, for two weeks at most. |
| *Download archive* | Presses it. Chrome saves the ZIP; the dashboard imports it from Downloads for the next 12 hours. |
| Anything else | Pauses, pressing nothing, and says which button to press by hand. |

The dashboard's own looks start only when no other job runs, within the person's active hours, and for an account whose risks the person already accepted. They never ask for anything, and never ask X for a new archive. When X shows none, they stop, and the Library offers to ask again.

## What keeps it safe

- **The password stays with the person** ([ADR-0003](adr/0003-no-credentials-no-evasion.md)). X's form is recognized so the job waits for it; it is never filled, read or closed as a pop-up.
- **Only buttons Xomoni is sure of.** The button's whole label must be one Xomoni knows (*Request archive* / *Request data*, *Download archive* / *Download data*). Exactly one such button must show, turned on, in the state that needs it. Nothing is pressed while signed out, locked or restricted.
- **X's own page, X's own download** ([ADR-0002](adr/0002-drive-x-ui-not-the-api.md)). Xomoni never fetches the archive itself and asks for no permission to do so.
- **The archive stays on this computer** ([ADR-0004](adr/0004-x-data-stays-local.md)). Archive jobs are not reported to xomoni.com, and the ZIP is read in the dashboard.
- **A hostile ZIP is refused**: encrypted entries, unknown compression, sizes that lie, a bad checksum, or records that point outside the file.

## Found along the way

All were caught by tests or checks before merging:

- **Labels that named every button** ([#189](https://github.com/pirdehi/xomoni/pull/189)). In *Download a copy*, the form's labels wrapped whole groups of buttons, so a screen reader read each button with the whole label. The groups are now named on their own.
- **Request could be pressed three times** ([#191](https://github.com/pirdehi/xomoni/pull/191)). If X kept offering a new archive after the press, the first version would have pressed again. It now presses once a run and pauses.
- **Two looks at once** ([#191](https://github.com/pirdehi/xomoni/pull/191)). The dashboard's first look and its timer could both start a job; one look now waits for the other.
- **An old request date** ([#191](https://github.com/pirdehi/xomoni/pull/191)). A new request could have kept the date of an archive already downloaded, which would have made it look two weeks old and stopped the looks. A new request now counts from its own day.

## How it was checked

- `npm run verify` before every push: 1,170 extension tests (92% of statements), 567 website tests (97%), lint, types, architecture rules, docs and test presence. CI ran it again on every pull request, with the database tests, the end-to-end suite and CodeQL.
- The archive job's tests cover every state:
  - in the engine: requested; needs you before and after the press; preparing; ready and downloaded; expired; unknown page; a failed press; Request once;
  - on X's page: each step and every refusal;
  - in the dashboard: the Library card, the looks, the import and the job card.
- The Library was checked visually in light and dark themes, with its dialog and menu, with no console errors.
- The maintainer reloaded the extension on 9 November. It runs `main` at [#191](https://github.com/pirdehi/xomoni/pull/191), with no errors and still only the notifications permission.

## Left open

- **One check on X's real archive page** ([#186](https://github.com/pirdehi/xomoni/issues/186)), about ten minutes with the maintainer. X's markup isn't public, so the job was tested on markup built from X's help pages and guides.
  - *Get my archive* runs on the maintainer's account, and the maintainer types the password on X.
  - The real page's markup replaces the test markup, and any label X words differently is added.
- **Limits that stay:**
  - The dashboard must be open for the looks and the import, as for every job.
  - X takes a day or more to make the archive.
  - X may ask for the password again before the download.
  - With X in another language than English, the person presses the button that the job names.
- **Waiting on the maintainer, outside this phase:**
  - Release 0.2.0 ([#117](https://github.com/pirdehi/xomoni/pull/117)) and the install page ([#114](https://github.com/pirdehi/xomoni/pull/114)).
  - The *Require current password* setting in Supabase ([#148](https://github.com/pirdehi/xomoni/issues/148)) and Realtime public access off ([#81](https://github.com/pirdehi/xomoni/issues/81)).
  - Google brand verification ([#9](https://github.com/pirdehi/xomoni/issues/9)).
  - The Phase 9 report ([#175](https://github.com/pirdehi/xomoni/pull/175)) and the Dependabot updates.

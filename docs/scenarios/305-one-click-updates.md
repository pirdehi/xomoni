---
task: 305
title: Update in one click
feature: one-click-updates
---

# Update in one click

A Xomoni installed from the zip updates itself on the person's click (#305, [ADR-0033](../adr/0033-one-click-updates-for-the-zip-install.md)): once xomoni.com says a newer version is out, *Update now* downloads the release from this repository's GitHub releases, checks its Ed25519 signature against the keys the build trusts and every file of the zip, and writes it into the folder the person chose once, never while a job runs, then restarts. A release that isn't signed by a trusted key, isn't whole and safe, is another version or another extension, asks for more access or needs a newer browser is thrown away with nothing changed. Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: choosing or forgetting the folder in Settings didn't change the notice until a reload (S305-06).

The tests run the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), never the real X, GitHub or xomoni.com:

- **Two builds.** The build people have today trusts no signing key yet (`release-keys.json` is empty), so its updater is dormant: S305-01 runs it as it is. The others run Xomoni as it will be once the maintainer adds the key: the same build, made for the test run trusting a throwaway Ed25519 key instead (`buildTrusting` in `apps/web/e2e/support/release.ts`). Releases are that build at the next version, zipped and signed with the throwaway key, or broken on purpose, and served at GitHub's release URLs.
- **xomoni.com**, which tells Xomoni a newer version is out in its answer to each status report, is played at the extension (`apps/web/e2e/support/xomoni-site.ts`): a xomoni.com page signs Xomoni in through Chrome's own channel, and the functions the extension calls answer from a small state.
- **Chrome's own prompts are played at the page**, since Playwright can't answer them: it aborts the folder picker, and the prompt for GitHub's access waits for a person. The picker gives a folder in the browser's private file system holding this Xomoni's files, and the prompt says yes or no. Chrome also blocks an extension the tests installed through its developer tools once it restarts itself, so the restart is counted instead, and the test reopens the dashboard as Chrome does after it.
- **The browser names itself as Chrome does for a person** (`Chrome/<version>`), where the headless browser says `HeadlessChrome/<version>`, in which Xomoni can't read the version a release's `minimum_chrome_version` is checked against.

Because Chrome doesn't load Xomoni from the folder the tests' picker gives, the restart into the new version is the one manual scenario (S305-05). Run them with no Supabase:

```bash
npm run test:e2e:extension -w @xomoni/web -- --grep @task-305
```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S305-01 · happy

- Given the build people have today, which trusts no signing key yet, signed in to xomoni.com, which says 9.9.9 is out
- When the person looks at the notice Xomoni 9.9.9 is out, and at Settings › Updates
- Then both say This version of Xomoni can’t check releases yet. Download the new version by hand; the next ones can
  update in one click.
- And the notice links Download 9.9.9 to GitHub's latest release, with no Update now and no Set up one-click updates,
  and the card has no button
- And nothing is asked of GitHub
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-02 · happy

- Given a build that trusts a release key, and a person on Settings › Updates
- When they press Choose Xomoni’s folder, and pick the folder that holds this Xomoni
- Then the card says This browser runs Xomoni <version>, and that Xomoni can update itself in one click: it downloads
  the release from GitHub, checks its signature and every file, writes it into its own folder, never while a job runs,
  and restarts
- And a toast says Xomoni will update itself in “xomoni”., and the card shows Xomoni’s folder: “xomoni”, with Choose
  another folder and Forget the folder
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-03 · happy

- Given xomoni.com saying the next version is out, the folder chosen from the notice, and GitHub serving that release,
  signed by the trusted key
- When the person presses Update now and allows GitHub's access
- Then Xomoni downloads the zip and its signature from GitHub, in that order and nothing else
- And it writes the release into its folder: the folder's manifest.json is the new version's
- And the notice says Restarting as Xomoni <next>…, with Update now off, and Xomoni asks Chrome to restart it once
- And the activity log says Updated Xomoni from <version> to <next>: the release’s signature checked out (key …, zip
  SHA-256 <the zip's hash>), <n> files written. Xomoni restarts now.
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-04 · happy

- Given an update written into the folder the tests' picker gave, and Xomoni asking Chrome to restart
- When the dashboard opens again, as Chrome reopens it after the restart
- Then a toast says Xomoni <next> was written, but Chrome still runs <version>: it loads Xomoni from another folder.
  Choose that folder in Settings › Updates., since Chrome loads Xomoni from its own folder, not that one
- And Home still counts the account's 2 posts: the data stays
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-05 · happy

- Given a zip install whose folder, chosen in Settings, is the one Chrome loads it from
- When the person presses Update now and the update is written
- Then Chrome restarts Xomoni as the new version, the dashboard opens again by itself, and a toast says Xomoni updated
  to <next>. Your data is all here.
- Manual: Playwright can't answer Chrome's folder picker (it aborts showDirectoryPicker), and Chrome blocks an extension the tests installed through its developer tools once it restarts itself, so no browser test can give Xomoni the folder it was loaded from or see it restart from there. The write into a folder, the journal and the restart's outcome are proven by apps/extension/tests/update.test.ts and update-write.test.ts, and the release check (docs/RELEASING.md) updates a real install.

## S305-06 · happy

- Given xomoni.com saying the next version is out, and the notice offering Set up one-click updates
- When the person chooses Xomoni's folder in Settings › Updates instead
- Then the notice offers Update now at once
- And once they press Forget the folder there, the notice offers Set up one-click updates again, with no Update now
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-07 · invalid

- Given Settings › Updates
- When the person picks a folder named photos, with no manifest.json in it
- Then the alert says “photos” isn’t Xomoni’s folder: it has no Xomoni manifest.json. Choose the folder you loaded
  Xomoni from: chrome://extensions shows it in Xomoni’s Details, under Source.
- And no folder is kept: the card still offers Choose Xomoni’s folder
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-08 · invalid

- Given Settings › Updates
- When the person picks a folder holding Xomoni 0.0.1, another copy than the one running
- Then the alert says “xomoni” holds Xomoni 0.0.1, but this one is <version>. Choose the folder you loaded Xomoni from…
- And no folder is kept
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-09 · invalid

- Given a release signed by the trusted key whose manifest names a later version than the one xomoni.com announced
- When the person presses Update now
- Then the alert says The download says it is another version than <next>, so it was thrown away. Nothing was changed.
- And the folder still holds <version>, and Xomoni doesn't restart
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-10 · invalid

- Given a signed release whose zip holds ../evil.js, a file outside Xomoni's folder
- When the person presses Update now
- Then the alert says The download of Xomoni <next> isn’t a complete, safe Xomoni, so it was thrown away. Nothing was
  changed.
- And the folder still holds <version>
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-11 · invalid

- Given a signed release that needs Chrome 999 (minimum_chrome_version)
- When the person presses Update now
- Then the alert says Xomoni <next> needs a newer browser than this one. Update your browser first (Chrome: Settings ›
  About Chrome), then update Xomoni. Nothing was changed.
- And the folder still holds <version>
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-12 · error

- Given GitHub out of reach
- When the person presses Update now
- Then the alert says Couldn’t download Xomoni <next> from GitHub. Check the connection and try again. Nothing was
  changed.
- And only the zip was asked for, the folder still holds <version>, and GitHub's access is given back all the same
- And the activity log says Couldn’t update Xomoni to <next>. Couldn’t download…
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-13 · error

- Given GitHub answering 502
- When the person presses Update now
- Then the alert says Couldn’t download Xomoni <next> from GitHub. Check the connection and try again. Nothing was
  changed.
- And Update now is on again, to try once GitHub answers, and the folder still holds <version>
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-14 · error

- Given Xomoni's folder chosen, and another copy of Xomoni, 0.0.1, put in it since
- When the person presses Update now
- Then the alert says The folder chosen doesn’t hold Xomoni <version> any more. Choose the folder Chrome loads Xomoni
  from. Chrome shows it on chrome://extensions: open Xomoni’s Details, and look under Source for where it was loaded
  from.
- And the notice offers Choose Xomoni’s folder again, and nothing was asked of GitHub
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-15 · security

- Given a release signed by another key than the one the build trusts
- When the person presses Update now
- Then the alert says The download of Xomoni <next> isn’t signed by Xomoni’s release key, so it was thrown away.
  Nothing was changed.
- And the folder still holds <version>, Xomoni doesn't restart, and the activity log says why
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-16 · security

- Given a release whose zip was changed by one byte after the trusted key signed it
- When the person presses Update now
- Then the alert says the download isn’t signed by Xomoni’s release key, so it was thrown away. Nothing was changed.
- And the folder still holds <version>
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-17 · security

- Given a release on GitHub with no signature next to its zip
- When the person presses Update now
- Then the alert says Xomoni <next> on GitHub has no signature, so Xomoni won’t install it. Nothing was changed.
- And the folder still holds <version>
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-18 · security

- Given a signed release that asks for more access (the tabs and history permissions)
- When the person presses Update now
- Then the alert says Xomoni <next> asks for more access than <version>, so it can’t update in one click. Download it
  and load it by hand: Chrome then shows what it asks for. Nothing was changed.
- And a signed release with another key in its manifest, another extension to Chrome, says Xomoni <next> is a new
  extension to Chrome, so updating in place would leave your data behind…, with the folder unchanged both times
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-19 · security

- Given a new install, connected to xomoni.com, told of a new version, and its folder chosen
- When the person has done all that, then presses Update now
- Then until the click, Xomoni has no access to GitHub, asked nothing of it, and asked for no access
- And on the click it asks for GitHub's access, downloads the zip and the signature only, and gives the access back
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-20 · security

- Given a cleanup job running, waiting for active hours, and a new version ready to install
- When the person looks at the notice
- Then Update now is off, and the notice says Xomoni updates only while no job runs., with nothing asked of GitHub
- And once they pause the job, Update now is on again
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-21 · empty

- Given xomoni.com saying a new version is out, and no folder chosen yet
- When the person looks at the notice
- Then it offers Set up one-click updates, and says Once: choose the folder you loaded Xomoni from, and let Xomoni
  change it. Each update is then one click…
- And there is no Update now yet, and Settings › Updates offers Choose Xomoni’s folder
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-22 · empty

- Given xomoni.com saying the newest version is the one running
- When the person looks at the dashboard and at Settings › Updates
- Then no notice says a version is out, and nothing offers an update: the card says This browser runs Xomoni <version>.
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-23 · cancel

- Given Settings › Updates
- When the person presses Choose Xomoni’s folder and closes the picker without choosing
- Then nothing is kept and nothing is said: no alert, and Choose Xomoni’s folder is there again
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-24 · cancel

- Given a new version ready to install
- When the person presses Update now and declines GitHub's access in Chrome's prompt
- Then the alert says Xomoni needs your OK to download its releases from GitHub. Nothing was changed.
- And nothing was asked of GitHub, the folder still holds <version>, and Update now is on again
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-25 · cancel

- Given Xomoni's folder chosen, and the notice of a new version
- When the person presses Forget the folder, then Not now on the notice
- Then the card offers Choose Xomoni’s folder again, still after a reload
- And the notice is gone, and stays gone after a reload, until a newer version is out
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-26 · a11y

- Given a person using only the keyboard, and the notice of a new version
- When they Tab to Set up one-click updates and press Enter, then Tab to Update now and press Enter
- Then the folder is chosen, and the update runs to the restart
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-27 · a11y

- Given the notice of a new version and Settings › Updates with the folder chosen
- When the person looks at them, and an update is refused for its signature
- Then the card, the notice and the refusal have no serious accessibility violation
- And the refusal is an alert, read out as it shows
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-28 · browser

- Given a browser set to dark mode
- When the person sees the notice of a new version and chooses the folder in Settings › Updates
- Then the notice and the card have no serious accessibility violation in dark colors
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

## S305-29 · persistence

- Given Xomoni's folder chosen in Settings
- When the person reloads the dashboard, and opens it in a second tab
- Then both say Xomoni’s folder: “xomoni”, and both notices offer Update now
- Test: apps/web/e2e/extension/one-click-updates.spec.ts

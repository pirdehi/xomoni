# ADR-0029: Xomoni's settings on xomoni.com, applied by Xomoni in the same browser

- Status: Accepted
- Date: 2026-11-20

## Context

[ADR-0027](0027-extension-actions-from-the-website.md) lets the website ask Xomoni, in the same browser, to stop or limit work, and lists settings among the actions that apply at once, "still clamped to one fifth of X's limits". The Settings place on xomoni.com (#234) needs that made precise:

- which settings the website may change;
- who checks them;
- what a change does to a job that is running;
- where it is recorded.

[ADR-0028](0028-xomoni-data-on-the-website-in-the-same-browser.md) already lets the website read Xomoni's data in the same browser, so it can show the settings as they are.

## Decision

1. **The website reads the settings with `xomoni-read` (`what: 'settings'`) and changes them with one message, `xomoni-settings`.**
   - Both go only to Xomoni in the same browser, under the checks of ADR-0027 and ADR-0028:
     - xomoni.com's top frame;
     - an exact shape;
     - signed in;
     - connected as the device the page's account names.
   - No server takes part.
2. **The website may change these, and nothing else:**
   - **Pacing:** only back to *Careful*, which runs at one fifth of every limit X publishes (ADR-0012). Custom pacing is slower by construction and is set in Xomoni, where its table lives.
   - **Active hours:** on or off, and the start and end hour. The same hour for both means all day, as in Xomoni.
   - **Notifications and *Keep going while away*:** on or off.
   - **Failures in a row before a job pauses:** 1 to 3 (PLAYBOOK C3).
   - **The active X account's Watch searches:** at most five, each at most 100 characters (ADR-0021). Each tab keeps its place; a tab whose search changed loses its old results.
3. **Xomoni decides what is stored.**
   - Every change goes through the extension's own `normalizeSettings` and Watch rules, as a change made in Xomoni does.
   - Nothing can be set faster than *Careful* or above the one-fifth ceilings, and the read budget still spaces Watch's searches.
   - The answer is the settings as stored, and the website shows those, not what it sent.
4. **A change never touches a job that is running.** A job keeps the settings it started with until it is paused and resumed, as in Xomoni. A change starts nothing.
5. **Every change is written to Xomoni's activity log** as *Settings changed on xomoni.com*, with what changed, so the person can see it in Xomoni.
6. **What stays in Xomoni:**
   - custom pacing;
   - the theme, which belongs to each screen;
   - deleting local data;
   - signing out.

   The website shows custom pacing as it is and offers *Open in Xomoni* for the rest.

Built in [#234](https://github.com/pirdehi/xomoni/issues/234).

## Consequences

- The Settings place on xomoni.com works like Xomoni's own page for the common choices, in the browser where Xomoni runs. Elsewhere it says where the settings live.
- A script injected into xomoni.com in the person's browser could turn active hours off or switch pacing back to *Careful*. It could not make Xomoni faster than its safety rules allow, and the log would show the change. The CSP and Trusted Types (#147) keep such scripts out.
- `xomoni-settings` is one more external message type, listed, parsed and tested like the others (ADR-0024). A new setting needs this ADR updated.

## Alternatives considered

- **Every change confirmed in Xomoni, like a resume.** Safer against an injected script, but none of these choices can exceed the safety rules, and a second click in another window for each hour picked would make the place pointless.
- **Settings kept in the cloud and synced.** They would then follow the account to every browser. But each browser's Xomoni keeps its own risk ladder and limits, and settings in the cloud would be a way for a stolen session to change how an extension runs.

# ADR-0027: The extension's actions on xomoni.com, in the same browser, confirmed in Xomoni

- Status: Accepted
- Date: 2026-11-19

## Context

This amends [ADR-0006](0006-website-is-view-only.md), under which the website has no endpoint, action or table column that starts, resumes or approves work on X.

The maintainer wants the dashboard on xomoni.com to include every option of the extension (#248). Once Xomoni is installed, its actions should be usable from the website. Until it is, the website should say so in a dialog.

ADR-0006 exists so that a stolen website session or a cross-site bug can't become a remote control for someone's X account. That reason still holds.

## Decision

1. **The website shows every action of the extension:**
   - start, pause, resume and cancel a job;
   - plan a cleanup;
   - get or import the archive;
   - start or stop watching;
   - change settings.
2. **An action reaches the extension only in the same browser.**
   - It goes through `chrome.runtime.sendMessage` to the extension that lists xomoni.com in `externally_connectable` (ADR-0024, ADR-0025).
   - No action travels through xomoni.com's servers, and nothing in the database can make an extension act. A session used on another device can't reach anyone's extension.
3. **The extension accepts an action only when all of these hold:**
   - it comes from xomoni.com's top frame;
   - its type is on a fixed list, and its fields have the expected shapes;
   - the website session is the same xomoni.com account the extension is signed in to (ADR-0025).
4. **Work on X is still approved in Xomoni, never on the website.**
   - These actions open Xomoni's dashboard with its own confirmation: starting or resuming a job, getting the archive, starting to watch.
   - Where Xomoni asks for typed consent (`I UNDERSTAND`) or `DELETE`, it asks there.
   - The website can ask; only the person, in the extension, can say yes.
5. **Actions that only stop or limit work apply at once, and the activity log records them:**
   - pausing;
   - cancelling;
   - settings, which are still clamped to one fifth of X's limits (ADR-0012).
6. **When the extension can't be reached, every action opens one dialog that says why:**
   - **Not installed in this browser:** the install steps, and *I've installed it*, which says to press *Connect to xomoni.com* in Xomoni once.
   - **On a phone:** Xomoni runs on a computer, with *Send to my computer*.
   - **Installed but signed out, or signed in to another account:** *Sign in to Xomoni in this browser*.

Built in [#251](https://github.com/pirdehi/xomoni/issues/251).

## Consequences

- A compromised website session on another device still can't act on X.
- A script injected into xomoni.com in the person's own browser could ask for work, but still couldn't approve it. The site's CSP and Trusted Types (#147) keep scripts out.
- Every action the extension accepts is a new external message type. Each one is listed, parsed and tested like the pairing message (ADR-0024).
- The website knows the extension's id only after the extension has opened one of its pages (`#ext=`). Until #244 opens `/welcome` on install, *I've installed it* covers a fresh install.

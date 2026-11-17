# ADR-0023: Sign out of Xomoni in the extension: a signed-out state, not just a disconnect

- Status: Accepted
- Date: 2026-11-15
- Amended: 2026-11-17, signing in to xomoni.com also ends a sign-out, and a sign-out on either side signs out both ([ADR-0025](0025-one-sign-in-for-the-website-and-the-extension.md), #232)

## Context

The extension has no account of its own. It works on the X account the browser is signed in to, and it can report job status to a xomoni.com account through a device token ([ADR-0018](0018-pair-the-extension-with-a-one-time-code.md)). Until #226, "signing out" meant two unrelated things in the account menu:
- *Sign out of X* opened X's sign-out page.
- *Disconnect* ended the xomoni.com link at once, with no confirmation.

Neither one ended what Xomoni was doing:
- The dashboard kept showing the account.
- The X window stayed open.
- The service worker kept recording what X pages showed.
- The account's data could only be removed together with everything else.

The X session can't be the sign-out either. Xomoni never touches X's cookies or password ([ADR-0003](0003-no-credentials-no-evasion.md)), and the dashboard takes up whatever account the X window is signed in to. So an X session left open would sign the person straight back in.

## Decision

1. **Xomoni has its own signed-out state.** It is stored in the extension's IndexedDB (`kv`, key `signedOut`) with when, which handle, and whether the data stayed (`shared/session.ts`). While it is set:
   - the dashboard has no active account and shows only the signed-out page;
   - the service worker drops what X pages show, keeping only X's rate limits, which hold no X content;
   - the dashboard doesn't take up the account the X window reports.
2. **Signing in again is explicit.** On the signed-out page, the person opens the X window and signs in to X there, then presses *Continue as @handle* (`signIn`). The first install keeps taking up the account by itself, as before.
3. **One sign-out does everything, in order** (`ui/sign-out.ts`):
   - record the sign-out first, so nothing more is recorded and every dashboard tab pauses its job (`useSignOutGuard`);
   - wait for the runner's Web Lock to be released (up to 30 seconds);
   - stop running hidden;
   - disconnect from xomoni.com, which revokes the token there;
   - remove the account's data if chosen;
   - close the X window Xomoni opened;
   - open X's own sign-out page if chosen.
4. **Removing data is per account and safe.**
   - `forgetAccount` removes the inventory, jobs, log, limits, checks, consent and every `kv` value of that account. Other accounts and the settings stay.
   - Like *Delete local data*, it keeps the page loads, the risk ladder and the learned view cap, so X's limits still hold.
   - It runs only once no job runs. A job still finishing after the wait keeps the data, and the person is told.
   - The dialog offers a copy of the account's data first.
5. **Signing out of X stays X's.** The dialog only opens `https://x.com/logout`, where X asks to confirm.

## Consequences

- The account menu ends with *Sign out of Xomoni*, and *Disconnect* asks to confirm. The X card no longer has its own *Sign out of X*: that is a choice in the sign-out dialog.
- A paused job continues where it stopped after signing in again, unless its data was removed.
- New stored state: `signedOut` in `kv`. *Delete local data* clears it with the rest of `kv`.
- If the person signs in to X with another account, *Continue as* names that account. Data of the previous account stays until it is removed.

## Alternatives considered

- **Sign out = sign out of X.** Xomoni can't do that without touching X's session (ADR-0003), and it would still leave the xomoni.com link and the local data as they were.
- **Sign out = disconnect from xomoni.com.** The extension would keep working on X, which isn't what the person asked.
- **Always remove the data on sign-out.** That would lose the inventory and archive of someone who only steps away. Removal is offered, after a copy, and off by default.

# ADR-0025: One sign-in for xomoni.com and the extension in the same browser

- Status: Accepted
- Date: 2026-11-17

## Context

This amends [ADR-0018](0018-pair-the-extension-with-a-one-time-code.md) (how a browser connects), [ADR-0023](0023-sign-out-of-xomoni-in-the-extension.md) (what ends a sign-out) and [ADR-0024](0024-connect-a-browser-with-one-click.md) (when the extension takes a code without a nonce of its own).

In one browser, the website and the extension had separate states:
- The website has a Supabase session.
- The extension has its signed-out state (ADR-0023) and, once connected, a device token (ADR-0018).

To be signed in on both, the person signed in on xomoni.com, then connected the browser (ADR-0024). Signing out on one side left the other signed in. The maintainer asked for one sign-in (#232):
- signing in on the website signs the extension in, and the other way round;
- signing out on either side signs out both.

ADR-0018's reasons still hold, so the extension can't simply hold a website session:
- The captcha can't run in the extension.
- An unpacked install has no fixed id.
- A session can do too much.

What can travel between the two is what ADR-0024 already uses: messages from xomoni.com's pages to the extension through `externally_connectable`. The answers come back the same way.

## Decision

1. **The website finds the extension by the id it is given.**
   - Every xomoni.com page the extension opens carries `#ext=<extension id>` in its fragment, which never reaches a server: the dashboard link (`websiteLink`) and `/connect`.
   - The site keeps the id in `localStorage` (`xomoni.extension`) and clears it from the address bar.
   - The id isn't a secret.
2. **One contract, in `packages/bridge` (`@xomoni/bridge`).** It defines four messages, each parsed strictly (exact keys and shapes):
   - `xomoni-hello` asks how the extension stands. The answer gives its version; its connection as device id, masked account and when (never the token); since when it is signed out; and when the person last left xomoni.com there (`leftAt`).
   - `xomoni-sign-in` carries a one-time code from a signed-in page. It may name the device of a connection to another account to `replace`.
   - `xomoni-sign-out`.
   - `xomoni-pair` is ADR-0024's handover, unchanged.

   The service worker answers only xomoni.com's top frame (`cloud/website.ts`). It runs the messages that change the connection one after another.
3. **The newest action wins** (`modules/extension/domain/session-sync.ts`, `decideSync`). Each page of the site asks how the extension stands when it opens, when it comes back into view and when the browser signs in or out. It then compares:
   - **The website's side:**
     - when this browser first saw the current session (`xomoni.session`, keyed by the access token's `session_id`, kept on every page even before the site knows the extension);
     - when the person last signed out there (`xomoni.signedOutAt`).
   - **The extension's side:**
     - when it connected;
     - `leftAt`, the person's last sign-out of Xomoni or of xomoni.com in the extension.

   The rule:
   - Signed in, and the extension reports as one of the account's devices: nothing to do.
   - Signed in, but the extension left, or connected to another account, after the session started: the website signs out.
   - Otherwise signed in: the extension signs in to this account. A connection to another account is replaced.
   - Signed out after the extension connected: the extension signs out.
   - A browser without a connection is never signed out by the website. An account stays optional.

   All these times come from the same computer's clock. A Web Lock makes sure only one tab syncs at a time.
4. **Signing in on the website signs the extension in.**
   - The page makes a one-time code (`create_pairing_code`, ADR-0018) and sends `xomoni-sign-in`. The extension trades the code itself; the page never sees a token.
   - The extension takes the code only when it isn't connected, or when the page named its current connection to replace.
   - The account is confirmed at once (#149): the person signed in to it in this browser.
   - Signing in also ends a sign-out of Xomoni (`endSignOut`). The active X account stays the one from before.
5. **Signing in from the extension signs in on the website.**
   - *Sign in to xomoni.com* (Settings, the account menu, the signed-out page) opens `/connect` with ADR-0024's nonce.
   - The person signs in there once. A signed-in `/connect` then pairs at once, without the extra click.
   - That pairing also ends the extension's sign-out.
6. **Signing out on the website signs the extension out.**
   - Every form that posts to `/auth/signout` first sends `xomoni-sign-out` and remembers the time. Examples are the header's *Sign out* and the account page's buttons.
   - The extension then signs out as ADR-0023 does, keeping the data: the job pauses in every dashboard tab, the X window closes (`finishSignOutMadeElsewhere`) and the token ends on xomoni.com.
   - An extension that missed the message is signed out by the next sync.
7. **Signing out in the extension signs the website out.**
   - *Sign out of Xomoni* and *Sign out of xomoni.com* (the former *Disconnect*) record `leftAt` (`leaveWebsite`).
   - xomoni.com signs out the next time one of its pages opens or comes back into view in this browser.
   - Disconnecting a code someone else gave (#149) only ends that link.
8. **The dashboard marks This browser.** It offers no *Disconnect* for it: the sync would sign a disconnected browser straight back in, so signing out is how to disconnect it.
9. **Nothing new can act on X.**
   - None of the messages carries X content (ADR-0004).
   - None can start, resume or approve work on X (ADR-0006). Anything else is answered `invalid`.
10. **Architecture.**
    - The website has a new module, `modules/extension` (hexagonal like the others).
    - The service worker imports only `cloud/website.ts` from `cloud/` (rule `ext-background-is-thin`).
    - The website's `domain/` and `application/` may import `@xomoni/bridge`, a pure contract (rules `web-domain-is-pure`, `web-application-depends-on-domain`).

Amended 2026-11-20 (#244): on install, Xomoni also opens `xomoni.com/welcome#ext=<id>` in front of its own dashboard. The site learns the extension's id from the fragment, which never reaches a server, as `/connect` does. `/welcome` asks nothing of Xomoni: it shows a checklist of what the page can see, and offers the one sign-in or *Continue without an account*. Only an install opens it, never an update.

## Consequences

- In one browser, one sign-in and one sign-out cover both. The usual paths:
  - sign in on xomoni.com, and Xomoni signs in by itself;
  - press *Sign in to xomoni.com* in Xomoni, and sign in once there;
  - sign out on either side.
- The first link needs the extension to open a xomoni.com page once, from *Sign in to xomoni.com* or the dashboard link. Before that, the site can't know the extension's id. A Chrome Web Store install (#43) has a fixed id, but zip installs don't.
- **Security.** A script that ran on xomoni.com (XSS) could now do two things without a fresh request of the extension's:
  - sign the extension out, which pauses its job;
  - sign it in to the account that page is signed in to.

  It still can't read X content or the token, or start, resume or approve work on X: no message does that. The site's Content-Security-Policy and Trusted Types (#147, ADR-0014) remain the defense, and no third-party script runs on the site.
- The extension still holds only a device token. The website's session never leaves the website.
- A website session can end by itself, for example after 30 days without a visit. That leaves the extension signed in, and the website then asks to sign in. Signing in with the same account changes nothing in the extension. Signing in with another account switches it.
- Several people sharing one browser profile share one sign-in. That is how a browser profile already works for the website.
- The next step reads the extension's data on the website through the same channel, in this browser only (#233). It needs this ADR extended for messages that carry X content to a page.

## Alternatives considered

- **Hand the website's session to the extension.** ADR-0018's reasons still hold: Supabase rotates refresh tokens between two clients, and a session can do too much.
- **Let the device token sign the website in** (a server function that turns it into a session). The token would become a full credential, while today a stolen one can only report fake status.
- **A content script on xomoni.com to find the extension.** It needs host access to xomoni.com, which brings a permission warning and undoes #143.
- **Sign the website out from the extension on the server** (end the web session with the device token). This also makes the token more powerful. Signing out on the next page view gives the person the same result.

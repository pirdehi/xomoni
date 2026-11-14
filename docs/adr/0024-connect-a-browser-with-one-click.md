# ADR-0024: Connect a browser with one click: the extension asks, xomoni.com hands over the one-time code

- Status: Accepted
- Date: 2026-11-15

## Context

This amends [ADR-0018](0018-pair-the-extension-with-a-one-time-code.md), in how the code reaches the extension, and #143's "exposes nothing to web pages".


With ADR-0018, connecting a browser took about ten actions in two places:
1. sign in on xomoni.com and open the dashboard;
2. get a code and copy it;
3. go back to the extension, then Settings;
4. paste the code and name the browser;
5. press Connect, then *Yes, it's mine*.

People setting Xomoni up for the first time found it the hardest part. The code itself is sound: one-time, 10 minutes, a narrow device token behind it. Only carrying it by hand is not.

ADR-0018 rejected `externally_connectable` because it needed a fixed extension id and would share a session. Neither holds for handing over the code:
- The extension tells the website its id in the URL it opens.
- Only the one-time code passes, never a session or token.

## Decision

1. **The extension asks.**
   - *Connect to xomoni.com* (Settings) or *Connect this browser* (account menu) stores a random 128-bit nonce with the time (`kv` key `connectRequest`, replacing any earlier one).
   - It opens `https://xomoni.com/connect#ext=<extension id>&nonce=<nonce>`. The fragment never reaches a server.
2. **The website finishes, on the person's click.**
   - `/connect` keeps the request in `localStorage` for 15 minutes and clears it from the address bar, so it survives sign-in and sign-up.
   - Signed in, the page names the account in full and says what is sent.
   - *Connect this browser* calls `create_pairing_code()` as today and sends `{type: 'xomoni-pair', code, nonce}` to that extension id with `chrome.runtime.sendMessage`.
3. **The extension accepts only what it asked for.**
   - The manifest's `externally_connectable` lists only `https://xomoni.com/*`, and no other extension.
   - The service worker checks again that the sender is xomoni.com's top frame.
   - The message must have exactly those three fields, with a code shaped like a pairing code.
   - The nonce must be the stored one, at most 15 minutes old. It is used up before pairing, so a message works once.
   - A browser that is already connected is left alone.
   - The service worker then trades the code with `pair_device` (ADR-0018) and answers `{ok, account}` or `{ok: false, reason}`.
4. **The account check moves to the click (#149).** The website names the account before the person presses Connect, so the extension marks the connection confirmed and reports at once. With a typed code, the extension still asks *Is that your account?*.
5. **The service worker may import `cloud/web-connect.ts`, and nothing else from `cloud/`** (rule `ext-background-is-thin`). Pairing then works even while the dashboard is closed.
6. **Nothing else comes in this way.** The single message type can only pair. It can't start, resume or approve work on X (ADR-0006), and anything else gets `invalid`.

## Consequences

- Connecting takes three actions on the website, often two:
  - press Connect in the extension;
  - sign in, often already done;
  - press Connect on the website.
- The code stays the fallback, folded under *Use a one-time code instead*, for another computer or a browser where the website can't reach the extension.
- `externally_connectable` adds no permission warning, and no update is held back for it.
- A page on xomoni.com that someone could script (XSS) could send a code only while this browser has a fresh request of its own, and only for an account it is signed in to. Other extensions and sites can't send at all. The site's CSP and Trusted Types (#147) keep scripts out.
- Sign-up through an emailed link ends on the dashboard, not `/connect`. While a request is kept, the dashboard shows *Finish connecting*.
- A zip install's extension id differs per folder. That's fine: the id travels in the URL. The Chrome Web Store, once there (#43), changes nothing here.

## Alternatives considered

- **A content script on xomoni.com reading the code from the page.** It needs host access to xomoni.com, which shows a permission warning, and it trusts the whole page's DOM.
- **A fixed extension id (`key` in the manifest), so the website can find the extension by itself.** Changing the id of existing zip installs would orphan their local data, and the store gives its own id anyway.
- **Signing in to Supabase inside the extension.** ADR-0018's reasons still hold: the captcha can't run there, and a session can do too much.

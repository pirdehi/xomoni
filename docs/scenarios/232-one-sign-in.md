---
task: 232
title: One sign-in for xomoni.com and Xomoni
feature: one-sign-in
---

# One sign-in for xomoni.com and Xomoni

Signing in on xomoni.com signs Xomoni in, in the same browser, with no code to type; signing out on either side signs the other out too; and an account stays optional (#228, #232, [ADR-0024](../adr/0024-connect-a-browser-with-one-click.md), [ADR-0025](../adr/0025-one-sign-in-for-the-website-and-the-extension.md)). xomoni.com and Xomoni talk through Chrome's own `externally_connectable` channel, open to https://xomoni.com only: the website's page asks how Xomoni stands (`xomoni-hello`), hands it a one-time code to sign in (`xomoni-sign-in`), or finishes a sign-in Xomoni started with its nonce (`xomoni-pair`), and signs it out (`xomoni-sign-out`). Xomoni trades a code for its own device token on xomoni.com, never shows the website that token, and signs out of xomoni.com when the person signs out in Xomoni. Written for #345, the features shipped before the scenarios gate. A fix the scenarios found is in the same pull request: in dark mode, a primary button's text while hovered was below WCAG AA (S232-22).

Each side is tested with the other played at it:

- **Xomoni's side** (S232-01 to S232-24): the built extension in a real browser on x.com served from synthetic fixtures ([ADR-0040](../adr/0040-test-the-extension-against-recorded-x-fixtures.md)), with xomoni.com played at the extension (`apps/web/e2e/support/xomoni-site.ts`): its pages send Xomoni the website's own messages through Chrome's channel, and the functions Xomoni calls on xomoni.com's Supabase project answer from a small state, for a made-up account, f•••@example.com. Run them with no Supabase:

  ```bash
  npm run test:e2e:extension -w @xomoni/web -- --grep @task-232
  ```

- **The website's side** (S232-25, S232-26): xomoni.com and its local Supabase, with Xomoni played at the page, as the website's other tests do. Run them with the local stack:

  ```bash
  supabase start
  npm run test:e2e -w @xomoni/web -- --grep @task-232
  ```

CI runs every scenario in Chromium (`e2e`) and again in Microsoft Edge (`e2e-edge`).

## S232-01 · happy

- Given Xomoni working on @xomoni_fixture, not signed in to xomoni.com, and a xomoni.com page signed in to the person's
  account
- When the page hands Xomoni a one-time code (xomoni-sign-in)
- Then Xomoni answers that it signed in, as f•••@example.com, with its device
- And it traded the code for its own device on xomoni.com (pair_device, with its version), then reported at once: the
  account is the person's own, so there is nothing to confirm
- And Connections shows xomoni.com Connected, as f•••@example.com
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-02 · happy

- Given Xomoni signed in to xomoni.com from its page, with the X window open
- When the person signs out on xomoni.com, whose page tells Xomoni (xomoni-sign-out)
- Then Xomoni answers that it signed out, and shows You’re signed out: @xomoni_fixture’s data is still here
- And its X window closes, and its device on xomoni.com is ended (unpair_device)
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-03 · happy

- Given Xomoni not signed in to xomoni.com
- When the person presses Sign in to xomoni.com in Settings
- Then a tab opens on xomoni.com/connect with Xomoni's id and a fresh nonce in the address's fragment, and Settings says
  Finish on xomoni.com: sign in there, in the tab that opened. Xomoni here signs in with you.
- And once the person is signed in there, the page hands over a code with that nonce (xomoni-pair): Xomoni answers that
  it signed in, and Settings shows it connected to f•••@example.com, with Sign out of xomoni.com
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-04 · happy

- Given Xomoni signed in to xomoni.com, whose page's hello sees its connection
- When the person signs out of Xomoni from its account panel
- Then the next hello from xomoni.com's page, as when the page comes back into view, says Xomoni has no connection and
  left when it signed out: the website signs out too
- And Xomoni ended its device on xomoni.com
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-05 · happy

- Given Xomoni signed in to xomoni.com
- When the person presses Sign out of xomoni.com in Connections and confirms
- Then the confirmation said This browser stops sending job status to f•••@example.com, and xomoni.com signs out in
  this browser too. Xomoni keeps working here on @xomoni_fixture; sign in again here or on xomoni.com.
- And a toast says Signed out of xomoni.com in this browser, Xomoni stays on Home with the X account, and the next
  hello says no connection, not signed out of Xomoni, and left xomoni.com just now
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-06 · happy

- Given Xomoni signed in to xomoni.com
- When xomoni.com's page asks how it stands (xomoni-hello)
- Then Xomoni answers with its version, its device, the account masked as f•••@example.com and when it connected, not
  signed out, never left
- And nothing in the answer is its token
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-07 · invalid

- Given Xomoni that didn't start a sign-in
- When a xomoni.com page hands over a code with a nonce Xomoni never made (xomoni-pair)
- Then Xomoni answers not_asked, asks xomoni.com nothing, and stays not signed in
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-08 · invalid

- Given a xomoni.com page
- When it hands Xomoni a code xomoni.com doesn't know
- Then Xomoni answers bad_code, for the page to say so, and stays not signed in: Connections shows Not connected
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-09 · invalid

- Given a xomoni.com page
- When it sends messages out of shape: a sign-in with no code or an extra field, a sign-out with a field, a pairing
  with a malformed code and nonce, an unknown type, a bare string
- Then Xomoni answers invalid to each, asks xomoni.com nothing, and goes on as it was
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-10 · error

- Given xomoni.com's database out of reach
- When a xomoni.com page hands Xomoni a code
- Then Xomoni answers unreachable, for the page to say so, stays not signed in, and goes on with the X account
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-11 · error

- Given Xomoni signed in to xomoni.com, and xomoni.com's database then out of reach
- When the person signs out on xomoni.com, whose page tells Xomoni
- Then Xomoni signs out all the same: it answers that it signed out, shows You’re signed out, and forgets its
  connection
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-12 · error

- Given a sign-in started from Xomoni, and xomoni.com out of reach when its page hands over the code
- When the page hands over the same code and nonce again, once xomoni.com is back
- Then the first answer was unreachable and the second not_asked: a nonce is used once, even when the sign-in fails
- And pressing Sign in to xomoni.com again starts afresh with a new nonce, which signs Xomoni in
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-13 · security

- Given Xomoni installed, and a xomoni.com page with a frame of xomoni.com in it
- When x.com, and the frame, try to send Xomoni a sign-in
- Then x.com has no way to: Chrome gives its pages no channel to Xomoni
- And the frame gets no answer, and nothing is asked of xomoni.com: only the website's page itself is heard
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-14 · security

- Given Xomoni signed in to xomoni.com
- When a xomoni.com page hands it another code without naming this browser's device as the one to replace
- Then Xomoni answers already_connected, pairs nothing more, and keeps its connection
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-15 · security

- Given a cleanup job running, and Xomoni signed in to xomoni.com
- When the person signs out on xomoni.com
- Then Xomoni shows You’re signed out, and the job is paused: once the person continues as @xomoni_fixture, it waits
  with Resume
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-16 · empty

- Given a person who never signs in to xomoni.com
- When they use Xomoni, and a xomoni.com page asks how it stands
- Then Xomoni works on their X account as ever: Home counts the 2 posts, and Connections shows xomoni.com Not
  connected, with Sign in to xomoni.com
- And the hello says no connection, never signed out, never left, and nothing is asked of xomoni.com
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-17 · empty

- Given Xomoni not signed in to xomoni.com
- When a xomoni.com page tells it to sign out
- Then Xomoni answers that there was nothing to sign out, and goes on with the X account: Home, not the signed-out page
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-18 · cancel

- Given Xomoni signed in to xomoni.com, and Sign out of xomoni.com? open
- When the person presses Cancel
- Then Xomoni stays signed in: the hello still sees its device, and nothing was ended on xomoni.com
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-19 · cancel

- Given a sign-in started from Xomoni, waiting for xomoni.com
- When the person presses Cancel in Settings
- Then Settings offers Sign in to xomoni.com again, and the code xomoni.com's page then hands over with that nonce is
  refused, not_asked
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-20 · a11y

- Given a person using only the keyboard, Xomoni signed in to xomoni.com
- When they Tab to the account in the sidebar, press Enter, Tab to Sign out of xomoni.com and press Enter
- Then the confirmation opens with the focus on Sign out of xomoni.com, and Enter signs out
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-21 · a11y

- Given Xomoni signed in to xomoni.com
- When the person looks at Settings' xomoni.com card, Connections, and Sign out of xomoni.com?
- Then none has a serious accessibility violation
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-22 · browser

- Given a browser set to dark mode
- When the person presses Sign in to xomoni.com in Settings, waits for xomoni.com, and is signed in from there
- Then Settings, waiting and then signed in, has no serious accessibility violation in dark colors, the primary button
  under the pointer included
- And CI runs every scenario again in Microsoft Edge (e2e-edge)
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-23 · persistence

- Given Xomoni signed in to xomoni.com from its page
- When the person reloads the dashboard, and opens it in a second tab
- Then both show it connected to f•••@example.com, and the hello still sees its device
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-24 · persistence

- Given Xomoni signed out by xomoni.com
- When the person reloads the dashboard, then signs in on xomoni.com again
- Then Xomoni stays signed out through the reload, and signing in on xomoni.com signs it in again and ends the sign-out
- Test: apps/web/e2e/extension/one-sign-in.spec.ts

## S232-25 · happy

- Given a confirmed xomoni.com account, and Xomoni in the browser, which opened a xomoni.com page with its id
- When the person signs in on xomoni.com
- Then xomoni.com hands Xomoni a one-time code by itself, Xomoni signs in, and Browsers lists this browser as This
  browser
- And once the person signs out on xomoni.com, the website tells Xomoni, which signs out too
- Test: apps/web/e2e/one-sign-in.spec.ts

## S232-26 · persistence

- Given the person signed in on xomoni.com, and Xomoni signed in with them
- When they sign out in Xomoni, and xomoni.com's page comes back into view
- Then xomoni.com signs out too, at its sign-in page
- And signing in there again signs Xomoni in again
- Test: apps/web/e2e/one-sign-in.spec.ts

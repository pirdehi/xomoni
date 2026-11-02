# ADR-0018: Pair the extension with a one-time code; it holds a device token, not a session

- Status: Accepted
- Date: 2026-11-02

## Context

Phase 5 lets the website show the extension's job status (#38, #39, #40). The first schema assumed the extension would sign in to Supabase as the person and write its rows under Row Level Security. Three things make that a poor fit:

- **The captcha can't run in the extension.** Sign-in with a password goes through Cloudflare Turnstile ([ADR-0011](0011-email-and-password-sign-in.md)). Manifest V3 extension pages can't load remote scripts, so Turnstile can't run there.
- **Google sign-in needs a fixed extension id.** `chrome.identity` redirects to `https://<extension id>.chromiumapp.org/`. An unpacked install from a release zip gets an id from its folder path, so every person's id differs.
- **A session can do too much.** With the person's session, the extension could also change the email, delete the account or read every device. It needs none of that: it only reports status ([ADR-0004](0004-x-data-stays-local.md)).

## Decision

1. **The website makes a one-time code.** A signed-in person asks the dashboard for a code (`create_pairing_code()`, `authenticated` only): 10 characters of Crockford base-32 (50 bits), shown as `XXXXX-XXXXX`, valid for 10 minutes, one per person at a time. Only its SHA-256 hash is stored (`device_pairings`).
2. **The extension trades the code for a device token.** The person types the code into the extension's Settings. The extension calls `pair_device(code, name, version)` with the publishable key and no session. A code that works is used up; the call creates the device (under the cap of 10, #82) and returns a 256-bit random token once. Only its SHA-256 hash is stored (`device_tokens`).
3. **The token can do three things, through functions only:** `device_report(token, version, jobs)` records a heartbeat and up to 50 job summaries (#39, #40); `unpair_device(token)` disconnects the device. An unknown token gets the hint `unknown_device`, which the extension reads as "disconnected". It can't read anything.
4. **The secret tables are closed.** `device_pairings` and `device_tokens` have Row Level Security on and no policies; `anon` and `authenticated` have no privileges on them. Only the security-definer functions, with an empty `search_path`, touch them.
5. **What is sent stays status.** A job summary carries Xomoni's own title, state, phase, counters, timestamps and the risk level (0–4). No post text, no X notices: the reason field is left empty unless the text is Xomoni's own.
6. **The website stays view-only** ([ADR-0006](0006-website-is-view-only.md)). Making a code and disconnecting a device are the only things it changes; neither acts on X.

## Consequences

- Pairing works the same for every account, whether it signs in with a password or with Google, and for every install, whatever its extension id.
- A stolen token can only report fake status for one device, which the person sees and disconnects on the dashboard. It can't read the account or other devices.
- The person types a code once per browser. Codes expire in 10 minutes, so a code seen over someone's shoulder is soon useless; a code that worked can't be used again.
- The extension keeps the token in `chrome.storage.local`, outside the X data in IndexedDB.
- The old `authenticated` insert and update policies on `devices` and `jobs` stay, but the extension doesn't use them; they only let a person write their own rows.

## Alternatives considered

- **Supabase sign-in inside the extension (password or Google).** Blocked by the captcha and the varying extension id, and it hands the extension a full session.
- **A session handed over from xomoni.com (`externally_connectable`).** Needs a fixed extension id too, and shares one refresh token between two clients, which Supabase rotates.
- **An Edge Function that mints a narrow JWT.** Works with the policies as they are, but needs the project's signing key in a function and more moving parts than three SQL functions.

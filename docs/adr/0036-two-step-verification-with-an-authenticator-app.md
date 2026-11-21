# ADR-0036: Two-step verification with an authenticator app, required by the server and the database

- Status: Accepted
- Date: 2026-11-21

## Context

A xomoni.com account signs in with a password or Google ([ADR-0011](0011-email-and-password-sign-in.md)). Anyone who has the password, or a copy of the session, can use the account: read its devices and job history, connect a browser of their own ([ADR-0018](0018-pair-the-extension-with-a-one-time-code.md)), turn the daily numbers and the weekly email on or off, and delete it.

The security review of 2026-11-04 (#148) found TOTP enrollment on in `supabase/config.toml` with no page for it and no check of the session's level. Enrollment was turned off until there was one, because a stolen session could otherwise add an app the owner never sees and lock them out. #173 asks for the page.

What Supabase Auth gives (GoTrue v2.198, `@supabase/supabase-js` 2.118, checked against the local stack):

- **TOTP factors**, free on every plan: `mfa.enroll` returns a QR code and its secret once; `mfa.challenge` and `mfa.verify` raise the session from `aal1` to `aal2`. The level is the access token's `aal` claim.
- **Its own rules at `aal1`** for an account with a verified factor: it refuses to add another factor, to remove a verified one (`insufficient_aal`), and to change the email or the password.
- **Codes**: 30-second steps, one step of drift each way. A challenge works once, from the address that made it, for 5 minutes. The same code is taken again on a new challenge within its window: Supabase doesn't remember used codes.
- **Rate limit**: 15 challenge and verify requests a minute per IP, bursts of 30, not configurable on the hosted platform. The local stack doesn't apply it. No lockout per account.
- **Notifications**: an email when a factor is added or removed (`[auth.email.notification.mfa_factor_*]`).
- **Recovery codes** exist in Supabase Auth, but are experimental: the client has to opt in (`experimental.recoveryCodes`), and the CLI the project pins (2.116) has no setting to turn them on. Phone factors are a paid add-on; WebAuthn factors are off.
- **Hooks** that could reject a verification (per-account lockout, a recent sign-in before enrolling) need the Team plan.

## Decision

1. **An authenticator app, on the account page.** `/account` has a *Two-step verification* section (`modules/auth/ui/two-factor-settings.tsx`):
   - Adding an app: an optional name, then the QR code and the key in groups of four, shown only now, then its first code. A cancelled enrollment removes the unconfirmed factor; any left from an earlier visit are removed before the next starts (`startEnrollment`).
   - The list of apps with when each was added, and *Remove* after a confirmation that says when it turns two-step verification off.
   - A second app is encouraged as the backup.

   The calls run in the browser, like the rest of interactive auth (ADR-0011), so Supabase's per-IP limit applies to the person.
2. **The code after sign-in**, at `/login/two-factor` (`two-factor-form.tsx`). A password or Google sign-in of an account with a verified app goes there first, and on to the page that asked (`?next=`, same-site only). One field takes the code, with `autocomplete="one-time-code"` and a numeric keypad; each of the account's apps is tried, so the person needn't say which one it came from. A password change asks for a code too: signing in again to check the current password starts a new `aal1` session, and Supabase refuses a new password below `aal2`.
3. **The server checks the level, not the page.**
   - `getSessionState` (`modules/auth/application/use-cases.ts`) reads `aal` from the verified token (`getClaims`). Only below `aal2` does it ask Supabase Auth whether the account has a verified app (`listFactors` reads the user from the Auth server, never the cookie).
   - The proxy redirects a session that owes a code from every page that needs a session (`/dashboard/*`, `/account`, `/reset-password`) and from the guest pages to `/login/two-factor`.
   - The Data Access Layer is the boundary: `requireViewer` and `requireAccount` redirect there, and `currentViewer` treats such a session as signed out. The *Delete account* Server Action and the OAuth callback check it too.
   - An account without an app is unchanged at `aal1`.
4. **The database refuses too** (`20261121130000_two_factor.sql`), so the Data API gives a stolen password or session nothing either:
   - `public.mfa_satisfied()` is true at `aal2`, or for an account without a verified factor.
   - Restrictive policies on `devices`, `jobs`, `daily_stats`, `daily_stats_choices`, `weekly_emails` and the dashboard's Realtime channel (`realtime.messages`) add it to the owner checks.
   - `delete_account()`, `create_pairing_code()`, `set_daily_stats()` and `set_weekly_email()` raise with the hint `second_factor_required`.
   - The extension's functions take a device token, not a session, and are unchanged (ADR-0018).
5. **Every change is emailed** to the account: an app added, an app removed. A change made with a stolen session doesn't go unseen.
6. **Recovery without the app is a person, not a page.** The code page and the account page say: write to privacy@xomoni.com from the account's address.
   - The maintainer sends a message to that address and asks the person to sign in once more with the password or Google. The Auth logs then show a sign-in after it.
   - The maintainer waits 3 days (`RECOVERY_COOL_DOWN_DAYS`) while telling that address, then removes the apps with the Auth admin API (dashboard, or `auth.admin.mfa.deleteFactor`).
   - The steps are in [SECURITY.md](../../SECURITY.md#lost-authenticator-app).
   - The site has no way to skip the second step on its own: a reset by email alone would make the inbox the only factor.
7. **The extension's one sign-in waits for the code** ([ADR-0025](0025-one-sign-in-for-the-website-and-the-extension.md)). A browser whose session owes a code counts as signed out for the sync: the database would show it no devices and make it no code. A verified code (`MFA_CHALLENGE_VERIFIED`) starts the sync.
8. **Config.** `[auth.mfa.totp] enroll_enabled = true` again, with the two notifications, in `supabase/config.toml`.

## Consequences

- With an app, the password alone, or a copied `aal1` session, no longer reads or changes anything: not on the website, not through the Data API, not in Supabase Auth.
- A copied `aal2` session still works until it expires or is signed out. *Sign out everywhere* ends it, and so does a password change.
- People who lose every app wait a few days for a person to help. Two apps avoid that, and the page says so.
- Known limits, accepted for now:
  - A code can be used twice within its 30 to 90 seconds, on two challenges.
  - Guessing codes is limited only per IP, 15 a minute: someone with the password could try about 900 codes an hour from one address. Each succeeds with a chance of about 3 in a million.
  - Enrolling the first app needs no recent sign-in: Supabase has no setting for it without a Team-plan hook. The notification email and the recovery path are the defence against a stolen session adding one.
- The emails count toward the project's email limit (30 an hour, #148).
- The local stack can't show the rate limit or a 5-minute challenge expiring. Unit tests cover how both read; the end-to-end tests cover the rest against real Supabase Auth.
- Follow-up: offer Supabase's recovery codes once they leave experimental status and the CLI can turn them on. A per-account lockout needs the Team plan's MFA hook.

## Alternatives considered

- **Check the level only in the pages.** A stolen session could still read the account through the Data API. The policies make the database agree with the pages.
- **Require `aal2` of every account in the policies.** Accounts without an app would lose access: `aal2` needs a factor.
- **A self-service reset by email with a cool-down.** The email account would become enough on its own. The service-role key it needs would also have to live in the website, which holds none.
- **A *recent sign-in* before enrolling, in the page.** A stolen session calls the API directly, so a page check adds friction and no protection.
- **Phone codes.** They need a paid add-on and an SMS provider, and are weaker against SIM swaps.
- **Passkeys as the second factor.** Supabase's WebAuthn factors would fit next. TOTP works in every browser and with apps people already have.

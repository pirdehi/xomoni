# ADR-0011: Email and password sign-in, alongside Google

- Status: Accepted
- Date: 2026-10-31

## Context

Xomoni accounts started as Google-only. Not everyone wants to tie a privacy tool to their Google account, so people need to be able to sign up with an email address and a password, confirm the address, sign in, and recover a forgotten password by email. Opening email sign-up also opens the usual abuse paths: scripted sign-ups, password guessing, using the reset form to learn who has an account, and email bombing through our sender.

## Decision

- **Methods.** Email and password (confirmed address required) and Google, linked automatically when the verified email matches. Supabase Auth is the identity provider; the website's `auth` module wraps it behind the `AuthGateway` port ([ADR-0008](0008-hexagonal-modules-for-the-website.md)).
- **Where calls run.** Interactive auth calls (sign-up, sign-in, reset request, resend, link verification, password and email changes) go from the person's browser straight to Supabase Auth, through the module's browser composition root (`client/auth.ts`). Supabase's per-IP rate limits and the captcha then apply to the person, not to our server's shared IP, and `@supabase/ssr` writes the session cookie the server reads. Session reads, the OAuth callback, sign-out and account deletion run on the server.
- **Email links.** Every emailed link opens `/auth/confirm` on the website, which verifies the one-time token hash only when the person clicks. Links work on any device (no PKCE verifier needed), and mail scanners that open links can't use them up.
- **No account enumeration.** Sign-up, password reset and resend answer the same way whether or not an account exists; sign-in says "email and password don't match" for both a wrong password and an unknown address.
- **Passwords.** At least 10 characters with a letter and a digit (at most 72 bytes); the same rule is in `supabase/config.toml` and the domain code, and a unit test keeps them equal. Changing a password while signed in requires the current password; `secure_password_change` is on.
- **Email change.** Both the old and the new address must confirm.
- **Security notices.** Emails when the password, the email or the sign-in methods change.
- **Abuse protection.** Cloudflare Turnstile on sign-up, password sign-in and reset requests, verified by Supabase. Project-wide email rate limit of 30 per hour.
- **Email delivery.** Resend (personal team, domain `xomoni.com`, DKIM and SPF on `send.xomoni.com`, DMARC published) as Supabase's SMTP server, sending from `no-reply@xomoni.com` with branded templates in `supabase/templates`.

## Consequences

- People can use Xomoni without Google; Google users can add a password with a reset link.
- Auth now depends on two more services (Resend, Turnstile), both on free tiers; they are listed in the privacy policy.
- Leaked-password checks (HaveIBeenPwned) need Supabase Pro and are not enabled.
- The whole flow is tested end to end in CI against a local Supabase with real emails captured by Mailpit (`apps/web/e2e`).

## Alternatives considered

- Google only: excludes people without, or unwilling to use, a Google account.
- Magic links only: no password to forget, but every sign-in needs the inbox, which is awkward in the extension.
- Server Actions calling Supabase: every request would come from Vercel's IPs, so Supabase's per-IP limits would throttle everyone together.

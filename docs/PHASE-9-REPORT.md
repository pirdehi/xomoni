[فارسی](PHASE-9-REPORT.fa.md)

# Phase 9 report: security hardening

> What came of the security review of 2026-11-04: what changed in the extension, on xomoni.com, in the database and in the release pipeline, what is live, what was found along the way, and what is left. None of it uses X's API. The tasks are in [ROADMAP.md](ROADMAP.md#phase-9--security-hardening).
>
> Date: 5 November 2026 · Code: `main` after [#174](https://github.com/pirdehi/xomoni/pull/174)

## Summary

- Nine of the review's ten issues are closed. The tenth, [#148](https://github.com/pirdehi/xomoni/issues/148), is done in code and waits on one dashboard setting the maintainer turns on.
- Every database migration and the production auth settings are live. Each was checked against the production project afterwards.
- Two real bugs surfaced and were fixed: Watch stopped a connected browser's status reports, and some component tests failed whenever the machine was busy.
- One self-inflicted outage: Google sign-in on xomoni.com was broken for a few minutes by a settings push, and restored the same hour (see [Incident](#incident)).

## What changed

| Issue | Change | Pull requests |
| --- | --- | --- |
| [#142](https://github.com/pirdehi/xomoni/issues/142) Release integrity | Read-only build job, actions pinned by SHA, build provenance, protected tags, a reproducible zip. | [#155](https://github.com/pirdehi/xomoni/pull/155), [#157](https://github.com/pirdehi/xomoni/pull/157) |
| [#143](https://github.com/pirdehi/xomoni/issues/143) Extension lockdown | A CSP that reaches only Xomoni's API, no host permissions, no incognito. | [#156](https://github.com/pirdehi/xomoni/pull/156) |
| [#144](https://github.com/pirdehi/xomoni/issues/144) Own posts only | The author is checked before Delete; every id is validated. | [#153](https://github.com/pirdehi/xomoni/pull/153) |
| [#145](https://github.com/pirdehi/xomoni/issues/145) Trusted messages | The service worker hears only Xomoni's content script on x.com and checks every field. The page script can't rewrite what Xomoni reads (built-ins taken at start). Before a delete, the post's id, its stored date and the time X shows must agree, and the text on the page must hold no keep word. A rate-limit reset is believed at most a day ahead. | [#165](https://github.com/pirdehi/xomoni/pull/165) |
| [#146](https://github.com/pirdehi/xomoni/issues/146) Real notices only | X's restriction notices are read only from X's own banners, never from post text. | [#154](https://github.com/pirdehi/xomoni/pull/154) |
| [#147](https://github.com/pirdehi/xomoni/issues/147) xomoni.com headers | Trusted Types, CSP violation reports, tighter image sources, CORP, and an Origin check on sign-out. | [#160](https://github.com/pirdehi/xomoni/pull/160) |
| [#148](https://github.com/pirdehi/xomoni/issues/148) Account security | The current password goes to Supabase with every change. Session cookies last 30 days instead of 400. Two-factor enrollment is off until it has a page ([#173](https://github.com/pirdehi/xomoni/issues/173)). | [#174](https://github.com/pirdehi/xomoni/pull/174) |
| [#149](https://github.com/pirdehi/xomoni/issues/149) Database | Nothing is exposed to the API unless granted by name, and a test checks the whole schema. A job's reason is never stored. Device tokens expire after 90 idle days. Only SSL connections. Live updates are broadcast only on the owner's private channel. Pairing names the account, masked, and nothing is sent until the person confirms it. | [#170](https://github.com/pirdehi/xomoni/pull/170), [#171](https://github.com/pirdehi/xomoni/pull/171), [#172](https://github.com/pirdehi/xomoni/pull/172) |
| [#150](https://github.com/pirdehi/xomoni/issues/150) Monitoring | CodeQL, `security.txt`, and a written alerting plan. Alerts themselves need paid plans ([#161](https://github.com/pirdehi/xomoni/issues/161)). | [#162](https://github.com/pirdehi/xomoni/pull/162) |
| [#151](https://github.com/pirdehi/xomoni/issues/151) Local data | The xomoni.com token is out of the X page's reach. *Delete local data* deletes everything but pacing and risk history. Archive files over 512 MB are refused. Exported pages can't run scripts. A connected browser hears about new versions. | [#166](https://github.com/pirdehi/xomoni/pull/166), [#167](https://github.com/pirdehi/xomoni/pull/167) |

## Live in production

- **Migrations**, each applied with `supabase db push`, then checked with real requests:
  - `extension_releases`: the table and `release_rank` are closed to everyone, and an unknown token is still refused.
  - `database_hardening`: `anon` gets 401 on `devices` and `jobs`.
  - `dashboard_broadcast`.
  - `pairing_shows_account`: a wrong code is refused, and `mask_email` is closed.
- **Settings** with `supabase config push`: SSL enforcement on, two-factor enrollment off.
- **Website**: deployed by Vercel from `main`; the sign-in page and Google sign-in were checked afterwards.
- **The maintainer's browser** runs the extension from `main` (c764d7f).

## Found along the way

- **Watch broke status reports** ([#168](https://github.com/pirdehi/xomoni/issues/168), fixed in [#169](https://github.com/pirdehi/xomoni/pull/169)). A Watch job was reported with a kind the database doesn't allow, so every report was refused and the website stopped showing that browser's jobs. Watch jobs now stay in the browser.
- **Tests failed on a busy machine** ([#163](https://github.com/pirdehi/xomoni/issues/163), fixed in [#164](https://github.com/pirdehi/xomoni/pull/164)). Vitest ran a worker on every core, and dialog tests looked for the page while Fluent still hid it. Now Vitest uses half the cores, and those tests wait for the page.
- **The new schema test found two gaps** that were fixed in the same pull request:
  - a trigger function that anyone could call;
  - new functions callable by everyone by default (a global setting that a per-schema change can't remove).

## Incident

On 5 November 2026 a `supabase config push` ran from a working copy that didn't have `supabase/.env`. It sent Google's client id as the literal text `env(…)`, which broke Google sign-in on xomoni.com for a few minutes. The CLI applied it without asking, because its input wasn't a terminal.

The push was repeated with the right values, and Google's sign-in address was checked until it named the right client again. Turnstile and email settings came back in the same push. From now on, every push loads that file first and is followed by the same check.

## How it was checked

- `npm run verify` before every push: more than 1,000 extension tests and 540 website tests, lint, types, architecture rules, docs and test presence.
- 105 database tests (pgTAP) on a fresh local stack, and the full end-to-end suite (34 tests) locally with the real Supabase services, besides CI on every pull request.
- Live on the maintainer's account: Watch ran with the new message checks, and X's rate limits were still captured from real responses.

## Left open

**For the maintainer**
1. Supabase dashboard → Authentication → Providers → Email → **Require current password when updating** → on. Then try *Forgot password* once. The CLI version the project uses can't set it.
2. Optional: Realtime → **Allow public access** → off. The site no longer uses public channels.
3. GitHub → Settings → Advanced Security: the two secret-scanning options GitHub accepted but left off.

**Needs a paid plan**
- Alerts on sign-in errors and rate limits ([#161](https://github.com/pirdehi/xomoni/issues/161)).
- Supabase's own session limits (Pro). Until then, the 30-day cookies stand in.
- A higher email quota (Resend). Accepted for now in [SECURITY.md](../SECURITY.md).

**Next**
- [#173](https://github.com/pirdehi/xomoni/issues/173): a two-factor sign-in page.
- [#117](https://github.com/pirdehi/xomoni/pull/117) (release 0.2.0) and [#114](https://github.com/pirdehi/xomoni/pull/114) (install page): both need a rebase before merge.

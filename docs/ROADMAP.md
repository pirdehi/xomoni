# Xomoni roadmap

What is done and what is left, phase by phase. Every task links its issue and, once done, the pull request that finished it.

| Where | Link | Language |
| --- | --- | --- |
| Repository roadmap (this page) | [github.com/pirdehi/xomoni · docs/ROADMAP.md](https://github.com/pirdehi/xomoni/blob/main/docs/ROADMAP.md) | English |
| Maintainer's roadmap and checklist (Xomoni on Claude) | [claude.ai · Xomoni roadmap](https://claude.ai/artifact/JEcfuYGBHhSL17oLEtm9a2) | Persian, with the why, steps and exit criteria of every task. Only the maintainer can open it. |
| GitHub milestones | [github.com/pirdehi/xomoni/milestones](https://github.com/pirdehi/xomoni/milestones) | English |

Both roadmaps are updated together: a pull request that finishes a task ticks it here, and the same task is marked done on the Claude roadmap.

**Current focus:** Phase 7 (market readiness), then the rest of Phase 4, Phase 5 and Phase 6.
**Last updated:** 2026-11-02

Legend: ✅ done · 🔄 in progress · ⬜ to do · ⏸ waiting on the maintainer · ✖ dropped

## Phase 0 · xomoni.com live ✅

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Deploy the website from main on Vercel | [#2](https://github.com/pirdehi/xomoni/issues/2) | |
| ✅ | Point xomoni.com at Vercel through Cloudflare DNS | [#3](https://github.com/pirdehi/xomoni/issues/3) | |
| ✅ | Forward privacy@xomoni.com | [#4](https://github.com/pirdehi/xomoni/issues/4) | |
| ✅ | HTTPS on xomoni.com and www | [#5](https://github.com/pirdehi/xomoni/issues/5) | |
| ✅ | Google sign-in | [#6](https://github.com/pirdehi/xomoni/issues/6) | |
| ✅ | End-to-end sign-in test on xomoni.com | [#7](https://github.com/pirdehi/xomoni/issues/7) | |
| ✅ | Email and password accounts | | [#56](https://github.com/pirdehi/xomoni/pull/56) |
| ✅ | Recover forms when the Turnstile check does not finish | | [#62](https://github.com/pirdehi/xomoni/pull/62) |

## Phase 1 · Engineering foundation ✅

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Monorepo: `apps/` and `packages/` | [#10](https://github.com/pirdehi/xomoni/issues/10) | [#49](https://github.com/pirdehi/xomoni/pull/49) |
| ✅ | Architecture docs and ADRs | [#12](https://github.com/pirdehi/xomoni/issues/12) | [#49](https://github.com/pirdehi/xomoni/pull/49) |
| ✅ | Row Level Security tests in CI | [#13](https://github.com/pirdehi/xomoni/issues/13) | [#49](https://github.com/pirdehi/xomoni/pull/49) |
| ✅ | Protect main and standardize pull requests | [#14](https://github.com/pirdehi/xomoni/issues/14) | [#49](https://github.com/pirdehi/xomoni/pull/49) |

## Phase 2 · Safety before real accounts ✅

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Find old posts that X search no longer shows | [#15](https://github.com/pirdehi/xomoni/issues/15) | [#73](https://github.com/pirdehi/xomoni/pull/73) |
| ✅ | Retry search after a 429 instead of abandoning it | [#16](https://github.com/pirdehi/xomoni/issues/16) | [#66](https://github.com/pirdehi/xomoni/pull/66) |
| ✅ | Risk ladder: back off a step earlier than X does | [#17](https://github.com/pirdehi/xomoni/issues/17) | [#65](https://github.com/pirdehi/xomoni/pull/65) |
| ✅ | Stop at once on suspension, restriction or refused writes | [#18](https://github.com/pirdehi/xomoni/issues/18) | [#64](https://github.com/pirdehi/xomoni/pull/64) |
| ✅ | Warm up daily caps over the first days | [#19](https://github.com/pirdehi/xomoni/issues/19) | [#63](https://github.com/pirdehi/xomoni/pull/63) |
| ✅ | Recognize X's new login and verification routes | [#20](https://github.com/pirdehi/xomoni/issues/20) | [#64](https://github.com/pirdehi/xomoni/pull/64) |
| ✅ | Canary check before the first delete of every job | [#21](https://github.com/pirdehi/xomoni/issues/21) | [#69](https://github.com/pirdehi/xomoni/pull/69) |
| ✅ | Verify a sample of deletions to catch silent blocks | [#22](https://github.com/pirdehi/xomoni/issues/22) | [#70](https://github.com/pirdehi/xomoni/pull/70) |
| ✅ | Survive tab discards, offline periods and X outages | [#23](https://github.com/pirdehi/xomoni/issues/23) | [#67](https://github.com/pirdehi/xomoni/pull/67) |
| ✅ | Informed consent before the first job | [#24](https://github.com/pirdehi/xomoni/issues/24) | [#72](https://github.com/pirdehi/xomoni/pull/72) |
| ✅ | Account health report after every job | [#25](https://github.com/pirdehi/xomoni/issues/25) | [#71](https://github.com/pirdehi/xomoni/pull/71) |
| ✅ | Caps: one fifth of every limit X announces ([ADR-0012](adr/0012-one-fifth-of-every-x-limit.md)) | [#26](https://github.com/pirdehi/xomoni/issues/26) | [#63](https://github.com/pirdehi/xomoni/pull/63) |
| ✅ | Page loads must not ease the slowdown | [#57](https://github.com/pirdehi/xomoni/issues/57) | [#63](https://github.com/pirdehi/xomoni/pull/63) |
| ✅ | Reject unsafe custom pacing values | [#58](https://github.com/pirdehi/xomoni/issues/58) | [#63](https://github.com/pirdehi/xomoni/pull/63) |
| ✅ | A forged page message can't mark a delete as done | [#59](https://github.com/pirdehi/xomoni/issues/59) | [#74](https://github.com/pirdehi/xomoni/pull/74) |
| ✅ | Engine robustness: slow pages, empty profile fields, request bodies | [#60](https://github.com/pirdehi/xomoni/issues/60) | [#68](https://github.com/pirdehi/xomoni/pull/68) |

## Phase 3 · Website and cloud

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Security headers for xomoni.com | [#8](https://github.com/pirdehi/xomoni/issues/8) | [#76](https://github.com/pirdehi/xomoni/pull/76) |
| ✅ | Risk level and *Needs you* on the website dashboard | [#41](https://github.com/pirdehi/xomoni/issues/41) | [#77](https://github.com/pirdehi/xomoni/pull/77) |
| ✅ | Security review of the sync surface | [#42](https://github.com/pirdehi/xomoni/issues/42) | [#84](https://github.com/pirdehi/xomoni/pull/84) |
| ✅ | Security policy and vulnerability reporting | [#46](https://github.com/pirdehi/xomoni/issues/46) | |
| ✅ | Auth forms no longer blame the connection while Turnstile waits | [#78](https://github.com/pirdehi/xomoni/issues/78) | [#79](https://github.com/pirdehi/xomoni/pull/79) |
| ✅ | Delete the account only after a recent sign-in | [#80](https://github.com/pirdehi/xomoni/issues/80) | [#85](https://github.com/pirdehi/xomoni/pull/85) |
| ✅ | Cap devices and jobs per account | [#82](https://github.com/pirdehi/xomoni/issues/82) | [#88](https://github.com/pirdehi/xomoni/pull/88) |
| ✅ | Sign out of every session | [#83](https://github.com/pirdehi/xomoni/issues/83) | [#87](https://github.com/pirdehi/xomoni/pull/87) |
| ⏸ | Realtime channel private to each user (code merged; the maintainer turns off public access in Supabase) | [#81](https://github.com/pirdehi/xomoni/issues/81) | [#89](https://github.com/pirdehi/xomoni/pull/89) |
| ⏸ | Google brand verification, so the consent screen says Xomoni | [#9](https://github.com/pirdehi/xomoni/issues/9) | |

## Phase 4 · Extension: real-account pilot

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Handle dialogs that cover X's page | [#29](https://github.com/pirdehi/xomoni/issues/29) | [#95](https://github.com/pirdehi/xomoni/pull/95) |
| ✅ | Spread work into sessions with breaks | [#30](https://github.com/pirdehi/xomoni/issues/30) | [#94](https://github.com/pirdehi/xomoni/pull/94) |
| ✅ | Correct for system clock skew | [#31](https://github.com/pirdehi/xomoni/issues/31) | [#96](https://github.com/pirdehi/xomoni/pull/96) |
| ✅ | Archive a date range | [#97](https://github.com/pirdehi/xomoni/issues/97) | [#98](https://github.com/pirdehi/xomoni/pull/98) |
| 🔄 | Pilot on the maintainer's own account | [#27](https://github.com/pirdehi/xomoni/issues/27) | |
| ⬜ | Count unavailable originals as skipped | [#32](https://github.com/pirdehi/xomoni/issues/32) | |
| ⬜ | Export the activity log | [#34](https://github.com/pirdehi/xomoni/issues/34) | |
| ⬜ | Separate defaults for Premium accounts | [#33](https://github.com/pirdehi/xomoni/issues/33) | |
| ⬜ | Learn the daily read limit per account | [#28](https://github.com/pirdehi/xomoni/issues/28) | |
| ⬜ | Small extension fixes from the documentation pass | [#61](https://github.com/pirdehi/xomoni/issues/61) | |

## Phase 5 · Extension: cloud sync

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ⬜ | Sign in from the extension | [#38](https://github.com/pirdehi/xomoni/issues/38) | |
| ⬜ | Register devices and send heartbeats | [#39](https://github.com/pirdehi/xomoni/issues/39) | |
| ⬜ | Sync job summaries (status only) | [#40](https://github.com/pirdehi/xomoni/issues/40) | |

## Phase 6 · Public release

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ⬜ | Release process | [#45](https://github.com/pirdehi/xomoni/issues/45) | |
| ⬜ | Real install link on xomoni.com | [#44](https://github.com/pirdehi/xomoni/issues/44) | |
| ⏸ | Chrome Web Store listing (put off by the maintainer for now) | [#43](https://github.com/pirdehi/xomoni/issues/43) | |

## Phase 7 · Market readiness

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Roadmap in the repository, linked to the maintainer's roadmap | [#99](https://github.com/pirdehi/xomoni/issues/99) | [#103](https://github.com/pirdehi/xomoni/pull/103) |
| ✅ | Name the architecture: styles, principles and patterns ([ADR-0015](adr/0015-architecture-styles-principles-and-patterns.md)) | [#100](https://github.com/pirdehi/xomoni/issues/100) | [#104](https://github.com/pirdehi/xomoni/pull/104) |
| ⬜ | Strictest TypeScript settings and type-aware lint in every workspace | [#101](https://github.com/pirdehi/xomoni/issues/101) | |
| ⬜ | Test standard: backend and frontend tests for every feature, enforced | [#102](https://github.com/pirdehi/xomoni/issues/102) | |
| ⬜ | Extension core behind ports; layer rules enforced in CI | [#11](https://github.com/pirdehi/xomoni/issues/11) | |

## Dropped

| | Task | Issue | Why |
| --- | --- | --- | --- |
| ✖ | Assisted mode: the person clicks every delete | [#35](https://github.com/pirdehi/xomoni/issues/35) | Automatic mode only, at one fifth of X's limits (decision of 2026-11-01). |
| ✖ | Official API mode | [#36](https://github.com/pirdehi/xomoni/issues/36) | Same decision. |
| ✖ | Mode chooser and risk explainer | [#37](https://github.com/pirdehi/xomoni/issues/37) | No modes left to choose between. |
| ✖ | Techniques that hide automation from X | [#47](https://github.com/pirdehi/xomoni/issues/47) | Never: [ADR-0003](adr/0003-no-credentials-no-evasion.md). |

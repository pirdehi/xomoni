# Xomoni roadmap

What is done and what is left, phase by phase. Every task links its issue and, once done, the pull request that finished it.

| Where | Link | Language |
| --- | --- | --- |
| Repository roadmap (this page) | [github.com/pirdehi/xomoni · docs/ROADMAP.md](https://github.com/pirdehi/xomoni/blob/main/docs/ROADMAP.md) | English |
| Maintainer's roadmap and checklist (Xomoni on Claude) | [claude.ai · Xomoni roadmap](https://claude.ai/artifact/JEcfuYGBHhSL17oLEtm9a2) | Persian, with the why, steps and exit criteria of every task. Only the maintainer can open it. |
| GitHub milestones | [github.com/pirdehi/xomoni/milestones](https://github.com/pirdehi/xomoni/milestones) | English |

Both roadmaps are updated together: a pull request that finishes a task ticks it here, and the same task is marked done on the Claude roadmap.

**Current focus:**
- Phase 12, a simpler dashboard ([UX review](UX-REVIEW-2026-11-14.md)).
- Phase 11, where asking X for the archive works on the real page and the download waits for X ([report](PHASE-11-REPORT.md)).
- Phase 4, the pilot on the maintainer's account.
- Phase 6, the first release (v0.2.0, waiting for the maintainer's go).

**Last updated:** 2026-11-14 · Status report: [English](STATUS-2026-11-14.md) · [فارسی](STATUS-2026-11-14.fa.md)

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
| ✅ | Count unavailable originals as skipped | [#32](https://github.com/pirdehi/xomoni/issues/32) | [#109](https://github.com/pirdehi/xomoni/pull/109) |
| ✅ | Export the activity log | [#34](https://github.com/pirdehi/xomoni/issues/34) | [#107](https://github.com/pirdehi/xomoni/pull/107) |
| ✅ | Separate defaults for Premium accounts | [#33](https://github.com/pirdehi/xomoni/issues/33) | [#110](https://github.com/pirdehi/xomoni/pull/110) |
| ✅ | Learn the daily read limit per account | [#28](https://github.com/pirdehi/xomoni/issues/28) | [#111](https://github.com/pirdehi/xomoni/pull/111) |
| ✅ | Small extension fixes from the documentation pass | [#61](https://github.com/pirdehi/xomoni/issues/61) | [#108](https://github.com/pirdehi/xomoni/pull/108) |
| ✅ | Wait for a hidden X window instead of stopping as "X changed its page" (found in the pilot) | [#118](https://github.com/pirdehi/xomoni/issues/118) | [#119](https://github.com/pirdehi/xomoni/pull/119) |
| ✅ | Close X's menus with Escape from inside them, and click the options X shows now, not ones it replaced (found in the pilot) | [#121](https://github.com/pirdehi/xomoni/issues/121) | [#122](https://github.com/pirdehi/xomoni/pull/122) |
| ✅ | Open the X worker window on screen, not hidden behind the dashboard | [#120](https://github.com/pirdehi/xomoni/issues/120) | [#133](https://github.com/pirdehi/xomoni/pull/133) |
| ✅ | Keep a job going while the person is away: display kept on, a covered X window brought forward when idle | [#134](https://github.com/pirdehi/xomoni/issues/134) | [#135](https://github.com/pirdehi/xomoni/pull/135) |
| ✅ | Let the display sleep when the dashboard closes in the middle of a job | [#136](https://github.com/pirdehi/xomoni/issues/136) | [#137](https://github.com/pirdehi/xomoni/pull/137) |
| ✅ | Open the X window small, in a corner, as a window without tabs | [#138](https://github.com/pirdehi/xomoni/issues/138) | [#139](https://github.com/pirdehi/xomoni/pull/139) |
| ✅ | Run hidden: share the X tab with the dashboard, so a job keeps going with the X window minimized | [#140](https://github.com/pirdehi/xomoni/issues/140) | [#141](https://github.com/pirdehi/xomoni/pull/141) |

## Phase 5 · Extension: cloud sync ✅

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Connect the extension with a one-time code ([ADR-0018](adr/0018-pair-the-extension-with-a-one-time-code.md)) | [#38](https://github.com/pirdehi/xomoni/issues/38) | [#112](https://github.com/pirdehi/xomoni/pull/112) |
| ✅ | Register devices and send heartbeats | [#39](https://github.com/pirdehi/xomoni/issues/39) | [#112](https://github.com/pirdehi/xomoni/pull/112) |
| ✅ | Sync job summaries (status only) | [#40](https://github.com/pirdehi/xomoni/issues/40) | [#112](https://github.com/pirdehi/xomoni/pull/112) |

## Phase 6 · Public release

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Release process ([releasing](RELEASING.md), [changelog](../CHANGELOG.md)) | [#45](https://github.com/pirdehi/xomoni/issues/45) | [#113](https://github.com/pirdehi/xomoni/pull/113) |
| ⬜ | Real install link on xomoni.com | [#44](https://github.com/pirdehi/xomoni/issues/44) | |
| ⏸ | Chrome Web Store listing (put off by the maintainer for now) | [#43](https://github.com/pirdehi/xomoni/issues/43) | |

## Phase 7 · Market readiness ✅

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Roadmap in the repository, linked to the maintainer's roadmap | [#99](https://github.com/pirdehi/xomoni/issues/99) | [#103](https://github.com/pirdehi/xomoni/pull/103) |
| ✅ | Name the architecture: styles, principles and patterns ([ADR-0015](adr/0015-architecture-styles-principles-and-patterns.md)) | [#100](https://github.com/pirdehi/xomoni/issues/100) | [#104](https://github.com/pirdehi/xomoni/pull/104) |
| ✅ | Strictest TypeScript settings and type-aware lint in every workspace ([ADR-0016](adr/0016-strict-typescript-and-type-aware-lint.md)) | [#101](https://github.com/pirdehi/xomoni/issues/101) | [#105](https://github.com/pirdehi/xomoni/pull/105) |
| ✅ | Test standard: backend and frontend tests for every feature, enforced ([ADR-0017](adr/0017-test-standard.md), [testing](TESTING.md)) | [#102](https://github.com/pirdehi/xomoni/issues/102) | [#106](https://github.com/pirdehi/xomoni/pull/106) |
| ✅ | Extension core behind ports; layer rules enforced in CI | [#11](https://github.com/pirdehi/xomoni/issues/11) | [#115](https://github.com/pirdehi/xomoni/pull/115) |

## Phase 8 · Fluent UI everywhere ✅

Every interface on Fluent UI React v9, and no Tailwind ([ADR-0019](adr/0019-fluent-ui-everywhere.md)).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | ADR-0019, Fluent foundation in the extension, and a redesigned job card | [#123](https://github.com/pirdehi/xomoni/issues/123) | [#124](https://github.com/pirdehi/xomoni/pull/124) |
| ✅ | The rest of the extension dashboard on Fluent; Tailwind removed from the extension | [#123](https://github.com/pirdehi/xomoni/issues/123) | [#126](https://github.com/pirdehi/xomoni/pull/126) |
| ✅ | xomoni.com: Fluent with server-rendered styles in Next.js; Xomoni's themes shared by both apps (`@xomoni/fluent-theme`) | [#123](https://github.com/pirdehi/xomoni/issues/123) | [#127](https://github.com/pirdehi/xomoni/pull/127) |
| ✅ | xomoni.com: redesign the home page and every public page with Fluent | [#123](https://github.com/pirdehi/xomoni/issues/123) | [#128](https://github.com/pirdehi/xomoni/pull/128) |
| ✅ | xomoni.com: sign-in, account and dashboard pages on Fluent; Tailwind removed from the website | [#123](https://github.com/pirdehi/xomoni/issues/123) | [#129](https://github.com/pirdehi/xomoni/pull/129) |

## Phase 9 · Security hardening

From the security review of 2026-11-04 of the extension, xomoni.com, the database and the release pipeline. None of it needs X's API. Release integrity comes first, before the first tag.

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Release integrity: read-only build job, pinned actions, provenance, protected tags, reproducible zip (before the first tag) | [#142](https://github.com/pirdehi/xomoni/issues/142) | [#155](https://github.com/pirdehi/xomoni/pull/155) |
| ✅ | Extension CSP and manifest: network only to Xomoni's API, no incognito, no outside messages | [#143](https://github.com/pirdehi/xomoni/issues/143) | [#156](https://github.com/pirdehi/xomoni/pull/156) |
| ✅ | Never act on someone else's post: author checked before Delete, every id validated | [#144](https://github.com/pirdehi/xomoni/issues/144) | [#153](https://github.com/pirdehi/xomoni/pull/153) |
| ✅ | Trust only Xomoni's own messages: sender checks, payload validation, a sealed page-world channel | [#145](https://github.com/pirdehi/xomoni/issues/145) | [#165](https://github.com/pirdehi/xomoni/pull/165) |
| ✅ | Read X's restriction notices only from X's own banners, not from post text | [#146](https://github.com/pirdehi/xomoni/issues/146) | [#154](https://github.com/pirdehi/xomoni/pull/154) |
| ✅ | xomoni.com: Trusted Types, CSP reports, tighter images, CORP, Origin check on sign-out | [#147](https://github.com/pirdehi/xomoni/issues/147) | [#160](https://github.com/pirdehi/xomoni/pull/160) |
| ⬜ | Account security: current password checked by the server, MFA, session age, email quota | [#148](https://github.com/pirdehi/xomoni/issues/148) | |
| ✅ | Database: private Realtime, no auto-exposed tables, SSL only, expiring device tokens, account shown on pairing | [#149](https://github.com/pirdehi/xomoni/issues/149) | [#170](https://github.com/pirdehi/xomoni/pull/170), [#171](https://github.com/pirdehi/xomoni/pull/171), [#172](https://github.com/pirdehi/xomoni/pull/172) |
| ✅ | Security monitoring: CodeQL, secret-scanning options, security.txt, alerts (alerts need paid plans: [#161](https://github.com/pirdehi/xomoni/issues/161)) | [#150](https://github.com/pirdehi/xomoni/issues/150) | [#162](https://github.com/pirdehi/xomoni/pull/162) |
| ✅ | Local data hygiene: token storage, complete wipe, archive size limits, update notice | [#151](https://github.com/pirdehi/xomoni/issues/151) | [#166](https://github.com/pirdehi/xomoni/pull/166), [#167](https://github.com/pirdehi/xomoni/pull/167) |

## Phase 10 · Watch

Following phrases and #hashtags in X's search, read-only ([ADR-0021](adr/0021-watch-x-search-read-only.md)).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Watch page: up to 5 tabs of phrases or #hashtags, searched about once a minute within the read budget, newest 10 posts each | [#158](https://github.com/pirdehi/xomoni/issues/158) | [#159](https://github.com/pirdehi/xomoni/pull/159) |

## Phase 11 · The X archive without the chores

Getting X's archive into Xomoni took more than ten steps by hand. This phase brings them down to one press and the password X asks for, typed on X. The Archive and Inventory pages become one place. Report: [English](PHASE-11-REPORT.md) · [فارسی](PHASE-11-REPORT.fa.md).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Import the ZIP X sends as it is: no unzipping; only the files Xomoni needs are read, and photos and videos never are | [#184](https://github.com/pirdehi/xomoni/issues/184) | [#188](https://github.com/pirdehi/xomoni/pull/188) |
| ✅ | One Library page instead of Archive and Inventory: how complete the copy is, one action to complete it, *Download a copy* with dates chosen at download time | [#185](https://github.com/pirdehi/xomoni/issues/185) | [#189](https://github.com/pirdehi/xomoni/pull/189) |
| ⏸ | Get X's archive as a job through X's own settings page: request, wait, notify, download; the password is typed on X only. Checked live on 13 and 14 November: asking X works on the real page; the download and the import wait for X to make the archive (1 to 3 days) | [#186](https://github.com/pirdehi/xomoni/issues/186) | [#191](https://github.com/pirdehi/xomoni/pull/191) |
| ✅ | Import the downloaded archive by itself from the Downloads folder, with one click as the fallback. Chrome refuses Downloads itself, so X's archive is saved in Downloads › Xomoni (#196) | [#187](https://github.com/pirdehi/xomoni/issues/187), [#196](https://github.com/pirdehi/xomoni/issues/196) | [#190](https://github.com/pirdehi/xomoni/pull/190), [#197](https://github.com/pirdehi/xomoni/pull/197) |

## Phase 12 · A simpler dashboard

A UX review of the whole dashboard found more places than tasks, numbers without a next step, expert settings up front and engine words in the interface. This phase brings each page down to one primary action, in plain words, with a modern look; every number and setting stays reachable. Review: [English](UX-REVIEW-2026-11-14.md) · [فارسی](UX-REVIEW-2026-11-14.fa.md).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Settings: presets first, the pacing table only under Custom | [#198](https://github.com/pirdehi/xomoni/issues/198) | [#209](https://github.com/pirdehi/xomoni/pull/209) |
| ⬜ | Cleanup in three questions; *How to find them* under Advanced | [#199](https://github.com/pirdehi/xomoni/issues/199) | |
| ⬜ | A banner on every page when X needs you | [#200](https://github.com/pirdehi/xomoni/issues/200) | |
| ⬜ | Home: one status, one next step, a first-run checklist | [#201](https://github.com/pirdehi/xomoni/issues/201) | |
| ⬜ | Jobs and Activity log in one Activity page | [#202](https://github.com/pirdehi/xomoni/issues/202) | |
| ⬜ | Library: one card for your copy | [#203](https://github.com/pirdehi/xomoni/issues/203) | |
| ⬜ | An Activity log grouped and readable | [#204](https://github.com/pirdehi/xomoni/issues/204) | |
| ⬜ | Plain words across the dashboard | [#205](https://github.com/pirdehi/xomoni/issues/205) | |
| ⬜ | One set of numbers | [#206](https://github.com/pirdehi/xomoni/issues/206) | |
| ⬜ | A modern look, light and dark | [#207](https://github.com/pirdehi/xomoni/issues/207) | |

## Dropped

| | Task | Issue | Why |
| --- | --- | --- | --- |
| ✖ | Assisted mode: the person clicks every delete | [#35](https://github.com/pirdehi/xomoni/issues/35) | Automatic mode only, at one fifth of X's limits (decision of 2026-11-01). |
| ✖ | Official API mode | [#36](https://github.com/pirdehi/xomoni/issues/36) | Same decision. |
| ✖ | Mode chooser and risk explainer | [#37](https://github.com/pirdehi/xomoni/issues/37) | No modes left to choose between. |
| ✖ | Techniques that hide automation from X | [#47](https://github.com/pirdehi/xomoni/issues/47) | Never: [ADR-0003](adr/0003-no-credentials-no-evasion.md). |

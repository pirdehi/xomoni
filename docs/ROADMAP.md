# Xomoni roadmap

What is done and what is left, phase by phase. Every task links its issue and, once done, the pull request that finished it.

| Where | Link | Language |
| --- | --- | --- |
| Repository roadmap (this page) | [github.com/pirdehi/xomoni · docs/ROADMAP.md](https://github.com/pirdehi/xomoni/blob/main/docs/ROADMAP.md) | English |
| Maintainer's roadmap and checklist (Xomoni on Claude) | [claude.ai · Xomoni roadmap](https://claude.ai/artifact/JEcfuYGBHhSL17oLEtm9a2) | Persian, with the why, steps and exit criteria of every task. Only the maintainer can open it. |
| GitHub milestones | [github.com/pirdehi/xomoni/milestones](https://github.com/pirdehi/xomoni/milestones) | English |

Both roadmaps are updated together: a pull request that finishes a task ticks it here, and the same task is marked done on the Claude roadmap.

**Current focus:**
- Phase 20: R1, the first paid release (0.6.0, [milestone](https://github.com/pirdehi/xomoni/milestone/12)). It brings payments with Polar, with only the plan kept in the cloud ([ADR-0042](adr/0042-payments-and-entitlements-with-polar.md)), and the vault: X's official files kept on the computer, with an open export ([ADR-0043](adr/0043-the-vault-x-files-kept-on-the-computer.md), [ADR-0044](adr/0044-an-open-export-of-the-vault.md)). Reach diagnosis comes from those files, with guesses labelled as guesses, and so does a public digest of X's ranking code ([ADR-0045](adr/0045-reach-diagnosis-guesses-labelled-as-guesses.md), [ADR-0046](adr/0046-a-public-digest-of-xs-open-ranking-code.md)). Nothing in it scrolls, navigates, clicks or watches X on its own. The five decisions are in. Next, side by side: the billing tables (#420), the vault's tables and importer (#424), and each post's links and media (#428).
- Phase 19: one written gate for every merge and every release ([quality gates](QUALITY-GATES.md), ADR-0037 to ADR-0039). The rules, the release checklist and the protected `release` and `stores` environments are in, and so is the release gate (#340): the full CI on the tag, `npm audit`, and the release issue read by the workflow and closed with the release. So are the nightly run of the whole suite on `main` and the check of each published release (#343). The checks that enforce the rest come next: the README from a feature registry (#337), at least 20 user scenarios per user-facing task (#338), the pull request policy and dependency review (#339) and clean code scanning (#341).
- Phase 18: install with one click from the Chrome Web Store and Edge Add-ons, with a data move and one-click updates for the zip ([project](reports/2026-11/INSTALL-PROJECT-2026-11-21.fa.md), #295). Everything that needs no store account is built: the data move (#310), the simpler /install with illustrations (#308, #330), the install FAQ (#311), readiness for the stores (#309, #320, #321, #326), the fixed id (#324), store uploads (#314), one button per browser (#325) and signed one-click updates (#316). What's left is the maintainer's: the store accounts ([guide](guides/STORE-ACCOUNTS-GUIDE.fa.md)), the signing key, release 0.5.0, submitting, and making the listings public.
- Phase 17: the full dashboard on xomoni.com ([plan](reports/2026-11/DASHBOARD-PLAN-2026-11-19.md)). The shell (#245) and the extension's actions with the dialog when Xomoni isn't there (#251) are done; daily numbers (#249, #250), release 0.3.0 (#260), Overview, Audience, Content and Engagement with real numbers (#252–#255), the Library, Watch and account health read from Xomoni (#233), Settings (#234), Cleanup (#235) and Comments (#256) are done too. Release 0.4.0 (#282) brought the first of them to Xomoni; Comments needs the next release. Reports (#257) are in, as CSV and PDF, with a weekly email for those who ask for it. Phase 17 is done, and so are the phone menu and footer (#242) and getting started (#244): all of the next 20 tasks are done. Next: release 0.5.0, which brings Comments and /welcome to Xomoni, once the maintainer says so. The next 20 tasks, in order: [فارسی](reports/2026-11/NEXT-20-TASKS-2026-11-20.fa.md).
- Phase 15: a UX pass of xomoni.com and the extension (#239, #240), before the extension's pages come to the website (#233).
- Phase 14: one Xomoni. The website and the extension sign in and out together (#232), and the website shows the Library, Watch and account health, read in the same browser only (#233), changes Xomoni's settings there within its safety rules (#234), and plans cleanups that start only in Xomoni (#235). Phase 14 is done.
- Phase 13: signing out of Xomoni and one-click connecting are done; one-click install waits for the Chrome Web Store (#43).
- Phase 12, a simpler dashboard, is done ([UX review](reports/2026-11/UX-REVIEW-2026-11-14.md)).
- Phase 11, where asking X for the archive works on the real page and the download waits for X ([report](reports/2026-11/PHASE-11-REPORT.md)).
- Phase 4, the pilot on the maintainer's account.
- Phase 6: 0.4.0 is out on [GitHub Releases](https://github.com/pirdehi/xomoni/releases), with an install guide at [xomoni.com/install](https://xomoni.com/install); the Chrome Web Store waits for the maintainer.

**Last updated:** 2026-11-23 · One-click install, the project: [فارسی](reports/2026-11/INSTALL-PROJECT-2026-11-21.fa.md) · Making installs easier, options: [فارسی](reports/2026-11/INSTALL-UX-2026-11-21.fa.md) · Next 20 tasks: [فارسی](reports/2026-11/NEXT-20-TASKS-2026-11-20.fa.md) · Moving the backend to Rust, an analysis: [فارسی](reports/2026-11/RUST-BACKEND-ANALYSIS-2026-11-20.fa.md) · Dashboard plan: [English](reports/2026-11/DASHBOARD-PLAN-2026-11-19.md) · [فارسی](reports/2026-11/DASHBOARD-PLAN-2026-11-19.fa.md) · Website UX review: [English](reports/2026-11/UX-REVIEW-WEBSITE-2026-11-17.md) · [فارسی](reports/2026-11/UX-REVIEW-WEBSITE-2026-11-17.fa.md) · Status report: [English](reports/2026-11/STATUS-2026-11-14.md) · [فارسی](reports/2026-11/STATUS-2026-11-14.fa.md) · Product report: [فارسی](reports/2026-11/PRODUCT-REPORT-2026-11-14.fa.md)

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
| ✅ | Realtime channel private to each user; public access to channels off in Supabase since 14 November | [#81](https://github.com/pirdehi/xomoni/issues/81) | [#89](https://github.com/pirdehi/xomoni/pull/89) |
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
| ✅ | First release, 0.2.0, on [GitHub Releases](https://github.com/pirdehi/xomoni/releases) | | [#117](https://github.com/pirdehi/xomoni/pull/117) |
| ✅ | Real install link on xomoni.com ([/install](https://xomoni.com/install)) | [#44](https://github.com/pirdehi/xomoni/issues/44) | [#114](https://github.com/pirdehi/xomoni/pull/114) |
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

From the security review of 2026-11-04 of the extension, xomoni.com, the database and the release pipeline. None of it needs X's API. Release integrity comes first, before the first tag. What came of it: [report](reports/2026-11/PHASE-9-REPORT.md) · [فارسی](reports/2026-11/PHASE-9-REPORT.fa.md).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Release integrity: read-only build job, pinned actions, provenance, protected tags, reproducible zip (before the first tag) | [#142](https://github.com/pirdehi/xomoni/issues/142) | [#155](https://github.com/pirdehi/xomoni/pull/155) |
| ✅ | Extension CSP and manifest: network only to Xomoni's API, no incognito, no outside messages | [#143](https://github.com/pirdehi/xomoni/issues/143) | [#156](https://github.com/pirdehi/xomoni/pull/156) |
| ✅ | Never act on someone else's post: author checked before Delete, every id validated | [#144](https://github.com/pirdehi/xomoni/issues/144) | [#153](https://github.com/pirdehi/xomoni/pull/153) |
| ✅ | Trust only Xomoni's own messages: sender checks, payload validation, a sealed page-world channel | [#145](https://github.com/pirdehi/xomoni/issues/145) | [#165](https://github.com/pirdehi/xomoni/pull/165) |
| ✅ | Read X's restriction notices only from X's own banners, not from post text | [#146](https://github.com/pirdehi/xomoni/issues/146) | [#154](https://github.com/pirdehi/xomoni/pull/154) |
| ✅ | xomoni.com: Trusted Types, CSP reports, tighter images, CORP, Origin check on sign-out | [#147](https://github.com/pirdehi/xomoni/issues/147) | [#160](https://github.com/pirdehi/xomoni/pull/160) |
| 🔄 | Account security: current password checked by the server (on since 14 November) and two-step verification with an authenticator app, required by the server and the database ([#173](https://github.com/pirdehi/xomoni/issues/173), [ADR-0036](adr/0036-two-step-verification-with-an-authenticator-app.md)) done; session age and email quota wait on paid plans | [#148](https://github.com/pirdehi/xomoni/issues/148) | [#174](https://github.com/pirdehi/xomoni/pull/174), [#335](https://github.com/pirdehi/xomoni/pull/335) |
| ✅ | Database: private Realtime, no auto-exposed tables, SSL only, expiring device tokens, account shown on pairing | [#149](https://github.com/pirdehi/xomoni/issues/149) | [#170](https://github.com/pirdehi/xomoni/pull/170), [#171](https://github.com/pirdehi/xomoni/pull/171), [#172](https://github.com/pirdehi/xomoni/pull/172) |
| ✅ | Security monitoring: CodeQL, secret-scanning options, security.txt, alerts (alerts need paid plans: [#161](https://github.com/pirdehi/xomoni/issues/161)) | [#150](https://github.com/pirdehi/xomoni/issues/150) | [#162](https://github.com/pirdehi/xomoni/pull/162) |
| ✅ | Local data hygiene: token storage, complete wipe, archive size limits, update notice | [#151](https://github.com/pirdehi/xomoni/issues/151) | [#166](https://github.com/pirdehi/xomoni/pull/166), [#167](https://github.com/pirdehi/xomoni/pull/167) |

## Phase 10 · Watch

Following phrases and #hashtags in X's search, read-only ([ADR-0021](adr/0021-watch-x-search-read-only.md)).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Watch page: up to 5 tabs of phrases or #hashtags, searched about once a minute within the read budget, newest 10 posts each | [#158](https://github.com/pirdehi/xomoni/issues/158) | [#159](https://github.com/pirdehi/xomoni/pull/159) |

## Phase 11 · The X archive without the chores

Getting X's archive into Xomoni took more than ten steps by hand. This phase brings them down to one press and the password X asks for, typed on X. The Archive and Inventory pages become one place. Report: [English](reports/2026-11/PHASE-11-REPORT.md) · [فارسی](reports/2026-11/PHASE-11-REPORT.fa.md).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Import the ZIP X sends as it is: no unzipping; only the files Xomoni needs are read, and photos and videos never are | [#184](https://github.com/pirdehi/xomoni/issues/184) | [#188](https://github.com/pirdehi/xomoni/pull/188) |
| ✅ | One Library page instead of Archive and Inventory: how complete the copy is, one action to complete it, *Download a copy* with dates chosen at download time | [#185](https://github.com/pirdehi/xomoni/issues/185) | [#189](https://github.com/pirdehi/xomoni/pull/189) |
| ⏸ | Get X's archive as a job through X's own settings page: request, wait, notify, download; the password is typed on X only. Checked live on 13 and 14 November: asking X works on the real page; the download and the import wait for X to make the archive (1 to 3 days) | [#186](https://github.com/pirdehi/xomoni/issues/186) | [#191](https://github.com/pirdehi/xomoni/pull/191) |
| ✅ | Import the downloaded archive by itself from the Downloads folder, with one click as the fallback. Chrome refuses Downloads itself, so X's archive is saved in Downloads › Xomoni (#196) | [#187](https://github.com/pirdehi/xomoni/issues/187), [#196](https://github.com/pirdehi/xomoni/issues/196) | [#190](https://github.com/pirdehi/xomoni/pull/190), [#197](https://github.com/pirdehi/xomoni/pull/197) |

## Phase 12 · A simpler dashboard ✅

A UX review of the whole dashboard found more places than tasks, numbers without a next step, expert settings up front and engine words in the interface. This phase brings each page down to one primary action, in plain words, with a modern look; every number and setting stays reachable. Review: [English](reports/2026-11/UX-REVIEW-2026-11-14.md) · [فارسی](reports/2026-11/UX-REVIEW-2026-11-14.fa.md).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Settings: presets first, the pacing table only under Custom | [#198](https://github.com/pirdehi/xomoni/issues/198) | [#209](https://github.com/pirdehi/xomoni/pull/209) |
| ✅ | Cleanup in three questions; *How to find them* under Advanced | [#199](https://github.com/pirdehi/xomoni/issues/199) | [#210](https://github.com/pirdehi/xomoni/pull/210) |
| ✅ | A banner on every page when X needs you | [#200](https://github.com/pirdehi/xomoni/issues/200) | [#211](https://github.com/pirdehi/xomoni/pull/211) |
| ✅ | Home: one status, one next step, a first-run checklist | [#201](https://github.com/pirdehi/xomoni/issues/201) | [#212](https://github.com/pirdehi/xomoni/pull/212) |
| ✅ | Jobs and Activity log in one Activity page | [#202](https://github.com/pirdehi/xomoni/issues/202) | [#213](https://github.com/pirdehi/xomoni/pull/213) |
| ✅ | Library: one card for your copy | [#203](https://github.com/pirdehi/xomoni/issues/203) | [#214](https://github.com/pirdehi/xomoni/pull/214) |
| ✅ | An Activity log grouped and readable | [#204](https://github.com/pirdehi/xomoni/issues/204) | [#215](https://github.com/pirdehi/xomoni/pull/215) |
| ✅ | Plain words across the dashboard | [#205](https://github.com/pirdehi/xomoni/issues/205) | [#216](https://github.com/pirdehi/xomoni/pull/216) |
| ✅ | One set of numbers | [#206](https://github.com/pirdehi/xomoni/issues/206) | [#217](https://github.com/pirdehi/xomoni/pull/217) |
| ✅ | A modern look, light and dark | [#207](https://github.com/pirdehi/xomoni/issues/207) | [#218](https://github.com/pirdehi/xomoni/pull/218) |

## Phase 13 · Sign-out and an easier start

Signing out of Xomoni as cleanly as signing in, and fewer steps from install to a connected browser.

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | Sign out of Xomoni in the extension: one dialog, a signed-out page, the account's data removed on request ([ADR-0023](adr/0023-sign-out-of-xomoni-in-the-extension.md)) | [#226](https://github.com/pirdehi/xomoni/issues/226) | [#227](https://github.com/pirdehi/xomoni/pull/227) |
| ✅ | Connect a browser to xomoni.com with one click: the extension asks, the website hands over the one-time code ([ADR-0024](adr/0024-connect-a-browser-with-one-click.md)) | [#228](https://github.com/pirdehi/xomoni/issues/228) | [#229](https://github.com/pirdehi/xomoni/pull/229) |
| ⏸ | One-click install from the Chrome Web Store, with automatic updates (the only way Chrome allows) | [#43](https://github.com/pirdehi/xomoni/issues/43) | Waits for the maintainer's developer account |

## Phase 14 · One Xomoni: the website and the extension together

The website shows and works with what the extension has, in the same browser. Work on X stays in the extension (ADR-0006), and X content never reaches a server (ADR-0004): the website reads it from the extension in the same browser.

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | One sign-in: signing in or out on xomoni.com or in the extension does the same on the other ([ADR-0025](adr/0025-one-sign-in-for-the-website-and-the-extension.md)) | [#232](https://github.com/pirdehi/xomoni/issues/232) | [#236](https://github.com/pirdehi/xomoni/pull/236) |
| ✅ | The website shows the extension's Library, Watch and account health, read from the extension in the same browser and kept nowhere (ADR-0028; Home and Activity came with #251 and #252, Settings comes with #234) | [#233](https://github.com/pirdehi/xomoni/issues/233) | [#278](https://github.com/pirdehi/xomoni/pull/278) |
| ✅ | Settings on the website, applied in the extension within its safety rules: back to Careful, active hours, failures in a row, notifications, keep going while away, Watch searches (ADR-0029) | [#234](https://github.com/pirdehi/xomoni/issues/234) | [#279](https://github.com/pirdehi/xomoni/pull/279) |
| ✅ | Plan a cleanup on the website (what, how old, what to keep, and how much it matches in Xomoni's copy), start it in Xomoni after its own confirmation | [#235](https://github.com/pirdehi/xomoni/issues/235) | [#281](https://github.com/pirdehi/xomoni/pull/281) |

## Phase 15 · A UX pass of both surfaces

Every page of xomoni.com and of the extension's dashboard, reviewed on screen (desktop and phone, light and dark) on 17 November 2026, and what was found fixed.

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | xomoni.com: the real pace on the landing page, today's screenshot, the extension's numbers on job cards, one header for the account | [#239](https://github.com/pirdehi/xomoni/issues/239) | [#241](https://github.com/pirdehi/xomoni/pull/241) |
| ✅ | The extension: a settled archive card, Settings' folds and layout, Watch's form, Home while it loads | [#240](https://github.com/pirdehi/xomoni/issues/240) | [#241](https://github.com/pirdehi/xomoni/pull/241) |

## Phase 16 · xomoni.com, one product

A UX review of the website's structure: it is two products today, dead-ends on a phone, and getting started has no thread. This phase gives the website one guided start and a phone that works; the app shell (#245) moved to Phase 17, the full dashboard. Review: [English](reports/2026-11/UX-REVIEW-WEBSITE-2026-11-17.md) · [فارسی](reports/2026-11/UX-REVIEW-WEBSITE-2026-11-17.fa.md).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | A phone menu, *Install* in the header, a full footer | [#242](https://github.com/pirdehi/xomoni/issues/242) | [#292](https://github.com/pirdehi/xomoni/pull/292) |
| ✅ | The landing page for one Xomoni: one story about risk, *How it works* first, *Send to my computer* on a phone | [#243](https://github.com/pirdehi/xomoni/issues/243) | [#323](https://github.com/pirdehi/xomoni/pull/323), [#333](https://github.com/pirdehi/xomoni/pull/333) |
| ✅ | Getting started: `/welcome` after install, a checklist that ticks itself, sign-up keeps `next` | [#244](https://github.com/pirdehi/xomoni/issues/244) | [#293](https://github.com/pirdehi/xomoni/pull/293), [#294](https://github.com/pirdehi/xomoni/pull/294) |
| ⏸ | Language: Persian (right-to-left) or English only | [#246](https://github.com/pirdehi/xomoni/issues/246) | Waits for the maintainer |

## Phase 17 · The full dashboard on xomoni.com

xomoni.com becomes the place to see and manage the X account: every place of the extension, and audience, content and engagement insights, comments and reports. Daily numbers reach the cloud only by the person's choice and with no extra request to X (ADR-0026). The extension's actions work from the website in the same browser, approved in Xomoni (ADR-0027). Plan: [English](reports/2026-11/DASHBOARD-PLAN-2026-11-19.md) · [فارسی](reports/2026-11/DASHBOARD-PLAN-2026-11-19.fa.md) · [#248](https://github.com/pirdehi/xomoni/issues/248).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | The shell: every section, the account and period pickers, no empty wall | [#245](https://github.com/pirdehi/xomoni/issues/245) | [#259](https://github.com/pirdehi/xomoni/pull/259) |
| ✅ | The extension's actions from the website, and the dialog when Xomoni isn't there | [#251](https://github.com/pirdehi/xomoni/issues/251) | [#263](https://github.com/pirdehi/xomoni/pull/263), [#264](https://github.com/pirdehi/xomoni/pull/264) |
| ✅ | Daily numbers in the extension, from what X already sends | [#249](https://github.com/pirdehi/xomoni/issues/249) | [#265](https://github.com/pirdehi/xomoni/pull/265) |
| ✅ | Daily numbers on xomoni.com, by the person's choice | [#250](https://github.com/pirdehi/xomoni/issues/250) | [#266](https://github.com/pirdehi/xomoni/pull/266), [#268](https://github.com/pirdehi/xomoni/pull/268) |
| ✅ | Release 0.3.0: everything since 0.2.1, actions from the website and daily numbers | [#260](https://github.com/pirdehi/xomoni/issues/260) | [#270](https://github.com/pirdehi/xomoni/pull/270), [v0.3.0](https://github.com/pirdehi/xomoni/releases/tag/v0.3.0), [#272](https://github.com/pirdehi/xomoni/pull/272) |
| ✅ | Overview: the figures against the period before, followers over time, what was published (top posts come with #233) | [#252](https://github.com/pirdehi/xomoni/issues/252) | [#273](https://github.com/pirdehi/xomoni/pull/273) |
| ✅ | Audience: followers and following, gained and lost each day, milestones, the ratio (who followed or unfollowed: by comparing archives in Xomoni, #233) | [#253](https://github.com/pirdehi/xomoni/issues/253) | [#274](https://github.com/pirdehi/xomoni/pull/274) |
| ✅ | Content: each type published against the period before, by type over time, the weekday most is published (what needs the posts themselves: in Xomoni, #233) | [#254](https://github.com/pirdehi/xomoni/issues/254) | [#275](https://github.com/pirdehi/xomoni/pull/275) |
| ✅ | Engagement: received by type, views and the rate against the period before and over time, the share seen with a like, as labelled estimates (most-liked replies: in Xomoni, #233) | [#255](https://github.com/pirdehi/xomoni/issues/255) | [#276](https://github.com/pirdehi/xomoni/pull/276) |
| ✅ | Release 0.4.0: Xomoni answers the Library, Watch, Account health, Settings and Cleanup places on xomoni.com | [#282](https://github.com/pirdehi/xomoni/issues/282) | [#283](https://github.com/pirdehi/xomoni/pull/283), [v0.4.0](https://github.com/pirdehi/xomoni/releases/tag/v0.4.0) |
| ✅ | Comments: *Your replies* (by date, likes, who and words, picked for a cleanup in Xomoni) and *Replies to you* (kept 90 days on the computer, never acted on, ADR-0030) | [#256](https://github.com/pirdehi/xomoni/issues/256) | [#284](https://github.com/pirdehi/xomoni/pull/284), [#287](https://github.com/pirdehi/xomoni/pull/287) |
| ✅ | Reports: weekly, monthly, the year in review, cleanup and your own, as CSV and PDF, and a weekly email for those who ask (ADR-0031) | [#257](https://github.com/pirdehi/xomoni/issues/257) | [#288](https://github.com/pirdehi/xomoni/pull/288), [#291](https://github.com/pirdehi/xomoni/pull/291) |

## Phase 18 · Install with one click 🔄

The Chrome Web Store (unlisted first) and Edge Add-ons as the way to install, with what makes the zip easier meanwhile. Each phase gets its issues once the maintainer approves the [project](reports/2026-11/INSTALL-PROJECT-2026-11-21.fa.md) ([options](reports/2026-11/INSTALL-UX-2026-11-21.fa.md), [#295](https://github.com/pirdehi/xomoni/issues/295)).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| 🔄 | 0 · Store accounts (Chrome Web Store, Edge Partner Center) and decisions: the maintainer's | [#298](https://github.com/pirdehi/xomoni/issues/298) | |
| ✅ | 1 · A simpler /install now: the checklist on top, browser- and OS-specific steps, drag the folder, step by step, a pin hint, and short illustrations of the hard steps instead of videos | [#299](https://github.com/pirdehi/xomoni/issues/299) | [#308](https://github.com/pirdehi/xomoni/pull/308), [#330](https://github.com/pirdehi/xomoni/pull/330) |
| ✅ | 2 · Moving data between versions: a full export and a checked import (ADR-0032) | [#300](https://github.com/pirdehi/xomoni/issues/300) | [#310](https://github.com/pirdehi/xomoni/pull/310) |
| ✅ | 3 · Ready for the stores: permissions, no remote code, single purpose, the name (Xomoni — Digital footprint manager, in Tools), the privacy policy, images, notes for reviewers. Left for the maintainer: the listing text's approval and the privacy form's answers in each dashboard | [#301](https://github.com/pirdehi/xomoni/issues/301) | [#309](https://github.com/pirdehi/xomoni/pull/309), [#320](https://github.com/pirdehi/xomoni/pull/320), [#321](https://github.com/pirdehi/xomoni/pull/321) |
| ✅ | 3 · Xomoni's own icon instead of one like X's mark, and X named in words on the connection map ([ADR-0035](adr/0035-xomoni-has-its-own-mark.md)) | [#322](https://github.com/pirdehi/xomoni/issues/322) | [#326](https://github.com/pirdehi/xomoni/pull/326) |
| 🔄 | 4 · A fixed extension id from the store's key, and release 0.5.0. Built: xomoni.com finds Xomoni at the stores' ids, and a test checks the key against the id. Left: the key and ids from the stores, and release 0.5.0 with the maintainer's go | [#302](https://github.com/pirdehi/xomoni/issues/302) | [#324](https://github.com/pirdehi/xomoni/pull/324) |
| 🔄 | 5 · Submitting. Built: store uploads from GitHub Actions, the release's own store build checked against its checksums and provenance. Left: the accounts and keys, and submitting the Chrome Web Store unlisted and Edge Add-ons, with the maintainer's go | [#303](https://github.com/pirdehi/xomoni/issues/303) | [#314](https://github.com/pirdehi/xomoni/pull/314) |
| ✅ | 6 · /install with one button per browser, the home page's store button, and a card that brings zip users to the store (ADR-0034); both show once a store's address is written. Left: trying /welcome after a store install | [#304](https://github.com/pirdehi/xomoni/issues/304) | [#325](https://github.com/pirdehi/xomoni/pull/325), [#330](https://github.com/pirdehi/xomoni/pull/330) |
| ✅ | 7 · Signed one-click updates for the zip (ADR-0033): signing starts once the maintainer adds the key, and the store build has no updater | [#305](https://github.com/pirdehi/xomoni/issues/305) | [#316](https://github.com/pirdehi/xomoni/pull/316) |
| 🔄 | 8 · Docs (ADR-0034) and the install FAQ are in. Left: making the listings public, the maintainer's decision | [#306](https://github.com/pirdehi/xomoni/issues/306) | [#311](https://github.com/pirdehi/xomoni/pull/311), [#325](https://github.com/pirdehi/xomoni/pull/325) |

## Phase 19 · Quality gate 🔄

Every merge and every release passes the same written gate, enforced by commands and GitHub settings rather than memory ([quality gates](QUALITY-GATES.md), [ADR-0037](adr/0037-one-written-gate-for-every-merge-and-release.md), [ADR-0038](adr/0038-user-scenarios-for-every-user-facing-task.md), [ADR-0039](adr/0039-the-readme-comes-from-the-feature-registry.md)).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| ✅ | 0 · The rules: the three ADRs, the definition of done, the release checklist template, `CODEOWNERS`, and the `release` and `stores` environments with the maintainer as required reviewer | [#346](https://github.com/pirdehi/xomoni/issues/346) | [#348](https://github.com/pirdehi/xomoni/pull/348) |
| ✅ | 1 · The README's features and status from `docs/features.json`, checked by `verify` and the release check | [#337](https://github.com/pirdehi/xomoni/issues/337) | [#349](https://github.com/pirdehi/xomoni/pull/349) |
| ✅ | 2 · At least 20 user scenarios per user-facing task, each tied to a browser test, checked by `verify`; the install page's first | [#338](https://github.com/pirdehi/xomoni/issues/338) | [#356](https://github.com/pirdehi/xomoni/pull/356) |
| ✅ | 3 · The `pr-policy` check (task link, changelog line, scenarios, exemptions with reasons) and dependency review | [#339](https://github.com/pirdehi/xomoni/issues/339) | [#350](https://github.com/pirdehi/xomoni/pull/350) |
| ✅ | 4 · The release gate: the full CI on the tag, `npm audit`, the release issue read by the workflow and closed with the release | [#340](https://github.com/pirdehi/xomoni/issues/340) | [#353](https://github.com/pirdehi/xomoni/pull/353) |
| ✅ | 5 · The three open CodeQL alerts | [#341](https://github.com/pirdehi/xomoni/issues/341) | [#355](https://github.com/pirdehi/xomoni/pull/355) |
| ✅ | 6 · The extension in a real browser with X fixtures, Chrome and Edge, axe | [#342](https://github.com/pirdehi/xomoni/issues/342) | [#360](https://github.com/pirdehi/xomoni/pull/360) |
| ✅ | 7 · The nightly full run, and a check after each release | [#343](https://github.com/pirdehi/xomoni/issues/343) | [#359](https://github.com/pirdehi/xomoni/pull/359) |
| ✅ | 8 · Docs sorted by kind, with one map: dated reports in `docs/reports/<yyyy-mm>/`, the map in `docs/README.md`, checked by `docs:check` | [#344](https://github.com/pirdehi/xomoni/issues/344) | [#364](https://github.com/pirdehi/xomoni/pull/364) |
| 🔄 | 9 · Scenarios for the features shipped before the gate. Done: `cleanup-by-date`, 34 scenarios in the built extension ([file](scenarios/199-cleanup-by-date.md)); `keep-rules`, 31 ([file](scenarios/367-keep-rules.md), #367); `x-pacing`, 34 ([file](scenarios/17-x-pacing.md)); `one-click-updates`, 29 ([file](scenarios/305-one-click-updates.md)); `sign-out`, 26 ([file](scenarios/226-sign-out.md)); `one-sign-in`, 26 ([file](scenarios/232-one-sign-in.md)); `move-your-data`, 28 ([file](scenarios/300-move-your-data.md)); `x-archive`, 26 ([file](scenarios/184-x-archive.md)); `numbers-on-website`, 30 ([file](scenarios/250-numbers-on-website.md)) | [#345](https://github.com/pirdehi/xomoni/issues/345) | [#365](https://github.com/pirdehi/xomoni/pull/365), [#368](https://github.com/pirdehi/xomoni/pull/368), [#369](https://github.com/pirdehi/xomoni/pull/369), [#384](https://github.com/pirdehi/xomoni/pull/384), [#385](https://github.com/pirdehi/xomoni/pull/385), [#386](https://github.com/pirdehi/xomoni/pull/386), [#383](https://github.com/pirdehi/xomoni/pull/383), [#387](https://github.com/pirdehi/xomoni/pull/387) |
| 🔄 | 10 · The maintainer's settings. Done on 2026-11-21: the `release` and `stores` environments, and `pr-policy`, `dependency-review` and CodeQL's results required by the ruleset. Left: an account for AI agents, then code-owner review; signed commits | [#346](https://github.com/pirdehi/xomoni/issues/346) | |
| ✅ | 11 · Safety fix found by the scenarios: a job reads X's notice of a limited or suspended account only once X has drawn the page, before anything else reaches X | [#375](https://github.com/pirdehi/xomoni/issues/375) | [#376](https://github.com/pirdehi/xomoni/pull/376) |
| ✅ | 12 · Safety: each job reads X's Home first, even when the X window is on another page, at the reading pace | [#377](https://github.com/pirdehi/xomoni/issues/377) | [#378](https://github.com/pirdehi/xomoni/pull/378) |
| ✅ | 13 · Safety fix found by the scenarios: a read stops at X's rate limit as a cleanup does, on the risk ladder, waiting for X's reset and loading the same page again | [#392](https://github.com/pirdehi/xomoni/issues/392) | [#394](https://github.com/pirdehi/xomoni/pull/394) |
| ✅ | 14 · Accessibility: axe on every page of the extension, light and dark, laptop and phone width, before and after an account, and on the dialogs, menus, errors, empty lists, toasts and job states of both the extension and xomoni.com | [#389](https://github.com/pirdehi/xomoni/issues/389) | [#393](https://github.com/pirdehi/xomoni/pull/393) |
| ✅ | 16 · CI: the website's and the extension's browser tests side by side in `e2e` and `e2e-edge`, each job from about 25 minutes to about 14, gating the same tests; the `/install` tests wait for React before their first click | [#404](https://github.com/pirdehi/xomoni/issues/404) | [#406](https://github.com/pirdehi/xomoni/pull/406), [#411](https://github.com/pirdehi/xomoni/pull/411) |
| ✅ | 17 · CI: the browser tests in shards on runners of their own, the website's two each with its own Supabase and the extension's two, behind the same `e2e` and `e2e-edge` gates | [#412](https://github.com/pirdehi/xomoni/issues/412) | |
| ✅ | 18 · Safety fix found by the time-of-day audit: two quick changes in Settings both land, so the active hours are the ones chosen | [#427](https://github.com/pirdehi/xomoni/issues/427) | |

## Phase 20 · R1: the first paid release (0.6.0) 🔄

The first release with paid plans: the extension 0.6.0 and xomoni.com. Payments go through Polar, the merchant of record, and the cloud keeps only the plan, which the extension reads over its connection, with 7 days of grace offline ([ADR-0042](adr/0042-payments-and-entitlements-with-polar.md)). The vault reads X's official files and keeps them on the computer, with an import ledger and an export that needs no Xomoni ([ADR-0043](adr/0043-the-vault-x-files-kept-on-the-computer.md), [ADR-0044](adr/0044-an-open-export-of-the-vault.md)). Reach diagnosis is built on it, with guesses labelled as guesses, and so is a public digest of X's ranking code made from public code only ([ADR-0045](adr/0045-reach-diagnosis-guesses-labelled-as-guesses.md), [ADR-0046](adr/0046-a-public-digest-of-xs-open-ranking-code.md)). Green modes only: nothing scrolls, navigates, clicks or watches X on its own. Each phase closes with its own gate, and the release with its release issue ([quality gates](QUALITY-GATES.md)). Milestone: [Phase 20 · R1 (0.6.0)](https://github.com/pirdehi/xomoni/milestone/12).

| | Task | Issue | Pull request |
| --- | --- | --- | --- |
| 🔄 | CB.1 · Payments: the decision, the billing tables with Row Level Security, `@xomoni/entitlements`, the terms of sale and a fake Polar for the tests. Done: the ADR ([ADR-0042](adr/0042-payments-and-entitlements-with-polar.md)) | [#420](https://github.com/pirdehi/xomoni/issues/420) | [#434](https://github.com/pirdehi/xomoni/pull/434) |
| ⬜ | CB.2 · Payments: the signed, idempotent webhook, checkout, the customer portal and deleting an account with a subscription | [#421](https://github.com/pirdehi/xomoni/issues/421) | |
| ⬜ | CB.3 · Payments: `/pricing`, `/account/billing` and the legal links, with their scenarios | [#422](https://github.com/pirdehi/xomoni/issues/422) | |
| ⬜ | CB.4 · Payments: the plan in the extension with the offline grace, the Plus parts gated, and the sales launch | [#423](https://github.com/pirdehi/xomoni/issues/423) | |
| 🔄 | CV.1 · The vault: the decisions, its tables, version 2 of the move file, and the importer with the archive on it. Done: the ADRs ([ADR-0043](adr/0043-the-vault-x-files-kept-on-the-computer.md), [ADR-0044](adr/0044-an-open-export-of-the-vault.md)) | [#424](https://github.com/pirdehi/xomoni/issues/424) | [#434](https://github.com/pirdehi/xomoni/pull/434) |
| ⬜ | CV.2 · The vault: the Vault page, X's analytics CSV, the account's timeline and a local reminder | [#425](https://github.com/pirdehi/xomoni/issues/425) | |
| ⬜ | CV.4 · The vault: *Export my vault*, the *Your vault* card on xomoni.com, performance and accessibility | [#426](https://github.com/pirdehi/xomoni/issues/426) | |
| 🔄 | P5.1 · Reach: the decisions, each post's links and media, the *Under the hood* import and the reach model. Done: the ADRs ([ADR-0045](adr/0045-reach-diagnosis-guesses-labelled-as-guesses.md), [ADR-0046](adr/0046-a-public-digest-of-xs-open-ranking-code.md)) | [#428](https://github.com/pirdehi/xomoni/issues/428) | [#434](https://github.com/pirdehi/xomoni/pull/434) |
| ⬜ | P5.2 · Reach: the Reach page, with each post's reach, comparisons, X's labels and suspected posts as guesses | [#429](https://github.com/pirdehi/xomoni/issues/429) | |
| ⬜ | P5.3 · Reach: the new-label alert, and the monthly digest of X's ranking code on xomoni.com/algorithm | [#430](https://github.com/pirdehi/xomoni/issues/430) | |
| ⬜ | P5.4 · Reach on xomoni.com in the same browser, performance at 50,000 posts, accessibility and the release | [#431](https://github.com/pirdehi/xomoni/issues/431) | |

## Dropped

| | Task | Issue | Why |
| --- | --- | --- | --- |
| ✖ | Assisted mode: the person clicks every delete | [#35](https://github.com/pirdehi/xomoni/issues/35) | Automatic mode only, at one fifth of X's limits (decision of 2026-11-01). |
| ✖ | Official API mode | [#36](https://github.com/pirdehi/xomoni/issues/36) | Same decision. |
| ✖ | Mode chooser and risk explainer | [#37](https://github.com/pirdehi/xomoni/issues/37) | No modes left to choose between. |
| ✖ | Techniques that hide automation from X | [#47](https://github.com/pirdehi/xomoni/issues/47) | Never: [ADR-0003](adr/0003-no-credentials-no-evasion.md). |

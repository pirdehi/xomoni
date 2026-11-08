[فارسی](PLAYBOOK.fa.md)

# Scenario playbook: X's limiting mechanisms and Xomoni's response

> Companion to [RESEARCH.md](RESEARCH.md). This document categorizes every way X may limit automated work. For each item, it states exactly how Xomoni detects it and how it responds.
>
> Date: 30 October 2026 (one-fifth rule added 31 October 2026) · Code version: v0.1

## Reading guide

**Confidence level for each item:**
- 📘 **Documented:** stated in X's Help Center or official documentation.
- 📰 **Reported:** seen by independent sources or other tools, but not officially confirmed by X.
- 🧠 **Inferred:** X probably does this or could do it. As a precaution, the design assumes it.

**Implementation status in Xomoni:**
- ✅ **Implemented and tested.**
- 🟡 **Partial:** works but needs improvement.
- 🔴 **Not implemented:** must be built.
- ⚠️ **Accepted risk:** has no proper technical solution and is managed with transparency and caution.

**Standing principle:** Xomoni **does not circumvent** any mechanism. It matches its pace to X, heeds every X warning and stops at the first serious sign. Section 8 explains why.

---

## Status summary

| # | X mechanism | Confidence | Status |
|---|---|---|---|
| A1 | Per-endpoint 15-minute quota | 📘 | ✅ |
| A2 | Error 429 / code 88 | 📘 | ✅ |
| A3 | Daily action caps (185, 344, likes) | 📘📰 | ✅ |
| A4 | "Posts read per day" cap | 📰 | ✅ |
| A5 | Search and post-page quota | 📰 | ✅ |
| A6 | Different caps for Premium accounts | 📘📰 | ✅ |
| B1 | Error 226 ("automated behavior") | 📰 | ✅ |
| B2 | Signed `x-client-transaction-id` header | 📰 | ✅ |
| B3 | Synthetic click detection (`isTrusted`) | 🧠 | ⚠️ |
| B4 | Analysis of action timing regularity | 🧠 | ✅ |
| B5 | Sudden spike in work volume | 🧠 | 🟡 |
| B6 | Back-to-back like and unlike | 📘 | ✅ |
| B7 | In-page script detection | 🧠 | ⚠️ |
| B8 | Automated browser (webdriver, CDP, headless) | 📰 | ✅ |
| B9 | Device and network reputation | 📰 | 🟡 |
| C1 | Graduated penalty ladder | 📰 | ✅ |
| C2 | Account lock (326) and Arkose captcha | 📘📰 | ✅ |
| C3 | "Limited" or read-only account | 📰 | ✅ |
| C4 | Suspension (code 64) | 📘 | ✅ |
| C5 | Silent block (action is confirmed but not carried out) | 🧠 | ✅ |
| C6 | Visibility limits and Search ban | 📰 | ✅ |
| C7 | Ban on non-API automation in X's rules | 📘 | ⚠️ |
| D1 | Logout or session expiry | 📘 | ✅ |
| D2 | X's new login page (`/i/jf/…`) | 📰 | ✅ |
| D3 | 2FA, email/SMS code, login captcha | 📘 | ✅ |
| D4 | Account switch in another tab | 🧠 | ✅ |
| D5 | CSRF token rotation (`ct0`) | 📰 | ✅ |
| E1 | Cap of about 3,200 posts on the profile | 📰 | ✅ |
| E2 | **Search does not show old posts with no likes** | 📰 | ✅ |
| E3 | Incomplete or delayed search index | 📘 | ✅ |
| E4 | Likes timeline depth and "ghost" likes | 📰 | ✅ |
| E5 | Temporary display of deleted content | 🧠 | ✅ |
| E6 | Original post unavailable (repost or like) | 🧠 | ✅ |
| E7 | Edited posts (multiple IDs) | 📘 | ✅ |
| E8 | Archive retrieval limits | 📘 | ✅ |
| F1 | DOM changes and A/B tests | 🧠 | ✅ |
| F2 | X interface language | 📘 | ✅ |
| F3 | Intrusive popups (Premium, cookies, notifications) | 📰 | ✅ |
| F4 | queryId rotation and response structure changes | 📰 | ✅ |
| F5 | Background tab slowdown or discard | 📘 | ✅ |
| F6 | Internet outage, system sleep, X outage | 🧠 | ✅ |
| F7 | System clock skew | 🧠 | ✅ |
| F8 | Concurrent runs and parallel use of X | 🧠 | ✅ |

---

## A. Rate limits and quotas

> **Rule (ADR-0012, 31 October 2026):** for every limit X announces, Xomoni uses at most **one fifth**, under no circumstances more. This applies to the limits X publishes (`apps/extension/src/shared/x-limits.ts`, with sources) and to the live limits X reports in its headers. Every request that reaches X counts, failed ones included. On an account's first active days Xomoni goes even lower (warm-up: 25%, 50%, 75%, then 100% of one fifth).

### A1. Per-endpoint 15-minute quota · 📘 · ✅
- **X mechanism:** Each GraphQL operation has its own 15-minute window, for example `DeleteTweet`, `UnfavoriteTweet`, `SearchTimeline` and `TweetDetail`. X reports the quota in the `x-rate-limit-limit / remaining / reset` headers.
- **Detection:** `interceptor.ts` reads these headers from the responses of **X's own web app**, in all x.com tabs. The result is stored in the `limits` table.
- **Scenario:** Before each action, `Limiter.before()` checks the quota of that operation. Once one fifth of X's window is used (`limit − remaining ≥ limit / 5`), it waits until `reset` plus a random 5 to 20 seconds. A page load checks the quota of that page's own operation (search, timeline, likes or post page).

### A2. Error 429 / code 88 · 📘 · ✅
- **Scenario:**
  - The action counts as "not done" and goes back into the queue.
  - Xomoni waits until `reset` plus 10 to 30 seconds. If X did not give a reset time, it waits 15 to 20 minutes.
  - The slowdown factor (AIMD) is multiplied by 1.6, up to a maximum of 6. Each success lowers it by 5%.

### A3. Daily action caps · 📘📰 · ✅
- **X mechanism:** Codes 185 and 344 mean the daily cap is reached. For likes, a historical cap of about 1,000 per day has been reported. Since May 2026, unverified accounts are capped at 50 posts and 200 replies per day.
- **Scenario:**
  - On error, wait about 24 hours plus 5 to 30 minutes.
  - Xomoni's caps are one fifth of X's published limits: 10 deletions, undone reposts or unlikes per 15 minutes; 200 unlikes per day (shared with ghost-like cleanup); 960 deletions per day at most.
  - Xomoni never creates posts or replies. The only possible "creation" is the temporary like in the Ghost likes option, which has a separate cap of 200 per day.

### A4. "Posts read per day" cap · 📰 · ✅
- **X mechanism:** In July 2023 these caps were announced: about 1,000 posts per day for an unverified account, about 500 for a new account, and about 10,000 for Premium. Whether they still apply in 2026 is **unknown**. The error message is "Rate limit exceeded".
- **Scenario (adaptive learning, #28):**
  1. Every page load and scroll stores how many posts it showed (`reads.posts`), so Xomoni knows the posts seen in the last 24 hours across runs.
  2. When X refuses a page with a 429 that names no reset time and doesn't say its 15-minute window is used up (`unexplainedRefusal`), Xomoni takes it as the daily view cap: with V posts seen in 24 hours (at least 100), it stops at 0.8×V posts a day for that account (`learnViewCap`). A cap is only ever lowered.
  3. Page loads then wait until enough of the day's oldest pages age out (`viewCapFreeAt`).
  4. The cap is stored per account (`viewCap:<account>` in `kv`), logged as a warning, and shown on the limits panel with the posts seen today.

### A5. Search and post-page quota · 📰 · ✅
- **X mechanism:** Search and the post page have separate quotas. The search quota is low, on the order of a few dozen requests per 15 minutes.
- **Scenario (implemented, #16):**
  - If a sweep page fails and X answered its requests with a 429 (or nothing remaining), Xomoni records the rate limit on the risk ladder, waits for X's reset plus 30–90 seconds, and loads **the same page** again, up to 3 times. After that it pauses the job; it never falls back to the deep clean for a quota error, because the deep clean opens each post separately and is much more expensive.
  - The risk ladder is stricter still: a second rate limit within an hour stops the job (§7).
  - A page that fails for another reason is tried again after 1–2 minutes. Only after 3 failed loads does Xomoni continue with the inventory (deep clean).

### A6. Different Premium caps · 📘📰 · ✅
- **Scenario (#33):** Xomoni reads the account type from the profile response (`is_blue_verified`) and stores it with the account. Careful stays the default for everyone, and nothing gets faster for Premium: under ADR-0012 there is no Balanced mode. An account not known to be Premium loads pages at **half** the read ceiling (`readFactor` in `shared/x-limits.ts`), since X's 2023 view caps gave unverified accounts a tenth of Premium's. The limits panel says so.

---

## B. Automation detection

### B1. Error 226 ("This request looks like it might be automated") · 📰 · ✅
- **Scenario (implemented, #17):**
  - **First 226:** stop, and lock Resume for **6 hours** with a countdown. "Resume anyway" only by typing a confirmation. Half pace for 7 days.
  - **Second 226 within 7 days:** **24-hour** lock, and a quarter of the pace.
  - **Third 226:** full stop, no automatic resume.
  - Each 226 also drops the warm-up back one step.

### B2. `x-client-transaction-id` header · 📰 · ✅
- **Scenario:** Xomoni builds no requests. X's own web app sends the request with the correct header. This is exactly why the "click" approach was chosen.

### B3. Synthetic click detection · 🧠 · ⚠️
- **Possible mechanism:** Events that a script creates have `isTrusted=false`. X may record this, or the absence of mouse movement before a click, in its own telemetry.
- **Why we do not fake it:** The only way to create a "trusted" event from inside an extension is the `chrome.debugger` API. It shows the "debugging" warning bar, and it is exactly the concealment behavior rejected in section 8.
- **Risk management:** Low volume, human-like spacing between actions, and a stop at the first 226. If X measures this signal, its first sign is a 226 or a lock, and Xomoni stops right there.

### B4. Timing regularity analysis · 🧠 · ✅
- **Scenario (implemented, #30; `shared/pacing.ts`, `engine/limiter.ts`):**
  - **Work sessions:** each session lasts 25 to 50 minutes, followed by a 10 to 30 minute rest. Any quiet gap of 10 minutes or more counts as the rest, and so does any wait of that length (a rate-limit reset, active hours). The session is seeded from the latest requests in the activity log, so starting a new run doesn't skip a rest.
  - **Delays:** log-normal around the middle of each rule's range, kept inside it, plus a 30 to 90 second pause about one time in twenty. Never below the minimum, and on average longer than the uniform delay it replaced.
  - **Active hours:** on by default, 8:00 to 23:00 local time; the person can change or turn them off.
  - Rest between batches, as before.
  - The goal is not to statistically imitate a human. The goal is to spread the load across the day and keep the hourly work volume low. Everything here only slows Xomoni down (ADR-0012).

### B5. Sudden spike in work volume · 🧠 · 🟡
- **Possible mechanism:** An account that usually performs 5 actions a day and suddenly performs 1,000 deletions a day looks abnormal.
- **Scenario (warm-up, implemented; ADR-0012):** on an account's first active days Xomoni uses only part of its one-fifth share. Caps shrink and delays grow by the same factor:

  | Active day | Share of one fifth | Deletions per 15 min | Per hour | Per day |
  |---|---|---|---|---|
  | 1 | 25% | 2 | 10 | 240 |
  | 2 | 50% | 5 | 20 | 480 |
  | 3 | 75% | 7 | 30 | 720 |
  | 4 onward | 100% | 10 | 40 | 960 |

  If there has been no activity for 14 days, the warm-up starts over. **Still open (#17):** after any 226 or lock, drop back a step.

### B6. Back-to-back like and unlike · 📘 · ✅
- **X mechanism:** X's rules prohibit aggressive liking and unliking.
- **Scenario:** The Ghost likes option is off by default and has a separate cap (40 per hour and 200 per day, with 15 to 30 seconds between actions). If X rejects a like, the job stops right there. If an unlike fails, it retries up to 3 times so that no like is left behind.

### B7. In-page script detection · 🧠 · ⚠️
- **Possible mechanism:** X can see that `fetch` has been overridden (its `toString` is not native).
- **Risk management:** Many common extensions do the same, so this signal alone is of little use. Xomoni does not hide this change (section 8) and keeps its footprint minimal: it only reads and does not modify any request.

### B8. Automated browser · 📰 · ✅
- **Scenario:** Xomoni runs in the user's own Chrome and has no webdriver or CDP.
- **⚠️ Operational note:** A test window opened with Chrome for Testing and `--remote-debugging-port` is **not suitable for a real account**. Install the extension in your everyday Chrome.

### B9. Device and network reputation · 📰 · 🟡
- **X mechanism:** A login from a new device, a VPN or a datacenter IP triggers a security challenge and a "new login" email.
- **Scenario:**
  - Xomoni has no proxy and always works from the user's own network.
  - **Operational rule:** Use the same Chrome and the same network you always use with X, and do not switch VPN in the middle of a job.
  - **Proposed:** Show a warning if the account logs in again in the middle of a job (meaning the session has changed).

---

## C. Enforcement and penalties

### C1. Graduated penalty ladder · 📰 · ✅
X usually gets stricter step by step: a warning, then 226, then a temporary restriction, then a lock, and finally suspension. Xomoni has **its own risk ladder** (section 7, ADR-0013) so it always backs off one step earlier.

### C2. Account lock (326, `/account/access`) and Arkose captcha · 📘📰 · ✅
- **Scenario (implemented, #17):**
  - Xomoni waits for the person and sends a notification; the person solves X's check themselves.
  - After the check, Xomoni rests **60 to 90 minutes**, then runs at a quarter of its pace for 48 hours and at half until the week is over.
  - **Second lock within 7 days:** full stop, with no automatic resume.

### C3. "Limited" or read-only account · 📰 · ✅
- **X mechanism:** Posting, reposting and liking are blocked, but browsing works. The reported duration is 12 hours to 7 days, and the exact error code on the web is unknown.
- **Scenario (implemented, #18):**
  - HTTP 403 on any write action (delete, unlike, etc.) or codes 87, 261 or 220 → outcome `restricted`: **the job stops at the first one** and never retries.
  - X's "temporarily limited" or "restricted" notice on the page (alerts, pop-ups and the top of the main column) stops the job before any action. The match is deliberately broad; a false match only stops the job.
  - Posts, names and bios are never read for it (#146): anyone could otherwise stop a job, and raise the risk level, by replying with X's wording. The job, its log and notifications get Xomoni's own words for the notice, never the page's text.
  - Unknown failures in a row pause the job after **2** (the setting is capped at 3, was 5).
  - Not done: reading X's countdown from the banner.

### C4. Suspension (code 64) · 📘 · ✅
- **Scenario (implemented, #18):** code 64 → outcome `suspended`: stop immediately with a clear message, no waiting for the person (they can't fix it) and no automatic resume. Code 326 (a lock the person can clear) still waits for them.

### C5. Silent block · 🧠 · ✅
- **Possible mechanism:** X returns a success response but does not actually carry out the action (soft block).
- **Scenario (implemented, #22): sample checks.**
  1. About one in 25 confirmed actions (deletes, undone reposts, unlikes) is picked at random and queued in IndexedDB (`checks` table).
  2. 10 to 30 minutes later, at the next point where the run loads a new page anyway (before a sweep pass, before a deep-clean visit, or at the end of the job), the post's page is opened:
     - **Delete:** expect "not found".
     - **Undo repost:** expect the post shown as not reposted.
     - **Unlike:** expect the post shown as not liked.
  3. If X did not apply the action, Xomoni records a `silent_block` risk event: **full stop** (level 4, ADR-0013), with no automatic resume. A page that can't tell (it timed out, or the post isn't shown) drops the check without a verdict.

  The cost is about 4% extra page loads, each counted against the post-page budget (one fifth, ADR-0012). Checks not yet due when a job ends wait for the next cleanup run.

### C6. Visibility limits and Search ban · 📰 · ✅
- **X mechanism:** X may remove the account's posts from search. In that case a `from:` search comes back empty.
- **Risk:** Xomoni thinks "no posts are left", while the posts still exist.
- **Scenario (implemented, #15):**
  - If the first search page is empty but the inventory (archive or profile) still has matching posts, the job notes "X search showed none of the N matching posts in your inventory" and finishes **with a warning**, never as a plain Completed.
  - The deep clean visits those posts one by one (the note says to turn it on if it is off); small accounts are swept on the profile timeline first (E2).
  - Watch (#158, [ADR-0021](adr/0021-watch-x-search-read-only.md)) shows only what X's search shows. Each check is one paced page load of the `search` budget (60 per 15 minutes) under Xomoni's page-load ceiling, so a tab is searched at most once a minute and often less. Watch only reads: it never likes, replies or posts.

### C7. Ban on non-API automation in X's rules · 📘 · ⚠️
- **Rule:** "Non-API automation, such as scripting the X website" is prohibited and may lead to suspension.
- **Management:**
  - **Informed consent (implemented, #24):** before an X account's first job, the extension shows X's rule with a link, the risk that can't be removed, that deletions are permanent, to download the archive first, and what Xomoni never does. Going ahead needs typing `I UNDERSTAND`, stored per X account with the text's version; a new version asks again. The engine refuses to run without it. The same text, from `packages/consent`, is on xomoni.com/risks and in the README.
  - Conservative defaults.
  - No concealment of any kind.
  - Stop at the first serious sign.

  This risk never reaches zero, and the decision is the user's.

---

## D. Authentication and session

### D1. Logout or session expiry (codes 32, 89, 215, 353) · 📘 · ✅
- **Scenario:**
  - The job status becomes "Needs you", a desktop notification appears, and the X page reloads so that the login page is shown.
  - Xomoni waits until the same account comes back. The state must stay stable for 5 seconds.
  - After 10 to 20 seconds, the job continues. A post that was interrupted mid-job goes back into the queue.
  - **Tested:** on a simulated x.com, both at job start and mid-job.

### D2. X's new login page (`/i/jf/onboarding/web`) · 📰 · ✅
- **X mechanism:** It is reported that `/i/flow/login` now redirects to `/i/jf/onboarding/web?mode=login`.
- **Scenario (implemented, #20):** every `/i/jf/` path counts as a login page, so the job waits for the person. It resumes only after the worker has shown the same account, signed in with no X check, for 5 seconds.

### D3. 2FA, email or SMS code, login captcha · 📘 · ✅
- **Scenario:**
  - Xomoni never types or clicks anything on the login page. It neither takes nor stores the password.
  - It waits on all verification pages. In testing, it also waited correctly in the middle of the 2FA step.

### D4. Account switch in another tab · 🧠 · ✅
- **Scenario:** Before each action, the account ID is checked from the `twid` cookie. If the account has changed, the "Needs you" status is shown with the message "Switch back to @handle".

### D5. CSRF token rotation (`ct0`) · 📰 · ✅
- **Scenario:** X's own web app handles this. Xomoni does not touch cookies.

---

## E. Data visibility

### E1. Cap of about 3,200 posts on the profile · 📰 · ✅
- **Scenario:** Search and the archive are used for older posts.

### E2. Search does not show old posts with no likes · 📰 · ✅ · **Most important item**
- **X mechanism:** An independent report from August 2026 (with tests) says that posts **older than 7 days** with **zero likes** no longer appear in search results. The Help Center also says that posts older than one week may not appear in search because of indexing limits.
- **Risk:** Finding old posts in Xomoni relies mainly on search. A large share of old posts and replies have zero likes, and **search does not find them at all**. The "Full history" scan, which relies on search, also stays incomplete.
- **Scenario (implemented, #15; sources in order):**
  1. **Archive, the primary source:** The archive is complete. On the Cleanup page, if no archive has been imported for the account, a serious warning links to the import, and the job starts only after the person acknowledges that old posts may be missed.
  2. **Profile timeline:** The profile (`/handle` and `/handle/with_replies`) shows all posts regardless of likes, up to about 3,200 posts. If X's count says the account has fewer than 3,200 posts, the sweep reads this timeline first, in one pass.
  3. **Search:** for older posts that have likes.
  4. **Deep clean:** anything that is in the archive and has not been found yet is opened and deleted one by one.
  5. **Final report:** if X's count (`postsCount`, minus what Xomoni removed since X counted) exceeds the inventory by more than 20 posts and 2%, the job finishes with a warning: "X shows about N more posts, replies and reposts than Xomoni knows about … import your archive".

### E3. Incomplete or delayed search index · 📘 · ✅
- **Scenario:** Deep clean with the archive fills this gap.

### E4. Likes timeline depth and "ghost" likes · 📰 · ✅
- **Scenario:** Old likes are read from the archive. For likes that X no longer shows as "liked", the Ghost likes option (like again, then unlike) is off by default and comes with a warning.

### E5. Temporary display of deleted content · 🧠 · ✅
- **Scenario:**
  - A "not found" response (code 144) moves the item to the `gone` status and does not count as a failure.
  - A deleted post counts as "present" again only if it is seen on X again more than 5 seconds after the deletion.

### E6. Original post unavailable · 🧠 · ✅
- **Mechanism:** Sometimes a repost or like belongs to a post whose account is suspended, private or deleted. In that case the undo or unlike button may not be shown at all.
- **Before (#32):** Such an item counted as Failed, so a few in a row stopped the job for no reason.
- **Scenario:** X's own responses in the tab say which posts it won't show: a `TweetTombstone` or `TweetUnavailable` result instead of the post (`unavailableTweetIds` in `shared/graphql.ts`, remembered by `content/net.ts`). An unlike or undo-repost of such a post, or its post page, is recorded as Skipped ("unavailable on X"), never Failed, and never counts toward the failures-in-a-row stop. The job counts them apart (`stats.unavailable`) and the job card shows the number. A post that is on the page without its buttons, and that X did not mark unavailable, still fails, since that can mean X changed its page.

### E7. Edited posts · 📘 · ✅
- **Scenario:** Deleting the latest version deletes the whole post. Older IDs in the archive get "not found" and are skipped.

### E8. Archive retrieval limits · 📘 · ✅
- **Scenario:** The archive takes 24 to 72 hours to be ready. The guide recommends that you get the **archive first**. Xomoni also checks that the archive belongs to this same account.
- **Meanwhile (Library):** Xomoni reads what X shows (*Complete my copy*, a read-only `complete` scan) and shows how much of X's count it has; *Download a copy* saves any dates as HTML or JSON, from what was read and from an imported archive. The archive's ZIP is imported as it is (#184). It can miss what X search and the profile don't show (E1, E2), so it never replaces X's archive for a full cleanup. Its Request button only opens X's page; the person confirms there with their password.

---

## F. User interface and browser

### F1. DOM changes and A/B tests · 🧠 · ✅
- **Current status:** All selectors live in `dom.ts`, and Xomoni stops after 2 consecutive failures (C4).
- **Scenario (implemented, #21): a check before acting, or canary.**
  - Before the first action of each kind in every run, Xomoni checks the post it is about to act on:
    - **Delete:** open its "…" menu, check that the Delete option exists, and close the menu with Escape.
    - **Undo repost:** the same with the repost menu and its Undo repost option.
    - **Likes:** check for the unlike button, or the like button for a ghost like.
  - **Nothing inside a menu is ever clicked, and nothing is deleted.**
  - If the button, the option or Escape no longer works, the job stops as Stopped for safety **before the action**: "X changed its page". A post that can't tell (not on the page, or no longer liked) leaves the check to the next one.

- **How Escape is pressed (#121):** X is a React app, and React only hears events that pass through its root or a portal. An Escape sent to `document.body` never reaches X's handlers: the pilot's first cleanups stopped as "Escape no longer closes X's menu" for that reason. `closeMenus()` presses Escape (keydown and keyup, with the legacy key code 27) from inside each open menu or pop-up, at the focused element when it is inside, and then on the body. If a menu still stays open, the log says where it sat (focus, `#layers`, mask), never its text.
- **Elements are looked up right before each click (#121):** X's Dropdown builds a menu's items once, then builds them again once it has positioned the menu (a frame later). An option found right after opening is therefore soon off the page, and a click on it reaches nothing: React only hears events from elements on the page. Every cleanup in the pilot failed this way ("Delete confirmation did not appear", with the menu still open) until Xomoni stopped keeping elements across a wait: the Delete option, the confirm button and the Undo repost option are found again just before they are clicked. The test page builds its menus again after opening them, as X does, and handles clicks on one container, as React does.

### F2. X interface language · 📘 · ✅
- **Scenario:** The Delete label is recognized in 22 languages, 23 spellings (including Persian), and the red color of the delete option is also checked as a second method. English is still the recommendation.
- **Only the person's own posts (#144):** before a delete, and before the check that precedes it, the post's author on the page must be the signed-in account (the engine sends its handle; case doesn't matter). Anyone else's post, or one whose author can't be read, is left alone without its menu being opened. So the red-color fallback can never pick another destructive option, such as Block, on someone else's post. A write command for an id that isn't an X id (digits only) is refused. The archive and GraphQL parsers drop such ids, and the deep clean never opens a page for one. A refusal is counted as skipped, not as a failure.

### F3. Intrusive popups · 📰 · ✅
- **Mechanism:** A Premium offer, cookie consent, a request to turn on notifications, or "Unlock more on X" may block the click.
- **Scenario (implemented, #29):**
  - On connecting, after each page load and before each action, a pop-up over the page (a dialog in X's `#layers`, or any `aria-modal` element; menus don't count) is closed: first with Escape and a click on its backdrop, then with its own Close button (`app-bar-close` or a button labeled Close). Nothing else in a pop-up is ever clicked, and each attempt is written to the activity log.
  - Never on X's login or check pages, which are pop-ups too, and never when the page shows a restriction notice (alerts, pop-ups and the top of the main column are read for it): that notice stops the job (C3, C4).
  - If the pop-up stays, the job waits for the person ("Needs you"): "Something on X's page is in the way, and Xomoni couldn't close it." It continues by itself once the page has been clear for 5 seconds.

### F4. queryId rotation and response structure changes · 📰 · ✅
- **Scenario:** Operations are identified by **name**, and the response parser does not depend on the exact structure.

### F5. Background tab slowdown or discard · 📘 · ✅
- **Current status:** Timers live in a Web Worker, so Chrome does not slow them down. If the X window is hidden, a warning is shown.
- **Scenario (implemented, #23):**
  - Every run calls `chrome.tabs.update(workerTab, { autoDiscardable: false })`, so Memory Saver leaves the X tab alone.
  - If Chrome unloads the tab anyway, Xomoni reloads it at once and continues, without counting a failure.
  - A worker page that stops answering, or takes more than 45 seconds to load, is waited out like an X outage (F6) instead of failing the job (#60).
- **Hidden window (implemented, #118):** Chrome doesn't run a hidden page's animations or rendering steps, so X's menus don't finish opening or closing and its timeline stops loading. macOS counts a window as hidden when it is minimized, completely covered by other windows (a maximized editor is enough), on another desktop, or behind a locked or sleeping screen. The pilot's first cleanup stopped as "X changed its page: Escape no longer closes X's menu" for this reason alone.
  - Before every page load and action, a hidden worker is a "Needs you" (`hidden`): "Keep part of it on screen". The job continues by itself once the window has been on screen for 5 seconds. It waits up to a day for the window, not an hour: waiting is no risk with X (#134).
  - **Keep going while the person is away (#134, setting on by default):** the display stays on while a job runs (`chrome.power`), so the X window stays on screen when the person steps away. When the job waits for a hidden window and nobody has touched keyboard or mouse for 2 minutes on an unlocked screen (`chrome.idle`), the X window is brought forward and the job continues: at most every 5 minutes, and never for what X asks of the person (login, checks). A locked screen shows no window, so the job waits.
  - The worker window opens in front (#120): a window that opens behind a maximized one stays hidden on macOS until it has been on screen once. It is a small popup without tabs (500 × 760, the bottom-right corner, #138), so it stays out of the person's way and their own tabs never land in it: in the pilot, Google searches opened in the worker window hid its X tab and stalled the job. At 500 px X keeps its desktop layout; below that its menus change.
  - **Run hidden (#140, [ADR-0020](adr/0020-run-hidden-by-sharing-the-x-tab.md)):** Chrome renders a tab that is being shared as if it were on screen, even when its window is minimized or covered. **Run hidden** on the dashboard opens Chrome's picker. The person shares the X tab with the dashboard, and the job keeps going with the X window minimized. The picker offers tabs only, with no audio. A window that is chosen is stopped at once. The frames, one tiny frame a second, are never read, stored or sent. Sharing stops when the job ends, at Chrome's "Stop sharing", and when the job still waits for a hidden window 15 s later, which means another tab was shared. `chrome.tabCapture` would need the extension invoked on the X tab itself.
  - **Not an iframe (#138):** x.com forbids being framed (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors` x.com/twitter.com only). Removing those headers would get around X's security (ADR-0003). A frame shows X that it is framed by an extension (`location.ancestorOrigins`), its cookies count as third-party, and a frame is paused when its tab is hidden, like a window.
  - A check before acting (F1) that fails while the window is hidden waits for the person instead of stopping the job, and an action that fails while it is hidden is not counted as failed.
  - Covering the window again and again never counts as X asking for the same thing (D1).

### F6. Internet outage, system sleep, X outage · 🧠 · ✅
- **Scenario (implemented, #23):** none of these says anything about the posts, so nothing is counted as failed and the post stays eligible.
  - **Offline (`navigator.onLine === false`):** no page is loaded; the status shows "Waiting for the internet connection", checked every 10 seconds. Back online, Xomoni waits 20–40 seconds and continues by itself.
  - **HTTP 5xx, or a request with no answer:** for a write or for the page's own timeline request, wait with exponential backoff (1, 2, 4, 8, 16, then 30 minutes), then run the job's steps again; everything already handled is skipped. The request still counts against X's quota (ADR-0012).
  - X's error page after such an answer never marks a post as gone.
  - After three hours with no progress, the job pauses.

### F7. System clock skew · 🧠 · ✅
- **Risk:** The `x-rate-limit-reset` time is in X's server time. If the system clock is a few minutes ahead, Xomoni would think X's window had reset and act before X's real reset; if it is behind, it only waits longer.
- **Scenario (implemented, #31):** the interceptor also passes on each response's `date` header (X's clock). `resetAtFrom` in `content/net.ts` moves every reset later by as much as this computer's clock runs ahead of X's, for the live limits it stores and for the reset of a rate-limited action alike. A clock running behind is left alone, because waiting a little longer is safe. Without a usable `date` header the reset is used as X sent it.

### F8. Concurrent runs and parallel use of X · 🧠 · ✅
- **Scenario:**
  - A Web Lock ensures that only one dashboard runs the job.
  - Quota headers are read from **all** x.com tabs. So if the user uses X at the same time, their usage is included in the calculation too.

---

## 7. Xomoni risk ladder (implemented, ADR-0013)

| Level | What triggers it | Response | Return to level 0 |
|---|---|---|---|
| **0 Normal** | — | Configured speed, with warm-up | — |
| **1 Caution** | 429 or 88, or 2 consecutive failures | Wait until reset, and slowdown factor ×1.6 | Through consecutive successes |
| **2 Retreat** | First 226, or two 429s within one hour | 6-hour stop, caps at 50% for 7 days | Automatically after 7 days without problems |
| **3 Defensive** | Lock or restriction (326, 403 on writes), or second 226 | Wait for the user, then wait 60 to 90 minutes, and 25% of caps for 48 hours | Step by step over 7 days |
| **4 Full stop** | Suspension (64), second lock within 7 days, third 226, or silent block | Stop with no automatic resume, with an explanation | Only by the user's informed decision |

The ladder is built from dated events per account (`apps/extension/src/shared/risk.ts`), shown on the dashboard with the reason and the time resume opens, and kept between jobs. Level 1 needs one rate limit in the last hour; failures in a row are handled by the failure limit (C3). "Resume anyway" past a lock or full stop needs a typed confirmation and keeps the pace at a quarter for 48 hours. Every level only slows Xomoni down (ADR-0012).

---

## 8. What Xomoni deliberately does not do

- Forge headers (`x-client-transaction-id`, `ct0`) or build requests directly
- Solve captchas or use a captcha-solving service
- Spoof the browser fingerprint, hide the `fetch` override, or create trusted events with `chrome.debugger`
- Use proxies, rotate IPs, or run several accounts at the same time
- Take or store passwords or session cookies
- Continue after X has explicitly said "stop"

**Reason:** Each of these means entering an "arms race" with X's anti-bot system. That race always ends in X's favor, and the consequences for the user are heavier: lock, suspension and loss of the account. The right way to delete your own content is to work **slowly, transparently and obediently**.

---

## 9. Implementation plan

### P0: Before the first test on a real account

| # | Task | Items | Files |
|---|---|---|---|
| 1 | Support for new data sources: archive warning, profile timeline sweep, "unseen posts" report | E2, C6 | `cleanup.ts`, `Cleanup.tsx` |
| 2 | Retry search after 429 instead of abandoning it | A5 | `cleanup.ts` |
| 3 | Risk ladder: Resume lock after 226, reduced caps, stop after the second lock | B1, C1, C2 | `context.ts`, `limiter.ts`, UI |
| 4 | Immediate stop on 64, 403 and "limited" codes; stop after 2 unknown write errors | C3, C4 | `actor.ts`, `context.ts` |
| 5 | Multi-day warm-up | B5 | `limiter.ts` |
| 6 | Recognize `/i/jf/` paths | D2 | `attention.ts` |
| 7 | Canary preflight test before the first deletion | F1 | `actor.ts`, `cleanup.ts` |
| 8 | Sample verification of deletions | C5 | `cleanup.ts` |
| 9 | Prevent tab discard, and a "waiting for internet" state | F5, F6 | `worker-tab.ts`, `context.ts` |

### P1: After the first test

| # | Task | Items |
|---|---|---|
| 1 | Adaptive learning of the daily read cap | A4 |
| 2 | ~~Close intrusive popups~~ (done, #29) | F3 |
| 3 | ~~Work in separate sessions, and log-normal delay~~ (done, #30) | B4 |
| 4 | ~~Compute clock offset from the `date` header~~ (done, #31) | F7 |
| 5 | Record unavailable posts as Skipped | E6 |
| 6 | Separate defaults for Premium | A6 |

### Operational rules (no code)

1. Install the extension in **your own everyday Chrome**, not in a test window.
2. Use your usual network, and do not switch VPN in the middle of a job.
3. Request the **archive first** (it takes 24 to 72 hours).
4. Run the first test in Careful mode with a small range, for example 50 old posts.
5. Set X's language to English.

---

## Sources

- [X — About X limits](https://help.x.com/en/rules-and-policies/x-limits) · [X Automation rules](https://help.x.com/en/rules-and-policies/x-automation)
- [Roboin — X search stops showing older posts (Aug 2026)](https://roboin.io/article/en/2026/08/09/why-x-search-is-not-showing-older-posts/) · [Roboin — posts not appearing in search](https://roboin.io/article/en/2025/10/11/why-your-posts-are-not-showing-up-in-x-search-and-how-to-fix-it/) · [Roboin — Latest tab (Apr 2026)](https://roboin.io/article/en/2026/04/13/how-to-fix-x-latest-tab-not-showing-posts-from-the-last-7-days/)
- [Roboin — error 226 (May 2026)](https://roboin.io/article/en/2026/05/18/why-you-cant-post-on-x-causes-and-fixes-for-request-flagged-as-automated/) · [twitterapi.io — error 226](https://twitterapi.io/blog/twitter-request-looks-like-it-might-be-automated-error-226)
- [emusks — Jetfuel login (`/i/jf/onboarding`)](https://code.lgbt/tiago/emusks/commit/5b3bdfebdd5737c81555a22db910ceec63b4b98e)
- [Postory — locked vs restricted](https://postory.io/blog/x-account-locked-vs-restricted) · [Circleboom — limited accounts](https://circleboom.com/blog/limited-twitter-account-how-to-spot-it-and-what-xs-countdown-means/) · [Factually — read-only limits](https://factually.co/fact-checks/technology/x-permanent-suspension-vs-temporary-read-only-limits-behavior-explained-298d2b)
- [Gulf News — 2023 reading limits](https://gulfnews.com/business/markets/twitter-users-encounter-rate-limit-exceeded-error-face-restricted-access-to-tweets-1.96721814) · [TweetDelete — reading limits](https://tweetdelete.net/resources/twitter-reading-limits-for-posts-can-you-bypass-xs-rules/)
- [Postory — search suggestion ban vs search ban](https://postory.io/blog/twitter-search-suggestion-ban)
- [Chrome — `tabs.autoDiscardable`](https://developer.chrome.com/docs/extensions/reference/api/tabs)

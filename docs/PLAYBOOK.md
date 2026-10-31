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
| A4 | "Posts read per day" cap | 📰 | 🟡 |
| A5 | Search and post-page quota | 📰 | ✅ |
| A6 | Different caps for Premium accounts | 📘📰 | 🟡 |
| B1 | Error 226 ("automated behavior") | 📰 | ✅ |
| B2 | Signed `x-client-transaction-id` header | 📰 | ✅ |
| B3 | Synthetic click detection (`isTrusted`) | 🧠 | ⚠️ |
| B4 | Analysis of action timing regularity | 🧠 | 🟡 |
| B5 | Sudden spike in work volume | 🧠 | 🟡 |
| B6 | Back-to-back like and unlike | 📘 | ✅ |
| B7 | In-page script detection | 🧠 | ⚠️ |
| B8 | Automated browser (webdriver, CDP, headless) | 📰 | ✅ |
| B9 | Device and network reputation | 📰 | 🟡 |
| C1 | Graduated penalty ladder | 📰 | ✅ |
| C2 | Account lock (326) and Arkose captcha | 📘📰 | ✅ |
| C3 | "Limited" or read-only account | 📰 | ✅ |
| C4 | Suspension (code 64) | 📘 | ✅ |
| C5 | Silent block (action is confirmed but not carried out) | 🧠 | 🔴 |
| C6 | Visibility limits and Search ban | 📰 | 🟡 |
| C7 | Ban on non-API automation in X's rules | 📘 | ⚠️ |
| D1 | Logout or session expiry | 📘 | ✅ |
| D2 | X's new login page (`/i/jf/…`) | 📰 | ✅ |
| D3 | 2FA, email/SMS code, login captcha | 📘 | ✅ |
| D4 | Account switch in another tab | 🧠 | ✅ |
| D5 | CSRF token rotation (`ct0`) | 📰 | ✅ |
| E1 | Cap of about 3,200 posts on the profile | 📰 | ✅ |
| E2 | **Search does not show old posts with no likes** | 📰 | 🔴 |
| E3 | Incomplete or delayed search index | 📘 | ✅ |
| E4 | Likes timeline depth and "ghost" likes | 📰 | ✅ |
| E5 | Temporary display of deleted content | 🧠 | ✅ |
| E6 | Original post unavailable (repost or like) | 🧠 | 🟡 |
| E7 | Edited posts (multiple IDs) | 📘 | ✅ |
| E8 | Archive retrieval limits | 📘 | ✅ |
| F1 | DOM changes and A/B tests | 🧠 | ✅ |
| F2 | X interface language | 📘 | ✅ |
| F3 | Intrusive popups (Premium, cookies, notifications) | 📰 | 🟡 |
| F4 | queryId rotation and response structure changes | 📰 | ✅ |
| F5 | Background tab slowdown or discard | 📘 | ✅ |
| F6 | Internet outage, system sleep, X outage | 🧠 | ✅ |
| F7 | System clock skew | 🧠 | 🔴 |
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

### A4. "Posts read per day" cap · 📰 · 🟡
- **X mechanism:** In July 2023 these caps were announced: about 1,000 posts per day for an unverified account, about 500 for a new account, and about 10,000 for Premium. Whether they still apply in 2026 is **unknown**. The error message is "Rate limit exceeded".
- **Current status:** Xomoni only counts page loads (Careful: 400 per hour and 4,000 per day). It does not count the posts seen.
- **Proposed scenario (adaptive learning):**
  1. Count "posts rendered in the last 24 hours".
  2. If a 429 error arrives on a read operation and the headers do not explain it, Xomoni assumes it is the "daily view cap". It records the current count V and sets its daily read cap to 0.8×V.
  3. Wait until the 24-hour window clears.
  4. The learned cap is stored for that account.

### A5. Search and post-page quota · 📰 · ✅
- **X mechanism:** Search and the post page have separate quotas. The search quota is low, on the order of a few dozen requests per 15 minutes.
- **Scenario (implemented, #16):**
  - If a sweep page fails and X answered its requests with a 429 (or nothing remaining), Xomoni records the rate limit on the risk ladder, waits for X's reset plus 30–90 seconds, and loads **the same page** again, up to 3 times. After that it pauses the job; it never falls back to the deep clean for a quota error, because the deep clean opens each post separately and is much more expensive.
  - The risk ladder is stricter still: a second rate limit within an hour stops the job (§7).
  - A page that fails for another reason is tried again after 1–2 minutes. Only after 3 failed loads does Xomoni continue with the inventory (deep clean).

### A6. Different Premium caps · 📘📰 · 🟡
- **Proposed scenario:** Xomoni detects the account type from the profile response (`is_blue_verified`). Defaults always stay conservative. For an unverified account, a lower read cap is suggested. For Premium, Balanced mode is only **allowed**.

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

### B4. Timing regularity analysis · 🧠 · 🟡
- **Current status:** Uniform random delay, rest between batches, and optional active hours.
- **Proposed scenario (work in separate sessions):**
  - Each work session lasts 25 to 50 minutes, followed by 10 to 30 minutes of rest.
  - Log-normal delay distribution, and with 5% probability a pause of 30 to 90 seconds.
  - The goal is not to statistically imitate a human. The goal is to spread the load across the day and keep the hourly work volume low.

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
  - X's "temporarily limited" or "restricted" notice on the page (alerts and the top of the main column) stops the job before any action. The match is deliberately broad; a false match only stops the job.
  - Unknown failures in a row pause the job after **2** (the setting is capped at 3, was 5).
  - Not done: reading X's countdown from the banner.

### C4. Suspension (code 64) · 📘 · ✅
- **Scenario (implemented, #18):** code 64 → outcome `suspended`: stop immediately with a clear message, no waiting for the person (they can't fix it) and no automatic resume. Code 326 (a lock the person can clear) still waits for them.

### C5. Silent block · 🧠 · 🔴
- **Possible mechanism:** X returns a success response but does not actually carry out the action (soft block).
- **Proposed scenario (sample verification):**
  1. Out of roughly every 25 deletions, one is picked at random.
  2. 10 to 30 minutes later, that post's page is opened. We expect to see "not found" (code 144).
  3. If the post still exists, stop immediately with the message "X is silently not applying deletions".

  The cost is about 4% extra reads.

### C6. Visibility limits and Search ban · 📰 · 🟡
- **X mechanism:** X may remove the account's posts from search. In that case a `from:` search comes back empty.
- **Risk:** Xomoni thinks "no posts are left", while the posts still exist.
- **Proposed scenario:**
  - If search is empty but the inventory (archive or profile) still has matching posts, show a "search finds nothing" warning.
  - The automatic method switches to deep clean and the profile timeline (the same solution as E2).

### C7. Ban on non-API automation in X's rules · 📘 · ⚠️
- **Rule:** "Non-API automation, such as scripting the X website" is prohibited and may lead to suspension.
- **Management:**
  - A clear warning in the README and when a job starts.
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

### E2. Search does not show old posts with no likes · 📰 · 🔴 · **Most important item**
- **X mechanism:** An independent report from August 2026 (with tests) says that posts **older than 7 days** with **zero likes** no longer appear in search results. The Help Center also says that posts older than one week may not appear in search because of indexing limits.
- **Risk:** Finding old posts in Xomoni relies mainly on search. A large share of old posts and replies have zero likes, and **search does not find them at all**. The "Full history" scan, which relies on search, also stays incomplete.
- **Proposed scenario (three sources, in order):**
  1. **Archive, the primary source:** The archive is complete. On the Cleanup page, if no archive has been imported, a serious warning is shown.
  2. **Profile timeline:** The profile (`/handle` and `/handle/with_replies`) shows all posts regardless of likes, up to about 3,200 posts. If the account has fewer than 3,200 posts, Xomoni uses this path first.
  3. **Search:** for older posts that have likes.
  4. **Deep clean:** anything that is in the archive and has not been found yet is opened and deleted one by one.
  5. **Final report:** "X has about N more posts that Xomoni cannot see. Get your archive." This number comes from comparing `postsCount` with the inventory.

### E3. Incomplete or delayed search index · 📘 · ✅
- **Scenario:** Deep clean with the archive fills this gap.

### E4. Likes timeline depth and "ghost" likes · 📰 · ✅
- **Scenario:** Old likes are read from the archive. For likes that X no longer shows as "liked", the Ghost likes option (like again, then unlike) is off by default and comes with a warning.

### E5. Temporary display of deleted content · 🧠 · ✅
- **Scenario:**
  - A "not found" response (code 144) moves the item to the `gone` status and does not count as a failure.
  - A deleted post counts as "present" again only if it is seen on X again more than 5 seconds after the deletion.

### E6. Original post unavailable · 🧠 · 🟡
- **Mechanism:** Sometimes a repost or like belongs to a post whose account is suspended, private or deleted. In that case the undo or unlike button may not be shown at all.
- **Current problem:** Such an item counts as Failed. 5 in a row means a stop for no reason.
- **Proposed scenario:** Record these items as Skipped ("unavailable on X"), not Failed, and count them separately in the report.

### E7. Edited posts · 📘 · ✅
- **Scenario:** Deleting the latest version deletes the whole post. Older IDs in the archive get "not found" and are skipped.

### E8. Archive retrieval limits · 📘 · ✅
- **Scenario:** The archive takes 24 to 72 hours to be ready. The guide recommends that you get the **archive first**. Xomoni also checks that the archive belongs to this same account.

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

### F2. X interface language · 📘 · ✅
- **Scenario:** The Delete label is recognized in 23 languages (including Persian), and the red color of the delete option is also checked as a second method. English is still the recommendation.

### F3. Intrusive popups · 📰 · 🟡
- **Mechanism:** A Premium offer, cookie consent, a request to turn on notifications, or "Unlock more on X" may block the click.
- **Proposed scenario:**
  - Before each action, if a `[role=dialog]` or mask that does not belong to Xomoni is present, press Escape or the close button.
  - If the popup stays, set the "Needs you" status with the message "Something on the X page is in the way".

### F4. queryId rotation and response structure changes · 📰 · ✅
- **Scenario:** Operations are identified by **name**, and the response parser does not depend on the exact structure.

### F5. Background tab slowdown or discard · 📘 · ✅
- **Current status:** Timers live in a Web Worker, so Chrome does not slow them down. If the X window is hidden, a warning is shown.
- **Scenario (implemented, #23):**
  - Every run calls `chrome.tabs.update(workerTab, { autoDiscardable: false })`, so Memory Saver leaves the X tab alone.
  - If Chrome unloads the tab anyway, Xomoni reloads it at once and continues, without counting a failure.
  - A worker page that stops answering, or takes more than 45 seconds to load, is waited out like an X outage (F6) instead of failing the job (#60).

### F6. Internet outage, system sleep, X outage · 🧠 · ✅
- **Scenario (implemented, #23):** none of these says anything about the posts, so nothing is counted as failed and the post stays eligible.
  - **Offline (`navigator.onLine === false`):** no page is loaded; the status shows "Waiting for the internet connection", checked every 10 seconds. Back online, Xomoni waits 20–40 seconds and continues by itself.
  - **HTTP 5xx, or a request with no answer:** for a write or for the page's own timeline request, wait with exponential backoff (1, 2, 4, 8, 16, then 30 minutes), then run the job's steps again; everything already handled is skipped. The request still counts against X's quota (ADR-0012).
  - X's error page after such an answer never marks a post as gone.
  - After three hours with no progress, the job pauses.

### F7. System clock skew · 🧠 · 🔴
- **Risk:** The `x-rate-limit-reset` time is in X's server time. If the system clock is a few minutes ahead or behind, the wait time is computed wrong.
- **Proposed scenario:** Compute the clock offset from the `date` header of X's response, and apply it to all reset times.

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
| 2 | Close intrusive popups | F3 |
| 3 | Work in separate sessions, and log-normal delay | B4 |
| 4 | Compute clock offset from the `date` header | F7 |
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

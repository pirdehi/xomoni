<div align="center">

<img src="public/icons/icon128.png" width="72" alt="Xomoni logo" />

# Xomoni

**Clean up your own X (Twitter) account — old posts, replies, reposts and likes — from a local dashboard. No API keys. Paced to stay within X's limits.**

[![CI](https://github.com/pirdehi/xomoni/actions/workflows/ci.yml/badge.svg)](https://github.com/pirdehi/xomoni/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3%20·%20116%2B-4285F4?logo=googlechrome&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)

[فارسی](README.fa.md) · [Roadmap](docs/ROADMAP.md) · [Architecture](docs/ARCHITECTURE.md) · [Research notes](docs/RESEARCH.md) · [Report a bug](https://github.com/pirdehi/xomoni/issues)

<img src="docs/screenshots/overview.png" alt="Xomoni dashboard overview" width="900" />

</div>

---

## Why Xomoni

Deleting years of posts on X is harder than it should be:

- **The official API is expensive and slow for this.** It is pay-per-use, and deleting a post through it is limited to 50 requests per 15 minutes.
- **Scripts that call X's internal API break all the time.** X now requires a signed, single-use anti-bot header (`x-client-transaction-id`) on more and more requests. Tools that build their own requests keep failing.
- **Copy-paste console scripts get accounts flagged.** They ignore X's limits and keep going after X has asked them to stop.

Xomoni takes a different approach. It is a Chrome extension that works **inside your own logged-in X tab** and clicks the same buttons you would. X's own web app sends every request, with all its headers. Xomoni only *reads* X's responses, to confirm each action and to watch the rate-limit headers X returns.

## Features

- **Bulk cleanup by date:** delete posts, replies, reposts or likes older than a given date, or between two dates.
- **Keep rules:** spare posts with at least N likes, posts containing given keywords, specific links you paste, and replies in your own threads.
- **Preview before acting:** see exactly what matches, an estimated duration at your pacing, a JSON backup download, and a typed `DELETE` confirmation.
- **Reaches past the ~3,200 profile limit:** sweeps X search (`from:you until:date`) in pages and imports your official X archive.
- **Login and 2FA hand-off:** when X needs you (login, 2FA, captcha, email code, account unlock, wrong account), the job pauses, sends you a desktop notification, waits while you complete it in the X window, then **continues by itself**. Xomoni never asks for or stores your password.
- **Resumable jobs:** pause, close the browser, and resume later without losing progress.
- **Archive a date range:** pick the dates, let Xomoni read them from X (read-only, at the same careful pace), and download your posts, replies and reposts from that range as a page you can open in any browser, or as JSON. It is saved on your computer only. Your official X archive stays the complete copy, with media.
- **Dashboard:** removal stats, a year-by-year chart, live limits and pacing, a jobs list, a searchable inventory, and an exportable activity log. Light and dark themes.
- **Private by design:** no server and no telemetry. Everything stays in IndexedDB in your browser profile.

| Cleanup wizard | Settings (dark) |
|---|---|
| <img src="docs/screenshots/cleanup.png" alt="Cleanup wizard" /> | <img src="docs/screenshots/settings-dark.png" alt="Settings in dark mode" /> |

## How it works

```mermaid
flowchart LR
    D["Dashboard<br/>(extension page)<br/>runner · limiter · rules"] -- "one command at a time" --> C["Content script<br/>in your x.com tab<br/>clicks X's buttons"]
    C -- "click" --> X["X web app<br/>sends the request<br/>with its own headers"]
    X -- "GraphQL response<br/>+ rate-limit headers" --> I["Interceptor<br/>(read-only)"]
    I -- "confirmed / error code" --> C
    C -- "result" --> D
    I -- "posts seen" --> S["Service worker<br/>IndexedDB inventory"]
```

1. **Inventory.** Xomoni learns what is on your account from your X archive and from the timelines it loads.
2. **Sweep.** For each rule it opens an X search (or your profile or likes page), then deletes or unlikes matching posts in place.
3. **Deep clean.** Whatever still matches (usually archive-only items) is visited one by one. Each post's page is checked against the rule again before acting.
4. **Confirm.** A post counts as removed only when X's response confirms it.

If Xomoni cannot verify an item, it leaves the item alone.

## Working within X's limits

**Xomoni uses at most one fifth of every limit X announces** ([ADR-0012](docs/adr/0012-one-fifth-of-every-x-limit.md)): one fifth of the limits X publishes, and one fifth of the live limits X reports while you use it.

| Mechanism | What Xomoni does |
|---|---|
| Pacing | Varied delays between actions, longer breaks between batches, a 10–30 minute rest after every 25–50 minutes of work, and rolling caps. X publishes 50 deletes per 15 minutes, so Xomoni does at most 10 (80–120 s apart, at most 40 an hour); unlikes are also capped at 200 a day, one fifth of X's 1,000. Custom settings can be slower, never faster. A new account starts lower still (warm-up: a quarter of that pace on day one, full one fifth from the fourth active day). |
| X's rate-limit headers | Reads `x-rate-limit-limit / remaining / reset` from X's own responses and waits for the reset once one fifth of the window is used. |
| HTTP 429 / code 88 | Waits until the window resets, then slows down (adaptive back-off). |
| Code 185 / 344 (daily limit) | Waits about 24 hours. |
| Code 226 ("looks automated") | **Stops the job.** You resume it after using X normally for a while. |
| Logout, 2FA, captcha, lock (326) | **Waits for you**, with a desktop notification. After an X check it eases back in at a slower pace. |
| 5 failures in a row | Pauses. X may have changed its page. |
| Active hours | On by default, 8:00–23:00 local time, so work never runs all night. You can change the hours or turn them off. |

The full research behind these choices (in Persian) is in [docs/RESEARCH.md](docs/RESEARCH.md). It covers X's limits, anti-automation signals, a comparison of approaches, and sources.

## Before you start: the risks

The extension shows this text once for each X account and asks you to type `I UNDERSTAND` before the first job. It is also at [xomoni.com/risks](https://xomoni.com/risks).

<!-- consent:start -->
Xomoni deletes posts, replies, reposts and likes on your X account by clicking X’s own buttons in a normal browser tab. Read this once for each X account, before its first job.

**X’s rules forbid this kind of automation.** X prohibits non-API automation, such as scripting the X website. X can limit, lock or suspend an account that breaks its rules. [Read X’s automation rules](https://help.x.com/en/rules-and-policies/x-automation).

**The risk can’t be removed.** Xomoni keeps the risk low: it never uses more than one fifth of any limit X announces, starts slower than that, and stops at X’s first warning. It can’t make the risk zero. Only X decides what happens to your account.

**A research project, at your own risk.** Xomoni is open-source research into ways to clean up your own X account through X’s website. It comes with no guarantee that X won’t limit, lock or suspend your account. You use it at your own risk, and the consequences for your X account are yours.

**Deletions are permanent.** A deleted post, an undone repost or a removed like can’t be brought back, by Xomoni or by X.

**Download your archive first.** Before you delete anything, request your X archive (on X: Settings, Your account, Download an archive of your data). It is your only copy, and Xomoni can read it to find your oldest posts.

**What Xomoni never does.**

- Ask for, store or read your X password or cookies.
- Send your posts, likes or anything else from X to any server.
- Forge requests, solve captchas, use proxies or hide that it is automation.
- Use more than one fifth of any limit X announces.
- Start, resume or approve deletions from the website.

If you go ahead, you do so for this X account, knowing these risks and accepting them as your own.
<!-- consent:end -->

## Install

Xomoni isn't on the Chrome Web Store yet. The [install guide on xomoni.com](https://xomoni.com/install) walks through it:

1. Download [`xomoni-extension.zip`](https://github.com/pirdehi/xomoni/releases/latest/download/xomoni-extension.zip) from the [latest release](https://github.com/pirdehi/xomoni/releases/latest) (each release lists its SHA-256 checksums) and unzip it into a folder you keep.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select that folder.
3. Click the Xomoni icon in the toolbar to open the dashboard.

### Or build it from source

**Requirements:** Node.js 20.19+ and Chrome, Edge or Brave version 116 or later.

```bash
git clone https://github.com/pirdehi/xomoni.git
cd xomoni
npm install
npm run build -w @xomoni/extension
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `apps/extension/dist` folder.
3. Click the Xomoni icon in the toolbar to open the dashboard.

On macOS, allow notifications for your browser in *System Settings → Notifications* so you see the login and 2FA alerts.

## Usage

1. **Connect.** In the dashboard, click **Open X worker**. A normal x.com window opens. Log in there as usual, including 2FA, and Xomoni detects your account.
2. **Import your archive (recommended).** In X, go to *Settings → Your account → Download an archive of your data*. When it arrives, open **Inventory** and select the archive's `data` folder. Only `account.js`, `tweets.js` and `like.js` are read, and Xomoni checks that the archive belongs to the connected account.
3. **Or scan.** **Inventory** can also scan your posts, replies, likes, or your full history from X.
4. **Clean up.** In **Cleanup**:
   1. Pick a type, a date and keep rules.
   2. Review the matches and download a backup.
   3. Type `DELETE` to start.
5. **Watch.** **Overview** and **Jobs** show progress, time remaining, X's reported limits and a live log. Pause or resume any time.

**Tips**

- Start with the **Careful** preset and a small range, for example older than 2 years. Check the log, then widen the range.
- Keep the dashboard tab and the X window open and not minimized while a job runs.
- Set X's display language to English for the most reliable results.
- If a job stops with error 226, wait a few hours, use X normally, then resume with Careful pacing.
- **Ghost likes:** X stops showing some very old likes as liked. Removing them means liking and then unliking, which can notify the author. This option is off by default.

## Development

This repository is an npm workspaces monorepo:

```
apps/extension/   the Chrome extension (MV3): engine, X page scripts, dashboard UI
apps/web/         xomoni.com (Next.js): landing page, sign-in, live job status
packages/db/      typed contract of the Supabase database, generated from the migrations
supabase/         database migrations, auth config and email templates (config as code)
docs/             architecture, decision records, safety playbook, research
tooling/          repository checks: documentation gate, verify runner, git hooks
```

How the parts fit together, the layer rules and the documentation rules are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Every app, package and module has its own README.

| Command | What it does |
|---|---|
| `npm run build -w @xomoni/extension` | Builds the extension into `apps/extension/dist/` |
| `npm run watch -w @xomoni/extension` | Rebuilds on change. Reload the extension in `chrome://extensions` after each build. |
| `npm run preview:ui -w @xomoni/extension` | Opens the dashboard with demo data in a normal browser tab, without connecting to X |
| `npm run dev -w @xomoni/web` | Runs xomoni.com locally (see [apps/web/README.md](apps/web/README.md)) |
| `npm run verify` | Everything CI checks: formatting, lint and code docs, types, architecture rules, documentation, unit tests |

`npm run verify` also runs automatically before every `git push`.

**Stack:** TypeScript, React 19, Tailwind CSS 4, Dexie (IndexedDB), Vite and esbuild for the extension; Next.js 16, Supabase and Vercel for the website; Vitest, ESLint, Prettier and dependency-cruiser for quality.

## Project status

Xomoni is an early release (v0.1). The full flow has been tested end to end against a local replica of x.com: deleting, unliking, safety stops, keep rules, and the login and 2FA hand-off. X changes its web app often, so selectors may need updating. If something stops working, [open an issue](https://github.com/pirdehi/xomoni/issues) with the activity log line.

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; `npm run verify` must pass. Keep the core rules intact (the full list is in [docs/PLAYBOOK.md](docs/PLAYBOOK.md)):

- Never forge X's headers.
- Never solve captchas.
- Never read passwords or session cookies.
- Never act on an item you can't verify.

## Disclaimer

Xomoni is an independent open-source research project. It is not affiliated with, endorsed by, or sponsored by X Corp. Automating actions on X's website may be against [X's automation rules](https://help.x.com/en/rules-and-policies/x-automation) and can lead to account restrictions. Xomoni is designed to reduce that risk, but it can't remove it, and it comes with no guarantee. Deletions can't be undone, so download your archive first. You use Xomoni at your own risk, and the consequences for your X account are your responsibility.

## Author

**Omid Pirdehi** · [github.com/pirdehi](https://github.com/pirdehi)

## License

[MIT](LICENSE) © 2026 Omid Pirdehi

# `modules/dashboard`: devices and live job status

Shows the signed-in person which browsers have the extension connected and how their jobs are doing, updating live: jobs that need the person come first (*Needs you*), then each X account's risk level (#41). It is read-only toward X: the only change it can make is disconnecting a device ([ADR-0006](../../../../../docs/adr/0006-website-is-view-only.md)).

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| `domain/` | `model.ts`, `job-status.ts`, `risk.ts` | `Device`, `JobSummary`, `DashboardSnapshot`; state labels and tones (same wording as the extension), progress, online window, relative time, newest-first upsert; risk level names and meanings (the extension's names, checked by a test), each account's level per browser from its latest job, and the jobs that need the person. Pure. |
| `application/` | `ports.ts`, `load-dashboard.ts` | Ports `DashboardReader`, `DeviceRegistry`, `LiveFeed`; loading the first snapshot. |
| `infrastructure/` | `supabase-dashboard.ts` | Adapters on PostgREST and Realtime; maps database rows to the domain model. |
| `server/` | `load.ts` | Loads the first snapshot on the server (`server-only`). |
| `client/` | `live.ts` | Browser composition root: the same ports on the browser Supabase client. |
| `ui/` | `dashboard.tsx`, `use-live-dashboard.ts` | The dashboard view and the hook that keeps it live (re-reads after reconnects and when the tab becomes visible). |

## Data flow

1. `app/dashboard/page.tsx` calls `requireViewer()` (auth module) and `loadDashboardSnapshot()`.
2. The page renders `<Dashboard initial={snapshot}>`.
3. `useLiveDashboard` subscribes to Realtime changes filtered by the user's id. Realtime and PostgREST both enforce Row Level Security.
4. *Needs you* and *X accounts* are derived from the jobs on every change, so they update live too. An account appears only once a job reported its level; the level is per browser, because each browser's extension keeps its own risk ladder.

## Used by

- `app/dashboard/page.tsx`.

# `modules/dashboard`: devices and live job status

Shows the signed-in person which browsers have the extension connected and how their jobs are doing, updating live. It is read-only toward X: the only change it can make is disconnecting a device ([ADR-0006](../../../../../docs/adr/0006-website-is-view-only.md)).

## Layers

| Layer | Files | Responsibility |
| --- | --- | --- |
| `domain/` | `model.ts`, `job-status.ts` | `Device`, `JobSummary`, `DashboardSnapshot`; state labels and tones (same wording as the extension), progress, online window, relative time, newest-first upsert. Pure. |
| `application/` | `ports.ts`, `load-dashboard.ts` | Ports `DashboardReader`, `DeviceRegistry`, `LiveFeed`; loading the first snapshot. |
| `infrastructure/` | `supabase-dashboard.ts` | Adapters on PostgREST and Realtime; maps database rows to the domain model. |
| `server/` | `load.ts` | Loads the first snapshot on the server (`server-only`). |
| `client/` | `live.ts` | Browser composition root: the same ports on the browser Supabase client. |
| `ui/` | `dashboard.tsx`, `use-live-dashboard.ts` | The dashboard view and the hook that keeps it live (re-reads after reconnects and when the tab becomes visible). |

## Data flow

1. `app/dashboard/page.tsx` calls `requireViewer()` (auth module) and `loadDashboardSnapshot()`.
2. The page renders `<Dashboard initial={snapshot}>`.
3. `useLiveDashboard` subscribes to Realtime changes filtered by the user's id. Realtime and PostgREST both enforce Row Level Security.

## Used by

- `app/dashboard/page.tsx`.

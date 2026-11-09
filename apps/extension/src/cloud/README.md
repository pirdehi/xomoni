# `src/cloud`: job status for xomoni.com

Connects this browser to a xomoni.com account and keeps the website's dashboard up to date while the extension's dashboard is open ([ADR-0018](../../../../docs/adr/0018-pair-the-extension-with-a-one-time-code.md)). It sends **job status only**: Xomoni's own job titles, states, phases, counters, timestamps and each account's risk level. Never post text, likes, the inventory or X's notices ([ADR-0004](../../../../docs/adr/0004-x-data-stays-local.md)). It never acts on X, and nothing it receives can start work.

| File            | Responsibility                                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.ts`     | The public Supabase URL and publishable key (the same ones the website ships), and the page where codes are made.                                                                                                                                                                                                                                                       |
| `client.ts`     | `pairDevice`, `reportStatus`, `unpairDevice`: the three functions a device may call, as `fetch` to PostgREST with no session; `CloudError` with a reason (`bad_code`, `device_limit`, `unknown_device`, `unreachable`, `refused`).                                                                                                                                      |
| `summary.ts`    | `jobReport`: one job as the website stores it, with the reason always empty. Pure. Watch jobs (#158) are never reported: they only read and never end, and the `jobs` table doesn't allow their kind. Nor are archive jobs (#186), which only handle X's archive (ADR-0004).                                                                                                                                                                   |
| `connection.ts` | The device id and token in the extension's IndexedDB (`kv`, key `cloud`), where content scripts can't reach them (#151); an older copy in `chrome.storage.local` is moved on first read. `watchConnection` for the UI.                                                                                                                                                  |
| `release.ts`    | The newest release, from `device_report`'s answer (#151): `parseReleaseNews`, `isNewer` (numbers, so 0.10.0 follows 0.9.0), and the notice the dashboard shows, which can be dismissed unless the release fixes a vulnerability.                                                                                                                                        |
| `sync.ts`       | `connect` (trade a code; nothing is reported until `confirmConnection`, which then reports the newest 50 jobs), `disconnect`, `syncOnce` (heartbeat plus jobs updated since the last report, 50 at a time) and `startCloudSync` (a report a few seconds after a job changes, and at least every 5 minutes). The person confirms the account pairing named first (#149). |

## Depends on

- `../shared/` only (rule `ext-cloud-is-isolated`): the database, the risk ladder and the JSON readers.
- `fetch`, `chrome.runtime.getManifest`, and `chrome.storage.local` only to move a connection an earlier version kept there.

## Used by

- `../ui/`: the Settings card that connects and disconnects, and the app shell, which starts the sync. The engine never imports it, so a run on X never waits on the network to xomoni.com.

## Tests

- `../../tests/cloud.test.ts`: the client's requests and error reasons, the job report (no reason, valid handles only), the stored connection (in IndexedDB, moved from `chrome.storage.local`), connecting, reporting changes once, heartbeats, disconnection by the website, and a disconnect the website couldn't be told about (`FORGOTTEN_HERE`, #151).
- `../../tests/ui/cloud-card.test.tsx`: connecting and disconnecting from Settings, and the refused-code message.

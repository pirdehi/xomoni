// What a one-click update (#305, ADR-0033) leaves for the Xomoni that starts after it. The dashboard writes the new
// version into Xomoni's folder, records it here, then reloads the extension. Chrome closes the dashboard when it
// reloads, so the service worker opens it again (only after such an update, never after one made by hand), and the
// dashboard says whether the new version is the one running. It lives in the kernel because both read it.
import { db, kvGet, kvSet } from './db';
import { asNumber, asObject } from './json';
import { isVersion } from './version';

/** The `kv` key of the record. */
export const UPDATE_RECORD_KEY = 'updateApplied';

/** How long after an update the service worker still reopens the dashboard for it. */
export const REOPEN_WITHIN_MS = 10 * 60 * 1000;

/** One update written to the folder: from which version, to which, and when (epoch ms). */
export interface UpdateRecord {
  from: string;
  to: string;
  at: number;
}

/** `value` as an update record, or null when it isn't one. */
function asRecord(value: unknown): UpdateRecord | null {
  const record = asObject(value);
  const at = asNumber(record?.at);
  if (!record || !isVersion(record.from) || !isVersion(record.to) || at === undefined) return null;
  return { from: record.from, to: record.to, at };
}

/** Remembers an update just written, right before the extension reloads. */
export function recordUpdate(record: UpdateRecord): Promise<void> {
  return kvSet(UPDATE_RECORD_KEY, record);
}

/**
 * The update written in the last `REOPEN_WITHIN_MS`, or null. The service worker asks when Chrome says the extension
 * was updated, and reopens the dashboard only then. It leaves the record for the dashboard.
 */
export async function recentUpdate(now = Date.now()): Promise<UpdateRecord | null> {
  const record = asRecord(await kvGet<unknown>(UPDATE_RECORD_KEY, null));
  return record && now - record.at >= 0 && now - record.at <= REOPEN_WITHIN_MS ? record : null;
}

/**
 * The update recorded before the reload, once: it is forgotten as it is read, in one transaction, so only one
 * dashboard tab reports it.
 */
export function takeUpdateRecord(): Promise<UpdateRecord | null> {
  return db.transaction('rw', db.kv, async () => {
    const row = await db.kv.get(UPDATE_RECORD_KEY);
    if (row) await db.kv.delete(UPDATE_RECORD_KEY);
    return asRecord(row?.value);
  });
}

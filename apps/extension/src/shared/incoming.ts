// Replies other people wrote to the person's posts (#256, ADR-0030): read from what X already sent to a page, kept on
// this computer for at most 90 days and 5,000 per X account, and never acted on. Only the Comments place on
// xomoni.com, in the same browser, reads them (ADR-0028).
import { db } from './db';
import type { IncomingDraft, IncomingReply } from './types';

/** How many days of replies Xomoni keeps, by when they were posted. */
export const INCOMING_KEEP_DAYS = 90;

/** The most replies Xomoni keeps for one X account: the newest. */
export const INCOMING_MAX = 5_000;

/** The longest text kept for a reply. */
export const INCOMING_TEXT = 1_000;

const DAY_MS = 86_400_000;

/** The oldest time a kept reply may have been posted at `now`. */
export const incomingSince = (now: number) => now - INCOMING_KEEP_DAYS * DAY_MS;

/** Primary key of a reply in the `incoming` table. */
export const incomingKey = (accountId: string, id: string) => `${accountId}:${id}`;

/**
 * Keeps `drafts` for `accountId`, then drops its replies posted more than `INCOMING_KEEP_DAYS` ago and all but the
 * newest `INCOMING_MAX`, in one transaction. A reply seen again replaces what was kept of it.
 */
export async function saveIncoming(accountId: string, drafts: readonly IncomingDraft[], now = Date.now()) {
  const since = incomingSince(now);
  const rows: IncomingReply[] = drafts
    .filter((d) => d.createdAt >= since)
    .map((d) => ({ ...d, text: d.text.slice(0, INCOMING_TEXT), key: incomingKey(accountId, d.id), accountId }));
  await db.transaction('rw', db.incoming, async () => {
    if (rows.length) await db.incoming.bulkPut(rows);
    await trimIncoming(accountId, now);
  });
}

/**
 * Drops `accountId`'s replies posted more than `INCOMING_KEEP_DAYS` before `now` and all but the newest
 * `INCOMING_MAX`: the limits of ADR-0030, applied after every save and after a move brings replies in (ADR-0032).
 */
export async function trimIncoming(accountId: string, now = Date.now()) {
  const since = incomingSince(now);
  await db.transaction('rw', db.incoming, async () => {
    const byTime = () => db.incoming.where('[accountId+createdAt]');
    await byTime().between([accountId, -Infinity], [accountId, since], true, false).delete();
    const kept = byTime().between([accountId, since], [accountId, Infinity], true, true);
    const extra = (await kept.count()) - INCOMING_MAX;
    if (extra > 0) await db.incoming.bulkDelete(await kept.limit(extra).primaryKeys());
  });
}

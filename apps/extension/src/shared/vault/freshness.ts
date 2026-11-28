// How fresh each of X's files in the vault is, and the local reminder when one is due (#425, ADR-0043, decision 9).
// Each source has a cadence: X's archive every 30 days, the analytics export every 60 (X keeps about 90 days of it).
// When one is due, Xomoni reminds the person at most once a day per account, within active hours, with the desktop
// notifications it already has: no `alarms` permission, no new permission at all. *Not now* snoozes it for 7 days, and
// a switch in Settings turns it off. A reminder never starts anything, opens X or sends anything.
import { localDay } from '../daily';
import { getSettings, kvGet, kvSet } from '../db';
import { vaultNotificationId } from '../notification-ids';
import { getSignedOut } from '../session';
import { withinActiveHours } from '../settings';
import { importLedger } from './db';
import type { VaultImport, VaultSource } from './types';

/** How fresh a source is: never imported, fresh, due for a new copy, or overdue (past its grace). */
export type Freshness = 'never' | 'fresh' | 'due' | 'overdue';

/** A kind of X's files the reminder follows: how often it is worth a new copy, and when the last one is from. */
export interface FreshnessSource {
  readonly source: VaultSource;
  /** What the person reads for it, such as `X's archive`. */
  readonly label: string;
  /** Days after the last copy that a new one is due. */
  readonly cadenceDays: number;
  /** Days after it is due that it is overdue. */
  readonly graceDays: number;
  /** When the account's last copy is from (epoch ms), or null when there is none. */
  lastAt(accountId: string): Promise<number | null>;
}

const DAY_MS = 86_400_000;

/** How long *Not now* quiets the reminder: 7 days. */
export const SNOOZE_MS = 7 * DAY_MS;

/** The newest import of `sources` that was read in whole. */
async function newest(accountId: string, sources: readonly VaultSource[]): Promise<VaultImport | undefined> {
  const rows = (await Promise.all(sources.map((source) => importLedger(accountId, source)))).flat();
  return rows
    .filter((r) => !r.problems.some((p) => p === 'duplicate' || p === 'cancelled' || p === 'failed'))
    .sort((a, b) => b.importedAt - a.importedAt)[0];
}

const registry = new Map<VaultSource, FreshnessSource>();

/** Registers a source the reminder follows, in place of an earlier one for the same source. */
export function registerFreshness(source: FreshnessSource): void {
  registry.set(source.source, source);
}

/** The sources the reminder follows, in the order they were registered. */
export function freshnessSources(): FreshnessSource[] {
  return [...registry.values()];
}

// The core's two: X's archive, dated by the day X made it when its manifest says, else by the import; and X's
// analytics export, of posts or of days, by the import.
registerFreshness({
  source: 'x-archive',
  label: 'X’s archive',
  cadenceDays: 30,
  graceDays: 14,
  lastAt: async (accountId) => {
    const row = await newest(accountId, ['x-archive']);
    return row ? (row.coverTo ?? row.importedAt) : null;
  },
});
registerFreshness({
  source: 'x-analytics-posts',
  label: 'X’s analytics export',
  cadenceDays: 60,
  graceDays: 20,
  lastAt: async (accountId) => (await newest(accountId, ['x-analytics-posts', 'x-analytics-days']))?.importedAt ?? null,
});

/** How fresh a copy from `lastAt` is at `now`, for a source with this cadence and grace. */
export function freshnessOf(lastAt: number | null, cadenceDays: number, graceDays: number, now: number): Freshness {
  if (lastAt === null) return 'never';
  const age = now - lastAt;
  if (age < cadenceDays * DAY_MS) return 'fresh';
  return age < (cadenceDays + graceDays) * DAY_MS ? 'due' : 'overdue';
}

/** A source due for a new copy, for the reminder and the Vault page. */
export interface Nudge {
  source: VaultSource;
  label: string;
  freshness: 'due' | 'overdue';
  lastAt: number;
  /** Whole days since the last copy. */
  ageDays: number;
}

/** Every source due or overdue for the account at `now`; a source never imported isn't due: there is nothing to renew. */
export async function dueNudges(accountId: string, now: number): Promise<Nudge[]> {
  const nudges: Nudge[] = [];
  for (const source of freshnessSources()) {
    const lastAt = await source.lastAt(accountId);
    const freshness = freshnessOf(lastAt, source.cadenceDays, source.graceDays, now);
    if (lastAt === null || (freshness !== 'due' && freshness !== 'overdue')) continue;
    nudges.push({
      source: source.source,
      label: source.label,
      freshness,
      lastAt,
      ageDays: Math.floor((now - lastAt) / DAY_MS),
    });
  }
  return nudges;
}

/** Where *Not now* keeps when the reminder may speak again, per account (`kv`). */
const snoozeKey = (accountId: string) => `vaultSnooze:${accountId}`;

/** Where the day of the last reminder is kept, per account (`kv`), so there is at most one a day. */
const nudgedKey = (accountId: string) => `vaultNudged:${accountId}`;

/** *Not now*: no reminder for the account for 7 days. */
export function snoozeVault(accountId: string, now = Date.now()): Promise<void> {
  return kvSet(snoozeKey(accountId), now + SNOOZE_MS);
}

/** Remembers that the account was reminded today, in the person's time zone. */
export function markNudged(accountId: string, now = Date.now()): Promise<void> {
  return kvSet(nudgedKey(accountId), localDay(now));
}

/** What a reminder says. */
export interface VaultReminder {
  title: string;
  message: string;
  nudges: Nudge[];
}

/**
 * The reminder for the account at `now`, or null when there is none to give: the switch is off, Xomoni is signed out,
 * it is outside active hours, *Not now* was pressed in the last 7 days, the account was reminded today already, or no
 * source is due. Reads only; the caller shows it and then `markNudged`.
 */
export async function vaultReminder(
  account: { id: string; handle: string },
  now: number,
): Promise<VaultReminder | null> {
  const settings = await getSettings();
  if (!settings.vaultReminders || !withinActiveHours(settings.activeHours, new Date(now))) return null;
  if (await getSignedOut()) return null;
  const until = await kvGet<unknown>(snoozeKey(account.id), null);
  if (typeof until === 'number' && until > now) return null;
  if ((await kvGet<unknown>(nudgedKey(account.id), null)) === localDay(now)) return null;
  const nudges = await dueNudges(account.id, now);
  const [first] = nudges;
  if (!first) return null;
  const what = nudges.map((n) => `${n.label} is ${String(n.ageDays)} days old`).join(', and ');
  return {
    title: `Time for a fresh copy of @${account.handle}’s X files`,
    message: `${what}. Download a new copy on X yourself, then drop it on Xomoni’s Vault page.`,
    nudges,
  };
}

/** Shows a desktop notification: `notify` in `notify.ts`, or a test's stand-in. */
export type ShowNotification = (
  id: string,
  title: string,
  message: string,
  sticky?: boolean,
  buttons?: readonly string[],
) => Promise<void>;

/** The button a reminder offers: *Not now*, which snoozes it for 7 days. */
export const NOT_NOW = 'Not now';

/**
 * Reminds the person when one of the account's files is due (`vaultReminder`): shows the notification, with *Not now*,
 * and remembers the day, so there is at most one a day. Answers the reminder shown, or null. The dashboard does this
 * every hour while it is open (`VaultFollowUp`), and the service worker when X's page is seen while it isn't.
 */
export async function remindIfDue(
  account: { id: string; handle: string },
  now: number,
  show: ShowNotification,
): Promise<VaultReminder | null> {
  const reminder = await vaultReminder(account, now);
  if (!reminder) return null;
  await show(vaultNotificationId(account.id), reminder.title, reminder.message, false, [NOT_NOW]);
  await markNudged(account.id, now);
  return reminder;
}

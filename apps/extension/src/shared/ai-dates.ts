// The person's own dates for the AI exposure audit (#518, P6.1.4, the AI exposure audit's ADR): the day they turned AI
// data sharing off on X, or that they never did, or don't know; and when the account was private. The person enters
// them; Xomoni never reads X's settings or changes anything there (ADR-0003). They are kept on the computer in `kv`, per
// X account, carried in a move, and removed with the account's data.
import { kvGet, kvSet } from './db';

/** When the person turned AI data sharing off on X: a day, never, or not known. "Not known" is never guessed. */
export type OptOut = { kind: 'day'; day: string } | { kind: 'never' } | { kind: 'unknown' };

/** A span in which the account was private: from a day to a day, or to now while it still is. */
export interface PrivateSpell {
  from: string;
  to: string | null;
}

/** The person's dates for one X account. */
export interface AiDates {
  optOut: OptOut;
  privateSpells: PrivateSpell[];
}

/** The most private spells kept for an account: far beyond anyone's. */
export const MAX_PRIVATE_SPELLS = 50;

/** The dates of an account the person hasn't given yet: the opt-out not known, never private. */
export const NO_AI_DATES: AiDates = { optOut: { kind: 'unknown' }, privateSpells: [] };

/** Where an account's dates are kept (`kv`). */
export const aiDatesKey = (accountId: string) => `aiDates:${accountId}`;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real `yyyy-mm-dd` day's start, UTC (epoch ms), or null. */
function dayStart(day: unknown): number | null {
  if (typeof day !== 'string' || !DAY.test(day)) return null;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day ? ms : null;
}

/** `ms` as a `yyyy-mm-dd` day, UTC. */
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** What the dates are checked against: the day the account was made, when known, and today. */
export interface AiDatesBounds {
  /** When the X account was made (epoch ms), or null when Xomoni doesn't know. */
  accountCreatedAt: number | null;
  now: number;
}

/** The dates, checked, or why they can't be kept. */
export type AiDatesCheck = { ok: true; dates: AiDates } | { ok: false; reason: string };

/**
 * Checks `raw` as an account's dates: an opt-out of one of the three kinds, with a real day no earlier than the
 * account's creation and no later than today; at most 50 private spells, each from a day to a day no earlier (or to
 * now), none before the account was made or after today, and none overlapping another. Unknown keys are dropped.
 */
export function checkAiDates(raw: unknown, bounds: AiDatesBounds): AiDatesCheck {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!value) return { ok: false, reason: 'These dates are not in the right shape.' };
  const today = dayOf(bounds.now);
  const created = bounds.accountCreatedAt === null ? null : dayOf(bounds.accountCreatedAt);
  const inRange = (day: string) => day <= today && (created === null || day >= created);
  const outOfRange = (what: string) =>
    created === null
      ? `${what} can’t be after today.`
      : `${what} has to be between the day the account was made (${created}) and today.`;

  const opt = value.optOut && typeof value.optOut === 'object' ? (value.optOut as Record<string, unknown>) : null;
  let optOut: OptOut;
  if (opt?.kind === 'never' || opt?.kind === 'unknown') optOut = { kind: opt.kind };
  else if (opt?.kind === 'day') {
    if (dayStart(opt.day) === null) return { ok: false, reason: 'The day you turned it off is not a real day.' };
    const day = opt.day as string;
    if (!inRange(day)) return { ok: false, reason: outOfRange('The day you turned it off') };
    optOut = { kind: 'day', day };
  } else return { ok: false, reason: 'Say when you turned it off, that you never did, or that you don’t know.' };

  const rawSpells = value.privateSpells ?? [];
  if (!Array.isArray(rawSpells)) return { ok: false, reason: 'The private spells are not in the right shape.' };
  if (rawSpells.length > MAX_PRIVATE_SPELLS)
    return { ok: false, reason: `Keep at most ${String(MAX_PRIVATE_SPELLS)} private spells.` };
  const privateSpells: PrivateSpell[] = [];
  for (const entry of rawSpells as unknown[]) {
    const spell = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    if (dayStart(spell.from) === null) return { ok: false, reason: 'A private spell’s first day is not a real day.' };
    const from = spell.from as string;
    if (spell.to !== null && dayStart(spell.to) === null)
      return { ok: false, reason: 'A private spell’s last day is not a real day.' };
    const to = spell.to as string | null;
    if (!inRange(from) || (to !== null && !inRange(to))) return { ok: false, reason: outOfRange('A private spell') };
    if (to !== null && to < from) return { ok: false, reason: 'A private spell ends before it starts.' };
    privateSpells.push({ from, to });
  }
  privateSpells.sort((a, b) => a.from.localeCompare(b.from));
  for (let i = 1; i < privateSpells.length; i += 1) {
    const before = privateSpells[i - 1];
    const spell = privateSpells[i];
    if (before && spell && (before.to === null || before.to >= spell.from))
      return { ok: false, reason: 'Two private spells overlap.' };
  }
  return { ok: true, dates: { optOut, privateSpells } };
}

/**
 * The account's dates, as kept; the not-known default when there are none, or when what is kept no longer passes the
 * check (a row damaged on the computer), so the page never breaks on it.
 */
export async function getAiDates(accountId: string, bounds: AiDatesBounds): Promise<AiDates> {
  const kept = await kvGet<unknown>(aiDatesKey(accountId), null);
  if (kept === null) return NO_AI_DATES;
  const checked = checkAiDates(kept, { accountCreatedAt: null, now: bounds.now });
  return checked.ok ? checked.dates : NO_AI_DATES;
}

/** Keeps the account's dates once they pass the check, and answers the check: nothing is kept when they don't. */
export async function saveAiDates(accountId: string, raw: unknown, bounds: AiDatesBounds): Promise<AiDatesCheck> {
  const checked = checkAiDates(raw, bounds);
  if (checked.ok) await kvSet(aiDatesKey(accountId), checked.dates);
  return checked;
}

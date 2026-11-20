// The Comments place (#256). *Your replies*: which of the person's replies to list, as the form holds the answers, and
// the plan that hands the picked ones to Xomoni. *Replies to you*: how many replies Xomoni kept each day (ADR-0030),
// as a chart's days. Pure: dates are local days, read with the browser's clock.
import { type CleanupPlan, type IncomingPage, MAX_PLAN_IDS, MAX_READ_QUERY, type RepliesFilter } from '@xomoni/bridge';
import { FIRST_DAY, TOO_EARLY, localDay } from './cleanup-plan';
import type { SeriesPoint } from './insights';

/** The filter as the form holds it: days as `YYYY-MM-DD`, numbers and words as typed. */
export interface RepliesForm {
  /** Only replies from this day on; empty for no start. */
  from: string;
  /** Only replies up to and including this day; empty for no end. */
  through: string;
  /** Only replies with at most this many likes; empty to ignore. */
  likes: string;
  /** Only replies to this handle, with or without `@`; empty for anyone. */
  who: string;
  /** Only replies whose text holds this. */
  words: string;
  /** List replies in the person's own threads too. */
  threads: boolean;
}

/** Every reply but those in the person's own threads, which the place leaves out until asked. */
export const DEFAULT_REPLIES_FORM: RepliesForm = {
  from: '',
  through: '',
  likes: '',
  who: '',
  words: '',
  threads: false,
};

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const DAY_MS = 86_400_000;

/** The start of the day after `day`, on this computer's clock (a day can be 23 or 25 hours long). */
function dayAfter(day: number): number {
  const date = new Date(day + DAY_MS / 2);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

/** The handle typed, without `@` or spaces; empty when none was typed. */
export function typedHandle(text: string): string {
  return text.trim().replace(/^@/, '');
}

/** The filter Xomoni takes, or what is wrong with the answers, in words the form shows. */
export function toRepliesFilter(form: RepliesForm, now: number): { filter: RepliesFilter } | { problem: string } {
  const after = form.from ? localDay(form.from) : null;
  if (form.from && after === null) return { problem: 'Pick the first day, or leave it empty.' };
  const last = form.through ? localDay(form.through) : null;
  if (form.through && last === null) return { problem: 'Pick the last day, or leave it empty.' };
  if ((form.from && form.from < FIRST_DAY) || (form.through && form.through < FIRST_DAY)) return { problem: TOO_EARLY };
  if (last !== null && last > now) return { problem: 'The last day must be today or earlier.' };
  const before = last === null ? null : dayAfter(last);
  if (after !== null && before !== null && after >= before)
    return { problem: 'The first day must not be after the last.' };
  const likes = form.likes.trim() ? Number(form.likes) : null;
  if (likes !== null && (!Number.isInteger(likes) || likes < 0 || likes > 1_000_000))
    return { problem: 'Likes must be a whole number from 0, or empty.' };
  const replyTo = typedHandle(form.who);
  if (replyTo && !HANDLE.test(replyTo)) return { problem: 'That isn’t an X handle: letters, digits and _ only.' };
  if (form.words.length > MAX_READ_QUERY) return { problem: `Search at most ${MAX_READ_QUERY} characters.` };
  return {
    filter: { after, before, maxLikes: likes, replyTo, query: form.words.trim(), threads: form.threads },
  };
}

/**
 * The plan that hands replies picked here to Xomoni: only those, with nothing else kept or left out, ending `now`.
 * Xomoni opens its Cleanup page with them, and nothing starts until the person confirms there (ADR-0027).
 */
export function pickedPlan(ids: readonly string[], now: number): CleanupPlan {
  return {
    target: 'reply',
    before: now,
    after: null,
    keepMinLikes: null,
    keepKeywords: [],
    // Picked one by one, so a reply in the person's own thread was meant too.
    skipSelfReplies: false,
    onlyIds: [...new Set(ids)].slice(0, MAX_PLAN_IDS),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The local day of `ms` as `YYYY-MM-DD`, as Xomoni names the days it counts. */
export function dayText(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Replies to the person on each of the last `days` local days, ending today, for a chart: how many Xomoni kept, 0 on a
 * day it saw none, and no value before `since`, when it had not started keeping them.
 */
export function incomingSeries(page: Pick<IncomingPage, 'perDay' | 'since'>, now: number, days = 30): SeriesPoint[] {
  const counts = new Map(page.perDay.map((d) => [d.day, d.replies]));
  const first = page.since === null ? null : dayText(page.since);
  const points: SeriesPoint[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - back);
    const day = dayText(date.getTime());
    points.push({ day, value: first !== null && day >= first ? (counts.get(day) ?? 0) : null });
  }
  return points;
}

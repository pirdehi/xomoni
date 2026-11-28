// How the console writes times and numbers. Times are in UTC, so every super-admin reads the same moment the same way.

/** A moment as "28 Nov 2026, 10:00 UTC"; `empty` (a dash) when there is none or it can't be read. */
export function formatWhen(iso: string | null | undefined, empty = '—'): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return empty;
  return `${date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })} UTC`;
}

/** A moment's day as "28 Nov 2026"; `empty` (a dash) when there is none or it can't be read. */
export function formatDate(iso: string | null | undefined, empty = '—'): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return empty;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A whole number with thousands separators, such as 12,480. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** `count` and the noun, singular for one: "1 session", "3 sessions". */
export function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${formatNumber(count)} ${count === 1 ? noun : many}`;
}

/** Today in UTC as `YYYY-MM-DD`, from `now` (milliseconds). */
export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

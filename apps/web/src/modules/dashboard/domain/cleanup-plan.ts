// The Cleanup place's three questions (#235), as Xomoni's own Cleanup page asks them: what to remove, how old, and
// what to keep. The answers live in the address, so *Send to my computer* on a phone carries the plan to the
// computer where Xomoni runs. Pure: dates are local days, read with the browser's clock.
import { type CleanupPlan, LIBRARY_KINDS, type LibraryKind, MAX_PLAN_KEYWORD, MAX_PLAN_KEYWORDS } from '@xomoni/bridge';

/** How old: Xomoni's presets, or a date. */
export type PlanAge = '30d' | '90d' | '6m' | '1y' | '2y' | 'custom';

/** The ages in Xomoni's order, with its labels and their days. */
export const PLAN_AGES: readonly { id: PlanAge; label: string; days: number }[] = [
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '6m', label: '6 months', days: 182 },
  { id: '1y', label: '1 year', days: 365 },
  { id: '2y', label: '2 years', days: 730 },
  { id: 'custom', label: 'A date', days: 0 },
];

/** The answers as the form holds them: dates as `YYYY-MM-DD`, numbers and words as typed. */
export interface PlanForm {
  target: LibraryKind;
  age: PlanAge;
  /** With `age: 'custom'`: remove everything before this day. */
  before: string;
  /** Only from this day on; empty for no start. */
  from: string;
  /** Keep posts and replies with at least this many likes; empty to ignore. */
  likes: string;
  /** Keep anything containing one of these, comma or line separated. */
  keep: string;
  /** Keep replies to your own posts (threads). */
  threads: boolean;
}

/** The form before any answer: posts older than a year, threads kept, as in Xomoni. */
export const DEFAULT_PLAN_FORM: PlanForm = {
  target: 'post',
  age: '1y',
  before: '',
  from: '',
  likes: '',
  keep: '',
  threads: true,
};

const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/** The query parameters the answers use, beside the dashboard's scope. */
export const PLAN_KEYS: readonly string[] = ['what', 'older', 'before', 'from', 'likes', 'keep', 'threads'];

/** The answers kept in an address; anything malformed falls back to the default. */
export function parsePlanForm(params: URLSearchParams): PlanForm {
  const target = LIBRARY_KINDS.find((k) => k === params.get('what')) ?? DEFAULT_PLAN_FORM.target;
  const age = PLAN_AGES.find((a) => a.id === params.get('older'))?.id ?? DEFAULT_PLAN_FORM.age;
  const day = (key: string) => {
    const value = params.get(key) ?? '';
    return DAY_TEXT.test(value) ? value : '';
  };
  const likes = params.get('likes') ?? '';
  return {
    target,
    age,
    before: day('before'),
    from: day('from'),
    likes: /^\d{1,7}$/.test(likes) ? likes : '',
    keep: (params.get('keep') ?? '').slice(0, MAX_PLAN_KEYWORDS * (MAX_PLAN_KEYWORD + 2)),
    threads: params.get('threads') !== 'no',
  };
}

/** The answers as query parameters, leaving out the defaults so a plain plan keeps a plain address. */
export function planFormQuery(form: PlanForm): URLSearchParams {
  const params = new URLSearchParams();
  if (form.target !== DEFAULT_PLAN_FORM.target) params.set('what', form.target);
  if (form.age !== DEFAULT_PLAN_FORM.age) params.set('older', form.age);
  if (form.age === 'custom' && form.before) params.set('before', form.before);
  if (form.from) params.set('from', form.from);
  if (form.likes) params.set('likes', form.likes);
  if (form.keep) params.set('keep', form.keep);
  if (!form.threads) params.set('threads', 'no');
  return params;
}

/** The start of a local day, `YYYY-MM-DD`, in epoch ms; null when it isn't one. */
export function localDay(text: string): number | null {
  if (!DAY_TEXT.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date.getTime() : null;
}

/** The start of today, `days` days back, on this computer's clock. */
function daysAgo(days: number, now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.getTime();
}

/** Words to keep, as Xomoni reads them: split on commas and lines, trimmed, lowercased, each once. */
export function keepWords(text: string): string[] {
  const words = text
    .split(/[\n,]/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(words)];
}

/** A plan Xomoni can take, or what is wrong with the answers, in words the form shows. */
export function toPlan(form: PlanForm, now: number): { plan: CleanupPlan } | { problem: string } {
  const before =
    form.age === 'custom' ? localDay(form.before) : daysAgo(PLAN_AGES.find((a) => a.id === form.age)?.days ?? 365, now);
  if (before === null) return { problem: 'Pick the date to remove everything before.' };
  if (before > now) return { problem: 'The date must be today or earlier.' };
  const after = form.from ? localDay(form.from) : null;
  if (form.from && after === null) return { problem: 'Pick the start date, or leave it empty.' };
  if (after !== null && after >= before) return { problem: 'The start date must be before the end date.' };
  const likes = form.likes.trim() ? Number(form.likes) : null;
  if (likes !== null && (!Number.isInteger(likes) || likes < 1 || likes > 1_000_000))
    return { problem: 'Likes to keep must be a whole number from 1, or empty.' };
  const words = keepWords(form.keep);
  if (words.length > MAX_PLAN_KEYWORDS) return { problem: `Keep at most ${MAX_PLAN_KEYWORDS} words or phrases.` };
  if (words.some((w) => w.length > MAX_PLAN_KEYWORD))
    return { problem: `Each word or phrase to keep can be at most ${MAX_PLAN_KEYWORD} characters.` };
  return {
    plan: {
      target: form.target,
      before,
      after,
      keepMinLikes: form.target === 'post' || form.target === 'reply' ? likes : null,
      keepKeywords: words,
      skipSelfReplies: form.threads,
    },
  };
}

/** How many days the matching items take at most `perDay` a day: at least one when anything matches. */
export function daysFor(matching: number, perDay: number): number {
  if (matching <= 0) return 0;
  return perDay > 0 ? Math.ceil(matching / perDay) : Infinity;
}

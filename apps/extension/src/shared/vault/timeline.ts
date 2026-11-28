// The account's timeline (#425, ADR-0043): how each kind of entry looks and reads, the writers that add Xomoni's own
// entries, and the timeline as a CSV a spreadsheet can't run. The words are Xomoni's own or the person's note, never
// text from an X page (#146), and they are always shown as text.
import { isXId } from '../ids';
import type { Account } from '../types';
import { CSV_BOM, toCsvRow } from './csv';
import { type NewAccountEvent, type TimelineEntry, type TimelineKind, VaultError, addAccountEvent } from './db';
import type { AccountEvent } from './types';

/** The look of an entry: its name, a generic icon's name and a tone, which the dashboard maps to Fluent's own. */
export interface EventLook {
  label: string;
  icon: 'note' | 'premium' | 'archive' | 'label' | 'risk';
  tone: 'neutral' | 'accent' | 'good' | 'warn' | 'serious';
}

/**
 * How each kind of entry looks. Features that add a kind (P1's warnings and appeals, P5's labels) add it here, in the
 * same pull request as the kind.
 */
export const ACCOUNT_EVENT_WORDS: Record<TimelineKind, EventLook> = {
  note: { label: 'Your note', icon: 'note', tone: 'neutral' },
  premium_on: { label: 'X Premium on', icon: 'premium', tone: 'accent' },
  premium_off: { label: 'X Premium off', icon: 'premium', tone: 'neutral' },
  archive_requested: { label: 'Archive asked for', icon: 'archive', tone: 'neutral' },
  archive_imported: { label: 'Archive imported', icon: 'archive', tone: 'good' },
  x_label: { label: 'Label from X', icon: 'label', tone: 'warn' },
  risk: { label: 'Risk ladder', icon: 'risk', tone: 'serious' },
};

/** Who said it, in the person's words. */
export const SOURCE_WORDS: Record<TimelineEntry['source'], string> = {
  xomoni: 'Xomoni',
  person: 'You',
  profile: 'Your profile on X',
  archive: 'X’s archive',
  analytics: 'X’s analytics',
  'under-the-hood': 'X’s Under the hood',
};

/** The kinds the person can add an entry of, with a note: their own notes, and when X Premium started or ended. */
export const PERSON_KINDS = ['note', 'premium_on', 'premium_off'] as const;

/**
 * Adds one of Xomoni's own entries, never failing the work it records: an account whose id isn't X's (only a test's
 * made-up one) keeps no timeline, and an entry out of shape is left out.
 */
async function note(event: NewAccountEvent, now: number): Promise<AccountEvent | null> {
  if (!isXId(event.accountId)) return null;
  try {
    return await addAccountEvent(event, now);
  } catch (err) {
    if (err instanceof VaultError) return null;
    throw err;
  }
}

/** Xomoni's words for a Premium change it saw on the person's own profile. */
const PREMIUM_WORDS = {
  premium_on: 'X showed X Premium on for your account.',
  premium_off: 'X showed X Premium off for your account.',
} as const;

/**
 * Adds a Premium change to the timeline when X's profile of the person shows `verified` other than Xomoni last knew
 * (`before`): once, not at every sighting, and nothing when Xomoni didn't know before (the first sighting says nothing
 * of a change). Answers the entry added, or null.
 */
export async function notePremium(
  before: Pick<Account, 'id' | 'verified'> | undefined,
  verified: boolean | null | undefined,
  at: number,
): Promise<AccountEvent | null> {
  if (!before || typeof before.verified !== 'boolean' || typeof verified !== 'boolean') return null;
  if (before.verified === verified) return null;
  const kind = verified ? 'premium_on' : 'premium_off';
  return note({ accountId: before.id, kind, at, source: 'profile', words: PREMIUM_WORDS[kind] }, at);
}

/** Adds the archive the person asked X for (ADR-0022) to the timeline, once per request. */
export function noteArchiveRequested(accountId: string, requestedAt: number): Promise<AccountEvent | null> {
  return note(
    {
      accountId,
      kind: 'archive_requested',
      at: requestedAt,
      source: 'xomoni',
      words: 'You asked X for your archive. X takes a day or more to make it.',
      ref: `archive-request:${String(requestedAt)}`,
    },
    Math.max(Date.now(), requestedAt),
  );
}

/** The columns of the timeline's CSV, in order. */
export const TIMELINE_COLUMNS = ['when', 'what', 'who said it', 'words'] as const;

/**
 * The timeline as a CSV for people (ADR-0044's rules): a byte order mark, a header, one row per entry with its ISO
 * time, its kind's label, its source and its words, and any cell a spreadsheet would run as a formula made text.
 */
export function timelineCsv(entries: readonly TimelineEntry[]): string {
  return (
    CSV_BOM +
    toCsvRow(TIMELINE_COLUMNS) +
    entries
      .map((e) =>
        toCsvRow([new Date(e.at).toISOString(), ACCOUNT_EVENT_WORDS[e.kind].label, SOURCE_WORDS[e.source], e.words]),
      )
      .join('')
  );
}

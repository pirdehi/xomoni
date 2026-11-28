import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/shared/db';
import { CSV_BOM, parseCsv, toCsvRow } from '../src/shared/vault/csv';
import { RISK_EVENT_WORDS, type TimelineKind, accountTimeline, addAccountEvent } from '../src/shared/vault/db';
import {
  ACCOUNT_EVENT_WORDS,
  PERSON_KINDS,
  SOURCE_WORDS,
  TIMELINE_COLUMNS,
  noteArchiveRequested,
  notePremium,
  timelineCsv,
} from '../src/shared/vault/timeline';
import { ACCOUNT_EVENT_KINDS, ACCOUNT_EVENT_SOURCES } from '../src/shared/vault/types';
import { resetDb } from './support/fixtures';

// The account's timeline (#425, CV.2.2): Xomoni's own entries, the risk ladder's joined in its words, order, paging and
// filters, and the timeline as a CSV a spreadsheet can't run.

const ME = '9000000000000000001';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);

beforeEach(resetDb);

describe('how each entry looks', () => {
  it('names every kind and every source, the risk ladder’s too', () => {
    const kinds: TimelineKind[] = [...ACCOUNT_EVENT_KINDS, 'risk'];
    expect(Object.keys(ACCOUNT_EVENT_WORDS).sort()).toEqual([...kinds].sort());
    expect(Object.keys(SOURCE_WORDS).sort()).toEqual([...ACCOUNT_EVENT_SOURCES].sort());
    expect(PERSON_KINDS).toEqual(['note', 'premium_on', 'premium_off']);
    for (const look of Object.values(ACCOUNT_EVENT_WORDS)) expect(look.label).not.toMatch(/<|>/);
  });
});

describe('Xomoni’s own entries', () => {
  it('records a Premium change once, only when the profile says otherwise than Xomoni knew', async () => {
    const before = { id: ME, verified: false };
    expect(await notePremium(before, true, NOW)).toMatchObject({ kind: 'premium_on', source: 'profile', at: NOW });
    // The same change seen again within a day is the same change.
    expect(await notePremium(before, true, NOW + 3_600_000)).toBeNull();
    expect(await notePremium({ id: ME, verified: true }, true, NOW)).toBeNull();
    expect(await notePremium({ id: ME, verified: null }, true, NOW)).toBeNull();
    expect(await notePremium({ id: ME }, false, NOW)).toBeNull();
    expect(await notePremium(undefined, true, NOW)).toBeNull();
    expect(await notePremium(before, null, NOW)).toBeNull();
    expect((await db.accountEvents.toArray()).map((e) => e.kind)).toEqual(['premium_on']);
  });

  it('records an archive request once per request, and nothing for an id that isn’t X’s', async () => {
    await noteArchiveRequested(ME, NOW - DAY);
    await noteArchiveRequested(ME, NOW - DAY);
    await noteArchiveRequested(ME, NOW);
    await noteArchiveRequested('acct-me', NOW);
    expect((await db.accountEvents.toArray()).map((e) => [e.at, e.ref])).toEqual([
      [NOW - DAY, `archive-request:${String(NOW - DAY)}`],
      [NOW, `archive-request:${String(NOW)}`],
    ]);
  });
});

describe('reading the timeline', () => {
  beforeEach(async () => {
    await addAccountEvent({ accountId: ME, kind: 'note', source: 'person', words: 'oldest', at: NOW - 40 * DAY }, NOW);
    await addAccountEvent(
      { accountId: ME, kind: 'premium_on', source: 'profile', words: 'on', at: NOW - 10 * DAY },
      NOW,
    );
    await db.risk.bulkAdd([
      { accountId: ME, kind: 'lock', at: NOW - 20 * DAY },
      { accountId: ME, kind: 'override', at: NOW - DAY },
    ]);
  });

  it('joins the risk ladder’s events in Xomoni’s words, newest first', async () => {
    const all = await accountTimeline(ME);
    expect(all.map((e) => [e.kind, e.words])).toEqual([
      ['risk', RISK_EVENT_WORDS.override],
      ['premium_on', 'on'],
      ['risk', RISK_EVENT_WORDS.lock],
      ['note', 'oldest'],
    ]);
  });

  it('filters by kind, reads between two moments, and pages', async () => {
    expect((await accountTimeline(ME, { kinds: ['note'] })).map((e) => e.words)).toEqual(['oldest']);
    expect((await accountTimeline(ME, { kinds: ['risk', 'premium_on'] })).map((e) => e.kind)).toEqual([
      'risk',
      'premium_on',
      'risk',
    ]);
    expect(await accountTimeline(ME, { from: NOW - 15 * DAY, to: NOW - 5 * DAY })).toHaveLength(1);
    const first = await accountTimeline(ME, { limit: 2 });
    const next = await accountTimeline(ME, { limit: 2, to: (first.at(-1)?.at ?? 0) - 1 });
    expect([...first, ...next].map((e) => e.kind)).toEqual(['risk', 'premium_on', 'risk', 'note']);
  });
});

describe('the timeline as a CSV', () => {
  it('starts with a byte order mark and the header, and ends each row with CRLF', async () => {
    await addAccountEvent({ accountId: ME, kind: 'note', source: 'person', words: 'plain', at: NOW }, NOW);
    const csv = timelineCsv(await accountTimeline(ME));
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}when,what,who said it,words\r\n2026-11-20T12:00:00.000Z,Your note,You,plain\r\n`);
    expect(TIMELINE_COLUMNS).toHaveLength(4);
  });

  it('makes a cell a spreadsheet would run into text, and quotes what needs quoting', async () => {
    for (const words of ['=HYPERLINK("https://example.invalid")', '+1', '-2', '@SUM(A1)', 'a, "b"\nc']) {
      await addAccountEvent({ accountId: ME, kind: 'note', source: 'person', words, at: NOW }, NOW);
    }
    const table = parseCsv(timelineCsv(await accountTimeline(ME)));
    expect(table.rows.map((r) => r.cells[3]).sort()).toEqual(
      ["'+1", "'-2", '\'=HYPERLINK("https://example.invalid")', "'@SUM(A1)", 'a, "b"\nc'].sort(),
    );
  });

  it('writes any record by RFC 4180, numbers as they are and nothing for null', () => {
    expect(toCsvRow(['a', 3, null, undefined, '\tx', '\rx', 'say "hi"'])).toBe('a,3,,,\'\tx,"\'\rx","say ""hi"""\r\n');
  });
});

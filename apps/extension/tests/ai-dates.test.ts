import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_PRIVATE_SPELLS,
  NO_AI_DATES,
  aiDatesKey,
  checkAiDates,
  getAiDates,
  saveAiDates,
} from '../src/shared/ai-dates';
import { db, forgetAccount, kvGet, kvSet } from '../src/shared/db';
import { resetDb } from './support/fixtures';

// The person's own dates for the AI exposure audit (#518, P6.1.4): checked, kept per account in `kv`, never guessed.

const ME = '9000000000000000001';
const NOW = Date.UTC(2026, 10, 28, 12);
const BOUNDS = { accountCreatedAt: Date.UTC(2015, 5, 1), now: NOW };

beforeEach(resetDb);

describe('checking the dates', () => {
  it('takes a day, never or not known, and private spells, sorted, dropping unknown keys', () => {
    const checked = checkAiDates(
      {
        optOut: { kind: 'day', day: '2024-11-20', extra: 1 },
        privateSpells: [
          { from: '2022-01-01', to: null },
          { from: '2019-03-01', to: '2019-04-30' },
        ],
        note: 'x',
      },
      BOUNDS,
    );
    expect(checked).toEqual({
      ok: true,
      dates: {
        optOut: { kind: 'day', day: '2024-11-20' },
        privateSpells: [
          { from: '2019-03-01', to: '2019-04-30' },
          { from: '2022-01-01', to: null },
        ],
      },
    });
    expect(checkAiDates({ optOut: { kind: 'never' } }, BOUNDS)).toEqual({
      ok: true,
      dates: { optOut: { kind: 'never' }, privateSpells: [] },
    });
    expect(checkAiDates({ optOut: { kind: 'unknown' }, privateSpells: [] }, BOUNDS)).toEqual({
      ok: true,
      dates: NO_AI_DATES,
    });
  });

  it('refuses each invalid entry and says why', () => {
    const cases: [unknown, string][] = [
      [null, 'These dates are not in the right shape.'],
      [{ optOut: { kind: 'maybe' } }, 'Say when you turned it off, that you never did, or that you don’t know.'],
      [{ optOut: { kind: 'day', day: '2024-02-30' } }, 'The day you turned it off is not a real day.'],
      [
        { optOut: { kind: 'day', day: '2014-01-01' } },
        'The day you turned it off has to be between the day the account was made (2015-06-01) and today.',
      ],
      [
        { optOut: { kind: 'day', day: '2026-11-29' } },
        'The day you turned it off has to be between the day the account was made (2015-06-01) and today.',
      ],
      [{ optOut: { kind: 'never' }, privateSpells: 'all' }, 'The private spells are not in the right shape.'],
      [
        { optOut: { kind: 'never' }, privateSpells: [{ from: 'x', to: null }] },
        'A private spell’s first day is not a real day.',
      ],
      [
        { optOut: { kind: 'never' }, privateSpells: [{ from: '2020-01-01', to: 'later' }] },
        'A private spell’s last day is not a real day.',
      ],
      [
        { optOut: { kind: 'never' }, privateSpells: [{ from: '2020-02-01', to: '2020-01-01' }] },
        'A private spell ends before it starts.',
      ],
      [
        {
          optOut: { kind: 'never' },
          privateSpells: [
            { from: '2020-01-01', to: '2020-03-01' },
            { from: '2020-03-01', to: null },
          ],
        },
        'Two private spells overlap.',
      ],
      [
        { optOut: { kind: 'never' }, privateSpells: [{ from: '2015-01-01', to: null }] },
        'A private spell has to be between the day the account was made (2015-06-01) and today.',
      ],
    ];
    for (const [raw, reason] of cases)
      expect(checkAiDates(raw, BOUNDS), JSON.stringify(raw)).toEqual({ ok: false, reason });
    const many = Array.from({ length: MAX_PRIVATE_SPELLS + 1 }, (_, i) => ({
      from: `20${String(10 + (i % 10))}-01-01`,
      to: null,
    }));
    expect(checkAiDates({ optOut: { kind: 'never' }, privateSpells: many }, BOUNDS)).toEqual({
      ok: false,
      reason: 'Keep at most 50 private spells.',
    });
  });

  it('checks against today alone when the account’s creation isn’t known', () => {
    expect(checkAiDates({ optOut: { kind: 'day', day: '2009-01-01' } }, { accountCreatedAt: null, now: NOW }).ok).toBe(
      true,
    );
    expect(checkAiDates({ optOut: { kind: 'day', day: '2027-01-01' } }, { accountCreatedAt: null, now: NOW })).toEqual({
      ok: false,
      reason: 'The day you turned it off can’t be after today.',
    });
  });
});

describe('keeping the dates', () => {
  it('keeps them per account once they pass, and reads them back', async () => {
    const dates = { optOut: { kind: 'day', day: '2024-12-01' }, privateSpells: [] };
    expect(await saveAiDates(ME, dates, BOUNDS)).toEqual({ ok: true, dates });
    expect(await getAiDates(ME, BOUNDS)).toEqual(dates);
    expect(await getAiDates('9000000000000000002', BOUNDS)).toEqual(NO_AI_DATES);
  });

  it('keeps nothing that fails, and leaves what was kept', async () => {
    await saveAiDates(ME, { optOut: { kind: 'never' } }, BOUNDS);
    const refused = await saveAiDates(ME, { optOut: { kind: 'day', day: '2030-01-01' } }, BOUNDS);
    expect(refused.ok).toBe(false);
    expect(await kvGet(aiDatesKey(ME), null)).toEqual({ optOut: { kind: 'never' }, privateSpells: [] });
  });

  it('reads a value damaged on the computer as not known, rather than breaking', async () => {
    await kvSet(aiDatesKey(ME), { optOut: 'sometime' });
    expect(await getAiDates(ME, BOUNDS)).toEqual(NO_AI_DATES);
  });

  it('goes with the account’s data', async () => {
    await saveAiDates(ME, { optOut: { kind: 'never' } }, BOUNDS);
    await forgetAccount(ME);
    expect(await db.kv.get(aiDatesKey(ME))).toBeUndefined();
  });
});

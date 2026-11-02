// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, kvSet, upsertAccount } from '../../src/shared/db';
import type { RiskEventKind } from '../../src/shared/risk';
import { ACTION_LABELS, PRESETS } from '../../src/shared/settings';
import { DAY, HOUR, MINUTE } from '../../src/shared/time';
import type { ActionKind, LogEntry, Outcome, RateObservation } from '../../src/shared/types';
import { scaleRule } from '../../src/shared/x-limits';
import { LimitsPanel } from '../../src/ui/components/LimitsPanel';
import { fmtNumber } from '../../src/ui/format';
import { ME, resetDb } from '../support/fixtures';

/** Noon local time, so "the last hour", "the last 24 hours" and "earlier days" never straddle midnight. */
const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();

function log(action: ActionKind, ago: number, outcome: Outcome = 'done', accountId = ME): LogEntry {
  return { ts: NOW - ago, accountId, jobId: 'job-1', level: 'success', action, targetId: null, outcome, message: '' };
}

function observation(op: string, over: Partial<RateObservation> = {}): RateObservation {
  return {
    key: `${over.accountId ?? ME}:${op}`,
    accountId: ME,
    op,
    limit: null,
    remaining: null,
    reset: null,
    status: 200,
    at: NOW - MINUTE,
    ...over,
  };
}

const risk = (kind: RiskEventKind, ago: number) => db.risk.add({ accountId: ME, kind, at: NOW - ago });

/** The `used/cap hr · used/cap day` text next to an action's label. */
async function usage(action: ActionKind) {
  const label = await screen.findByText(ACTION_LABELS[action]);
  return label.nextElementSibling?.textContent;
}

/** The hourly and daily caps the panel shows for an action at a pace factor, formatted as on screen. */
const caps = (action: ActionKind, factor: number) => {
  const rule = scaleRule(PRESETS.careful[action], factor);
  return { hour: fmtNumber(rule.hourlyCap), day: fmtNumber(rule.dailyCap) };
};

/** Actions on three earlier days finish the warm-up, so the caps are Xomoni's full one fifth. */
async function finishWarmup() {
  await db.logs.bulkAdd([log('delete', DAY + HOUR), log('delete', 2 * DAY), log('delete', 3 * DAY)]);
}

describe('LimitsPanel', () => {
  beforeEach(async () => {
    // Only `Date` is faked: IndexedDB and Dexie keep their real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await resetDb();
    // A Premium account, so these tests see the full read ceiling; #33's test turns it off.
    await upsertAccount({ id: ME, handle: 'me', verified: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the preset and a new account’s warm-up in the subtitle', async () => {
    render(<LimitsPanel accountId={ME} />);
    expect(screen.getByRole('heading', { name: 'Limits & pacing' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Preset: Careful · at most ⅕ of X's limits · warm-up day 1 of 4 · running at 25% of that",
      ),
    ).toBeInTheDocument();
  });

  it('shows the caps of day one of the warm-up for every action', async () => {
    render(<LimitsPanel accountId={ME} />);
    await screen.findByText(/warm-up day 1 of 4/);
    for (const action of ['delete', 'unretweet', 'unlike', 'relike', 'read'] as const) {
      const factor = 0.25;
      const { hour, day } = caps(action, factor);
      expect(await usage(action)).toBe(`0/${hour} hr · 0/${day} day`);
      const meter = screen.getByRole('meter', { name: `${ACTION_LABELS[action]} today` });
      expect(meter).toHaveAttribute('aria-valuenow', '0');
      expect(meter).toHaveAttribute('aria-valuemax', String(scaleRule(PRESETS.careful[action], factor).dailyCap));
    }
  });

  it('shows the full one-fifth caps once the warm-up is over', async () => {
    await finishWarmup();
    render(<LimitsPanel accountId={ME} />);
    expect(await screen.findByText("Preset: Careful · at most ⅕ of X's limits")).toBeInTheDocument();
    const { hour, day } = caps('delete', 1);
    expect(await usage('delete')).toBe(`0/${hour} hr · 0/${day} day`);
  });

  it('counts done actions of the last hour and the last 24 hours', async () => {
    await finishWarmup();
    await db.logs.bulkAdd([
      log('delete', 10 * MINUTE),
      log('delete', 30 * MINUTE),
      log('delete', 3 * HOUR),
      // Not counted: not done, a read logged as an action, outside 24 hours, or another account.
      log('delete', 5 * MINUTE, 'failed'),
      log('read', 5 * MINUTE),
      log('delete', 25 * HOUR),
      log('delete', 5 * MINUTE, 'done', 'someone-else'),
      log('unlike', 2 * HOUR),
    ]);
    render(<LimitsPanel accountId={ME} />);

    const del = caps('delete', 1);
    await waitFor(async () => expect(await usage('delete')).toBe(`2/${del.hour} hr · 3/${del.day} day`));
    const unlike = caps('unlike', 1);
    expect(await usage('unlike')).toBe(`0/${unlike.hour} hr · 1/${unlike.day} day`);
    expect(screen.getByRole('meter', { name: 'Delete posts & replies today' })).toHaveAttribute('aria-valuenow', '3');
  });

  it('lets actions age out of the last hour while nothing new is logged (#61)', async () => {
    await finishWarmup();
    await db.logs.add(log('delete', 55 * MINUTE));
    render(<LimitsPanel accountId={ME} />);
    const del = caps('delete', 1);
    await waitFor(async () => expect(await usage('delete')).toBe(`1/${del.hour} hr · 1/${del.day} day`));

    // Ten minutes later, with no new rows, the panel's minute tick re-counts.
    vi.setSystemTime(NOW + 10 * MINUTE);
    await waitFor(async () => expect(await usage('delete')).toBe(`0/${del.hour} hr · 1/${del.day} day`));
  });

  it('counts page loads from the reads table', async () => {
    await finishWarmup();
    await db.reads.bulkAdd([
      { accountId: ME, budget: 'timeline', ts: NOW - MINUTE },
      { accountId: ME, budget: 'timeline', ts: NOW - 2 * MINUTE },
      { accountId: ME, budget: 'timeline', ts: NOW - 5 * HOUR },
      { accountId: ME, budget: 'timeline', ts: NOW - 2 * DAY },
    ]);
    render(<LimitsPanel accountId={ME} />);

    const read = caps('read', 1);
    await waitFor(async () => expect(await usage('read')).toBe(`2/${read.hour} hr · 3/${read.day} day`));
  });

  it('halves page loads until X shows the account is Premium, then shows the full ceiling (#33)', async () => {
    await finishWarmup();
    await upsertAccount({ id: ME, verified: false });
    render(<LimitsPanel accountId={ME} />);
    expect(await screen.findByText(/page loads at half: the account is not known to be Premium/)).toBeInTheDocument();
    const half = caps('read', 0.5);
    expect(await usage('read')).toBe(`0/${half.hour} hr · 0/${half.day} day`);

    await upsertAccount({ id: ME, verified: true });
    const full = caps('read', 1);
    await waitFor(async () => expect(await usage('read')).toBe(`0/${full.hour} hr · 0/${full.day} day`));
    expect(screen.queryByText(/page loads at half/)).not.toBeInTheDocument();
  });

  it('names a custom preset', async () => {
    await kvSet('settings', { preset: 'custom', pacing: { delete: { hourlyCap: 3, dailyCap: 9 } } });
    await finishWarmup();
    render(<LimitsPanel accountId={ME} />);

    expect(await screen.findByText("Preset: Custom · at most ⅕ of X's limits")).toBeInTheDocument();
    expect(await usage('delete')).toBe('0/3 hr · 0/9 day');
  });

  it('shows no risk note at level 0', async () => {
    render(<LimitsPanel accountId={ME} />);
    await screen.findByText(/warm-up day 1/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains a caution level without a resume lock', async () => {
    await finishWarmup();
    await risk('rate_limited', 10 * MINUTE);
    render(<LimitsPanel accountId={ME} />);

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('Risk level 1: Caution');
    expect(note).toHaveTextContent('X rate-limited Xomoni in the last hour.');
    expect(note).not.toHaveTextContent('Resume opens');
    expect(note).not.toHaveTextContent('Slower pace');
    expect(note).toHaveClass('border-warn/40');
  });

  it('explains a retreat: when resuming opens and how long the slower pace lasts', async () => {
    await finishWarmup();
    await risk('automation_flag', HOUR);
    render(<LimitsPanel accountId={ME} />);

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('Risk level 2: Retreat');
    expect(note).toHaveTextContent('X flagged the activity as automated (226).');
    expect(note).toHaveTextContent('Resume opens in 5h 0m.');
    expect(note).toHaveTextContent('Slower pace for 6d 23h more.');
    // The 226 also drops the warm-up back a step: day 3 of 4 (75%) at half pace.
    expect(
      screen.getByText("Preset: Careful · at most ⅕ of X's limits · warm-up day 3 of 4 · running at 38% of that"),
    ).toBeInTheDocument();
    const { hour, day } = caps('delete', 0.375);
    expect(await usage('delete')).toBe(`0/${hour} hr · 0/${day} day`);
  });

  it('marks a defensive level as serious', async () => {
    await finishWarmup();
    await risk('lock', HOUR);
    render(<LimitsPanel accountId={ME} />);

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('Risk level 3: Defensive');
    expect(note).toHaveTextContent('X locked this account.');
    expect(note).toHaveClass('border-critical/40');
  });

  it('says a full stop does not resume on its own', async () => {
    await risk('suspended', HOUR);
    render(<LimitsPanel accountId={ME} />);

    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('Risk level 4: Full stop');
    expect(note).toHaveTextContent('X suspended this account. Xomoni won’t resume on its own.');
    expect(note).not.toHaveTextContent('Slower pace');
  });

  it('says nothing was observed when X reported no limits in the last 2 hours', async () => {
    await db.limits.bulkPut([
      observation('DeleteTweet', { at: NOW - 3 * HOUR, limit: 50, remaining: 1 }),
      observation('Likes', { accountId: 'someone-else', limit: 500, remaining: 400 }),
    ]);
    render(<LimitsPanel accountId={ME} />);
    expect(
      await screen.findByText('Nothing observed yet. X reports its limits as you use it; they appear here.'),
    ).toBeInTheDocument();
  });

  it('lists the limits X reported, sorted, with Xomoni’s one-fifth stop and the reset time', async () => {
    await db.limits.bulkPut([
      observation('UserTweets', { limit: 500, remaining: 300, reset: NOW + 10 * MINUTE }),
      observation('DeleteTweet', { limit: 50, remaining: 45, reset: NOW + 10 * MINUTE }),
      observation('SearchTimeline', { status: 429, limit: 50, remaining: 0, reset: NOW + 4 * MINUTE }),
      observation('SomeNewOp', { reset: NOW - MINUTE }),
    ]);
    render(<LimitsPanel accountId={ME} />);

    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual([
      'Delete post',
      'Search',
      'SomeNewOp',
      'Profile timeline',
    ]);
    const [del, search, unknown, timeline] = rows.map((r) => r.lastElementChild!);

    expect(del).toHaveTextContent('5 used · stops at 10 of 50resets in 10m 0s');
    expect(del).not.toHaveClass('text-critical');
    // 200 of 500 used is past one fifth (100): Xomoni waits for the reset.
    expect(timeline).toHaveTextContent('200 used · stops at 100 of 500');
    expect(timeline).toHaveClass('text-critical');
    expect(search).toHaveTextContent('limitedresets in 4m 0s');
    expect(search).toHaveClass('text-critical');
    // No numbers from X, and a reset in the past is not shown.
    expect(unknown).toHaveTextContent(/^no live limit reported$/);
    expect(unknown).not.toHaveClass('text-critical');
  });
});

// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/shared/db';
import { baseline } from '../../src/shared/vault/reach-stats';
import { GUESS_NOTICE } from '../../src/shared/vault/suspects';
import type { LabelMonthRow } from '../../src/shared/vault/under-the-hood';
import { HowToGetUnderTheHood, LabelHistory } from '../../src/ui/components/reach/LabelHistory';
import { SuspectPosts } from '../../src/ui/components/reach/SuspectPosts';
import {
  MAX_DISMISSED,
  dismissedSuspects,
  setDismissed,
  suspectDismissedKey,
} from '../../src/shared/vault/suspect-dismissals';
import type { ReachRow } from '../../src/ui/reach';
import { resetDb } from '../support/fixtures';

const ME = '1000';
const DAY = 86_400_000;
const JUNE = Date.UTC(2026, 5, 1);
const JULY = Date.UTC(2026, 6, 1);

const month = (over: Partial<LabelMonthRow> = {}): LabelMonthRow => ({
  accountId: ME,
  month: '2026-07',
  importedAt: JULY + 40 * DAY,
  labels: [{ name: 'SPAM_HIGH_RECALL', count: 1, scope: 'posts' }],
  postsInMonth: 21,
  ...over,
});

/** A settled post as the page holds it. */
function row(id: string, createdAt: number, impressions: number, over: Partial<ReachRow> = {}): ReachRow {
  return {
    id,
    createdAt,
    kind: 'post',
    text: `Post ${id}`,
    format: 'text',
    impressions,
    source: 'live',
    asOf: createdAt + 30 * DAY,
    engagements: null,
    rate: null,
    links: 0,
    media: 0,
    quote: false,
    hour: 12,
    weekday: 1,
    premium: null,
    followersAtTime: null,
    ageAtAsOfDays: 30,
    onX: true,
    baseline: null,
    vsBaseline: null,
    growing: false,
    ...over,
  };
}

/** 30 June posts at 1,000 and July's: one seen 100 times, the rest as usual. */
const plain = [
  ...Array.from({ length: 30 }, (_, i) => row(String(100 + i), JUNE + i * DAY, 1_000)),
  row('7001', JULY + DAY, 100),
  ...Array.from({ length: 20 }, (_, i) => row(String(800 + i), JULY + (i + 2) * DAY, 950 + (i % 3) * 50)),
];
/** The same posts with their baselines, as the page has them. */
const bases = baseline(plain);
const rows = plain.map((r) => ({ ...r, baseline: bases.get(r.id) ?? null }));

describe('X’s labels on the Reach page (#429, ADR-0045)', () => {
  afterEach(cleanup);

  it('shows each month’s labels with X’s name, the posts, and the glossary’s meaning with its source', () => {
    render(<LabelHistory months={[month()]} />);
    const july = screen.getByRole('region', { name: 'July 2026' });
    const table = within(july).getByRole('table', { name: "X's labels in July 2026" });
    expect(table).toHaveTextContent('SPAM_HIGH_RECALL');
    expect(table).toHaveTextContent('1 of 21');
    expect(table).toHaveTextContent("The post isn't recommended to people who don't follow you.");
    expect(within(table).getByRole('link', { name: 'Roboin, 4 September 2026' })).toHaveAttribute(
      'href',
      'https://roboin.io/article/en/2026/09/04/checking-xs-official-shadowban-checker-under-the-hood/',
    );
  });

  it('says No labels that month, never clean; and when the account wasn’t eligible', () => {
    render(
      <LabelHistory
        months={[month({ month: '2026-08', labels: [], postsInMonth: 40 }), month({ eligible: false, labels: [] })]}
      />,
    );
    expect(screen.getByRole('region', { name: 'August 2026' })).toHaveTextContent(
      'No labels that month, across 40 posts.',
    );
    expect(screen.getByRole('region', { name: 'July 2026' })).toHaveTextContent("X says the account wasn't eligible");
    expect(document.body).not.toHaveTextContent(/clean/i);
  });

  it('shows an unknown label with X’s name only, or X’s own words from the file', () => {
    render(
      <LabelHistory
        months={[
          month({
            labels: [
              { name: 'MYSTERY', count: 2, scope: 'unknown' },
              { name: 'EXPLAINED', count: 1, scope: 'account', about: 'X said this.', effect: 'And this.' },
            ],
            governmentOrders: [{ country: 'Synthetic country', count: 3 }],
          }),
        ]}
      />,
    );
    expect(screen.getByRole('row', { name: /MYSTERY/ })).toHaveTextContent("X didn't explain this label.");
    expect(screen.getByRole('row', { name: /EXPLAINED/ })).toHaveTextContent("X's words: X said this. And this.");
    expect(screen.getByRole('row', { name: /EXPLAINED/ })).toHaveTextContent('The account');
    expect(screen.getByText(/Orders from governments that month: Synthetic country \(3\)/)).toBeInTheDocument();
  });

  it('shows a label name with markup as text', () => {
    const name = '<img src=x onerror=alert(1)>';
    render(<LabelHistory months={[month({ labels: [{ name, count: 1, scope: 'posts' }] })]} />);
    expect(screen.getByRole('table')).toHaveTextContent(name);
    expect(screen.getByRole('table').querySelector('img')).toBeNull();
  });

  it('says how to get the file when there is none, with X’s page in a normal link', () => {
    render(<LabelHistory months={[]} />);
    expect(screen.getByText('No Under the hood reports yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Under the hood' })).toHaveAttribute(
      'href',
      'https://x.com/i/under_the_hood',
    );
    cleanup();
    render(<HowToGetUnderTheHood />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('suspected posts on the Reach page (#429, ADR-0045, point 4)', () => {
  beforeEach(resetDb);
  afterEach(cleanup);

  it('shows the guess box, the candidate with its reasons, and never a link to a cleanup', async () => {
    render(<SuspectPosts accountId={ME} rows={rows} months={[month()]} handle="me" />);
    expect(await screen.findByText(GUESS_NOTICE)).toBeVisible();
    const july = screen.getByRole('region', { name: 'SPAM_HIGH_RECALL in July 2026' });
    expect(july).toHaveTextContent('Post 7001');
    expect(july).toHaveTextContent('Seen 100 times: 10% of your usual 1,000 for text posts');
    expect(july).toHaveTextContent(/Low confidence|Medium confidence/);
    expect(within(july).getByRole('link', { name: /Open on X/ })).toHaveAttribute(
      'href',
      'https://x.com/me/status/7001',
    );
    for (const link of screen.getAllByRole('link')) expect(link.getAttribute('href')).not.toMatch(/cleanup/);
    expect(document.body).not.toHaveTextContent(/cleanup|delete/i);
  });

  it('dismisses a candidate, keeps the box, and brings them back', async () => {
    render(<SuspectPosts accountId={ME} rows={rows} months={[month()]} handle="me" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Post 7001')).not.toBeInTheDocument());
    expect(screen.getByText(GUESS_NOTICE)).toBeVisible();
    expect(screen.getByText('You dismissed every suggestion for this label.')).toBeInTheDocument();
    expect(await dismissedSuspects(ME)).toEqual(['7001']);
    await userEvent.click(screen.getByRole('button', { name: 'Show the 1 dismissed again' }));
    expect(await screen.findByText('Post 7001')).toBeInTheDocument();
  });

  it('says why there is no guess: without a report, or without a label on posts', async () => {
    render(<SuspectPosts accountId={ME} rows={rows} months={[]} handle="me" />);
    expect(await screen.findByText(/Xomoni never guesses without it/)).toBeInTheDocument();
    expect(screen.getByText(GUESS_NOTICE)).toBeVisible();
    cleanup();
    render(<SuspectPosts accountId={ME} rows={rows} months={[month({ labels: [] })]} handle="me" />);
    expect(await screen.findByText(/nothing to guess/)).toBeInTheDocument();
    cleanup();
    render(
      <SuspectPosts
        accountId={ME}
        rows={rows}
        months={[month({ labels: [{ name: 'ACCOUNT_THING', count: 1, scope: 'account' }] })]}
        handle="me"
      />,
    );
    expect(await screen.findByText(/to the account, not to posts/)).toBeInTheDocument();
  });

  it('keeps dismissals as post ids only, at most 1,000, and reads anything else as none', async () => {
    await db.kv.put({ key: suspectDismissedKey(ME), value: 'not a list' });
    expect(await dismissedSuspects(ME)).toEqual([]);
    await db.kv.put({ key: suspectDismissedKey(ME), value: ['1', '<b>', 2, '3'] });
    expect(await dismissedSuspects(ME)).toEqual(['1', '3']);
    await setDismissed(ME, '1', false);
    expect(await dismissedSuspects(ME)).toEqual(['3']);
    await db.kv.put({
      key: suspectDismissedKey(ME),
      value: Array.from({ length: MAX_DISMISSED + 5 }, (_, j) => String(j)),
    });
    await setDismissed(ME, '999999', true);
    const kept = await dismissedSuspects(ME);
    expect(kept).toHaveLength(MAX_DISMISSED);
    expect(kept.at(-1)).toBe('999999');
  });
});

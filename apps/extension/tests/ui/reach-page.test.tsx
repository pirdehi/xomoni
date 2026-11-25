// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, itemKey } from '../../src/shared/db';
import type { Item } from '../../src/shared/types';
import { ReachPage } from '../../src/ui/pages/Reach';
import {
  type ReachRow,
  bestAndWorst,
  filterRows,
  histogram,
  reachData,
  sortRows,
  vsUsualWords,
} from '../../src/ui/reach';
import { ReachDistribution } from '../../src/ui/components/reach/ReachDistribution';
import { REACH_PAGE_SIZE } from '../../src/ui/components/reach/ReachTable';
import { stubChrome } from '../support/chrome';
import { ME, account, resetDb } from '../support/fixtures';

const DAY = 86_400_000;
const NOW = Date.now();

/** What the page says while it has no number: where they come from today, and nothing it can't do yet. */
const EMPTY_WORDS =
  "Reach's numbers come from the views X shows on your own posts and replies. Open your profile on X, and Xomoni keeps the views it shows. More sources are coming.";

/** One of the person's posts, made `daysAgo` days ago and seen live `views` times a day ago. */
function post(id: string, daysAgo: number, views: number | undefined, over: Partial<Item> = {}): Item {
  const kind = over.kind ?? 'post';
  return {
    key: itemKey(ME, kind, id),
    accountId: ME,
    kind,
    id,
    targetId: id,
    createdAt: NOW - daysAgo * DAY,
    likedAt: null,
    text: `Post ${id}`,
    author: 'me',
    inReplyToId: null,
    selfReply: false,
    likes: 1,
    reposts: 0,
    replies: 0,
    sources: ['scan'],
    status: 'present',
    seenAt: NOW - DAY,
    statusAt: NOW,
    lastJobId: null,
    links: 0,
    media: 0,
    ...(views !== undefined && { views }),
    ...over,
  };
}

/** A row as the page holds it. */
function row(id: string, over: Partial<ReachRow> = {}): ReachRow {
  return {
    id,
    createdAt: NOW,
    kind: 'post',
    text: '',
    format: 'text',
    impressions: 100,
    source: 'live',
    asOf: NOW,
    engagements: 1,
    rate: 0.01,
    links: 0,
    media: 0,
    quote: false,
    hour: 12,
    weekday: 1,
    premium: null,
    followersAtTime: null,
    ageAtAsOfDays: 10,
    onX: true,
    baseline: null,
    vsBaseline: null,
    growing: false,
    ...over,
  };
}

const table = () => screen.getByRole('table', { name: "Each post's reach" });
const bodyRows = () => within(table()).getAllByRole('row').slice(1);
const press = (name: string) => userEvent.click(screen.getByRole('button', { name }));

async function renderPage() {
  render(<ReachPage account={account()} />);
  await screen.findByRole('heading', { level: 1, name: 'Reach' });
}

describe('the Reach page (#429, ADR-0045)', () => {
  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('says where reach comes from when there is none yet', async () => {
    await db.items.bulkPut([post('1', 3, undefined), post('2', 3, undefined, { kind: 'like' })]);
    await renderPage();
    expect(await screen.findByText('No reach to show yet')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_WORDS)).toBeInTheDocument();
    // Nothing in this version reads X's analytics export, so the page neither offers it nor asks for X Premium.
    expect(screen.queryByText(/analytics|Premium|import/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('links the digest of X’s ranking code on xomoni.com, with numbers or without (#430)', async () => {
    await renderPage();
    const link = await screen.findByRole('link', { name: 'Read the digests on xomoni.com' });
    expect(link).toHaveAttribute('href', 'https://xomoni.com/algorithm');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('heading', { level: 2, name: 'What changed in X’s ranking code' })).toBeInTheDocument();
  });

  it('fills the table from the views Xomoni saw live, each with its Live badge and a link to X', async () => {
    await db.items.bulkPut([post('11', 10, 1_200), post('12', 9, 40, { kind: 'reply' })]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    const [newest, oldest] = bodyRows();
    expect(newest).toHaveTextContent('Reply · Post 12');
    expect(newest).toHaveTextContent('40');
    expect(oldest).toHaveTextContent('1,200');
    expect(within(oldest!).getByText('Live')).toBeInTheDocument();
    expect(within(oldest!).getByRole('link', { name: 'Open on X' })).toHaveAttribute(
      'href',
      'https://x.com/me/status/11',
    );
    expect(screen.getByText(/Views Xomoni saw on X: 2 posts, as last seen/)).toBeInTheDocument();
  });

  it('marks a post read before it was 7 days old as still growing, and doesn’t compare it', async () => {
    await db.items.bulkPut([post('21', 3, 500)]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(within(bodyRows()[0]!).getByText('Still growing')).toBeInTheDocument();
    expect(bodyRows()[0]).toHaveTextContent('—');
  });

  it('shows a post’s share of its usual once 15 posts of its kind came before it', async () => {
    await db.items.bulkPut([
      ...Array.from({ length: 15 }, (_, i) => post(`b${i}`, 28 - i, 1_000)),
      post('low', 12, 250),
    ]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(16));
    await press('Below usual');
    expect(bodyRows()[0]).toHaveTextContent('Post low');
    expect(bodyRows()[0]).toHaveTextContent('25% of usual');
  });

  it('filters by kind and by format, and starts again at page 1', async () => {
    await db.items.bulkPut([
      post('p1', 10, 10, { links: 1 }),
      post('p2', 11, 20, { media: 2 }),
      post('p3', 12, 30),
      post('r1', 13, 40, { kind: 'reply' }),
    ]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(4));
    await press('Replies');
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent('Post r1');
    await press('Posts');
    await press('A link');
    expect(bodyRows().map((r) => r.textContent)).toEqual([expect.stringContaining('Post p1')]);
    await press('Photos or videos');
    expect(bodyRows()[0]).toHaveTextContent('Post p2');
    await press('Text only');
    expect(bodyRows()[0]).toHaveTextContent('Post p3');
  });

  it('sorts by date, by reach and by share of usual', async () => {
    await db.items.bulkPut([post('a', 10, 300), post('b', 12, 900), post('c', 11, 100)]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const order = () => bodyRows().map((r) => r.getAttribute('data-post'));
    expect(order()).toEqual(['a', 'c', 'b']);
    await press('Most seen');
    expect(order()).toEqual(['b', 'a', 'c']);
  });

  it('pages 25 posts at a time', async () => {
    await db.items.bulkPut(Array.from({ length: 30 }, (_, i) => post(`n${i}`, 8 + i * 0.1, 100 + i)));
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(REACH_PAGE_SIZE));
    expect(screen.getByText('30 posts · page 1 of 2')).toBeInTheDocument();
    await press('Next');
    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText('30 posts · page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('shows the last 30 days, and the longer periods with the Plus preview badge', async () => {
    await db.items.bulkPut([post('recent', 10, 50), post('old', 60, 70)]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    // The comparisons and the suspected posts are Plus whatever the period; the period's own badge comes with 90 days
    // and everything.
    const badges = () => screen.getAllByText('Plus · preview');
    expect(badges()).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: 'Period' })).queryByText('Plus · preview')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Comparisons' })).getByText('Plus · preview')).toBeVisible();
    await press('90 days');
    await waitFor(() => expect(bodyRows()).toHaveLength(2));
    expect(badges()).toHaveLength(3);
    expect(within(screen.getByRole('group', { name: 'Period' })).getByText('Plus · preview')).toBeVisible();
    await press('Everything');
    expect(badges()).toHaveLength(3);
  });

  it('draws the spread as a chart and as a table with the same numbers', async () => {
    await db.items.bulkPut([post('s1', 10, 5), post('s2', 11, 50), post('s3', 12, 55), post('s4', 13, 5_000)]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(4));
    const chart = screen.getByRole('img', { name: /Posts by how many times they were seen/ });
    expect(chart).toHaveAccessibleName(
      'Posts by how many times they were seen. 1–9: 1, 10–99: 2, 100–999: 0, 1K–10K: 1',
    );
    await press('Table');
    const spread = screen.getByRole('table', { name: 'Posts by how many times they were seen' });
    expect(
      within(spread)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual(['SeenPosts', '1–91', '10–992', '100–9990', '1K–10K1']);
  });

  it('lists the most and least seen settled posts, never one still growing', async () => {
    await db.items.bulkPut([post('top', 10, 9_000), post('bottom', 11, 2), post('young', 2, 1)]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(3));
    const most = screen.getByRole('region', { name: 'Most seen' });
    const least = screen.getByRole('region', { name: 'Least seen' });
    expect(within(most).getAllByRole('listitem')[0]).toHaveTextContent('Post top');
    expect(within(least).getAllByRole('listitem')[0]).toHaveTextContent('Post bottom');
    expect(screen.getByRole('region', { name: 'Least seen' })).not.toHaveTextContent('Post young');
  });

  it('shows a post’s text as text, never as markup', async () => {
    await db.items.bulkPut([post('x', 10, 5, { text: '<img src=x onerror="alert(1)">' })]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(bodyRows()[0]).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(table().querySelector('img')).toBeNull();
  });

  it('links a removed post nowhere, and keeps its reach', async () => {
    await db.items.bulkPut([post('gone', 10, 77, { status: 'deleted' })]);
    await renderPage();
    await waitFor(() => expect(bodyRows()).toHaveLength(1));
    expect(bodyRows()[0]).toHaveTextContent('77');
    expect(within(bodyRows()[0]!).queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('how reach spreads', () => {
  afterEach(cleanup);

  it('says when no post is settled yet, and links only posts still on X', () => {
    render(<ReachDistribution rows={[row('young', { growing: true })]} handle="me" />);
    expect(within(screen.getByRole('region', { name: 'Most seen' })).getByText('No settled posts yet.')).toBeVisible();
    cleanup();
    render(
      <ReachDistribution
        rows={[row('on', { text: 'Still there', impressions: 9 }), row('off', { text: 'Removed', onX: false })]}
        handle="me"
      />,
    );
    const most = screen.getByRole('region', { name: 'Most seen' });
    expect(within(most).getByText('Removed')).toBeInTheDocument();
    expect(within(most).queryByRole('link', { name: 'Removed' })).not.toBeInTheDocument();
    expect(within(most).getByRole('link', { name: 'Still there' })).toHaveAttribute(
      'href',
      'https://x.com/me/status/on',
    );
  });
});

describe('the Reach page’s helpers', () => {
  beforeEach(resetDb);
  afterEach(() => vi.restoreAllMocks());

  it('keep only rows with a number, of the kind and format asked for', () => {
    const rows = [
      row('1'),
      row('2', { impressions: null, source: null }),
      row('3', { kind: 'reply', format: 'reply' }),
    ];
    expect(filterRows(rows, { kind: 'all', format: 'all' }).map((r) => r.id)).toEqual(['1', '3']);
    expect(filterRows(rows, { kind: 'reply', format: 'all' }).map((r) => r.id)).toEqual(['3']);
    expect(filterRows(rows, { kind: 'all', format: 'link' })).toEqual([]);
  });

  it('sort below usual with posts without a baseline last, ties to the newer', () => {
    const rows = [
      row('none', { createdAt: NOW }),
      row('half', { vsBaseline: 0.5, createdAt: NOW - 1 }),
      row('fifth', { vsBaseline: 0.2, createdAt: NOW - 2 }),
      row('half-newer', { vsBaseline: 0.5, createdAt: NOW + 1 }),
    ];
    expect(sortRows(rows, 'vs-usual').map((r) => r.id)).toEqual(['fifth', 'half-newer', 'half', 'none']);
    expect(sortRows(rows, 'newest')[0]?.id).toBe('half-newer');
  });

  it('bin the spread on a scale of tens, from the lowest bar used to the highest', () => {
    expect(histogram([])).toEqual([]);
    expect(histogram([row('a', { impressions: 0 }), row('b', { impressions: 2_000_000 })]).map((b) => b.label)).toEqual(
      ['0', '1–9', '10–99', '100–999', '1K–10K', '10K–100K', '100K–1M', '1M+'],
    );
    expect(histogram([row('a', { impressions: 10 }), row('b', { impressions: 99 })])).toEqual([
      { label: '10–99', from: 10, to: 100, count: 2 },
    ]);
  });

  it('pick the best and worst among settled posts only', () => {
    const rows = [
      row('big', { impressions: 1_000 }),
      row('small', { impressions: 1 }),
      row('growing', { impressions: 0, growing: true }),
      row('none', { impressions: null }),
    ];
    const { best, worst } = bestAndWorst(rows, 1);
    expect(best.map((r) => r.id)).toEqual(['big']);
    expect(worst.map((r) => r.id)).toEqual(['small']);
  });

  it('word a share of usual', () => {
    expect(vsUsualWords(0.254)).toBe('25% of usual');
    expect(vsUsualWords(12.5)).toBe('1,250% of usual');
    expect(vsUsualWords(null)).toBe('—');
  });

  it('read a period with the 8 weeks before it for baselines, and count the sources', async () => {
    const items = [
      ...Array.from({ length: 15 }, (_, i) => post(`old${i}`, 60 - i, 1_000)),
      post('in', 20, 100),
      post('unseen', 25, undefined),
    ];
    await db.items.bulkPut(items);
    const data = await reachData(ME, '30d', NOW);
    expect(data.rows.map((r) => r.id)).toEqual(['unseen', 'in']);
    expect(data.rows.find((r) => r.id === 'in')).toMatchObject({ baseline: 1_000, vsBaseline: 0.1, growing: false });
    expect(data).toMatchObject({ csv: 0, live: 1, lastSeen: NOW - DAY });
    expect((await reachData(ME, 'all', NOW)).rows).toHaveLength(17);
    expect(await reachData('nobody', '30d', NOW)).toEqual({ rows: [], csv: 0, live: 0, lastSeen: null, periods: [] });
  });

  it('read 200,000 posts seen live on Everything, more than a call’s arguments can take, with the last one seen', async () => {
    // One post every half hour, for over 11 years; one was seen an hour ago, the rest a day ago. X's index answers with
    // them all; filling fake-indexeddb with as many would take minutes.
    const many = Array.from({ length: 200_000 }, (_, i) =>
      post(String(1_000_000 + i), (200_000 - i) / 48, i, i === 123_456 ? { seenAt: NOW - 3_600_000 } : {}),
    );
    // Everything is read through the primary key, the quicker read of a whole kind (#501).
    vi.spyOn(db.items, 'where').mockImplementation((() => ({
      between: (lower: string) => ({
        toArray: () => Promise.resolve(lower === itemKey(ME, 'post', '') ? many : []),
      }),
    })) as never);

    const data = await reachData(ME, 'all', NOW);

    expect(data.rows).toHaveLength(200_000);
    expect(data).toMatchObject({ csv: 0, live: 200_000, lastSeen: NOW - 3_600_000 });
  });
});

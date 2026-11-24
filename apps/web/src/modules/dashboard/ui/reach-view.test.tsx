// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { REACH_GUESS_NOTICE, type ReachSummary, usesBannedReachWord } from '@xomoni/bridge';
import { describe, expect, it } from 'vitest';
import { ReachView } from './reach-view';

const NOW = new Date(2026, 10, 20, 15, 30).getTime();

const summary = (over: Partial<ReachSummary> = {}): ReachSummary => ({
  rangeDays: 30,
  csv: 0,
  live: 2,
  comparisons: [
    {
      id: 'links',
      verdict: 'clear-lower',
      a: { n: 20, median: 500 },
      b: { n: 22, median: 1_000 },
      ratio: 0.52,
      low: 0.41,
      high: 0.66,
    },
    {
      id: 'premium',
      verdict: 'not-enough-data',
      a: { n: 3, median: null },
      b: { n: 0, median: null },
      ratio: null,
      low: null,
      high: null,
    },
  ],
  months: [
    {
      month: '2026-08',
      labels: [{ name: 'SPAM_HIGH_RECALL', count: 2, scope: 'posts' }],
      postsInMonth: 40,
      eligible: null,
    },
    { month: '2026-07', labels: [], postsInMonth: 30, eligible: null },
  ],
  posts: [
    {
      id: '1800000000000000001',
      createdAt: NOW,
      text: '<img src=x onerror=alert(1)>',
      impressions: 1_200,
      source: 'live',
      vsUsual: 0.25,
    },
  ],
  total: 1,
  suspects: [
    {
      id: '1800000000000000001',
      month: '2026-08',
      label: 'SPAM_HIGH_RECALL',
      confidence: 'low',
      ratio: 0.1,
      reasons: ['Seen 100 times: 10% of your usual 1,000 for text posts.'],
      guess: true,
    },
  ],
  ...over,
});

describe('Reach on xomoni.com (#431, ADR-0045)', () => {
  it('shows each comparison with the extension’s verdict words and its sentence, or the sides without numbers', () => {
    render(<ReachView summary={summary()} handle="me" />);
    const links = screen.getByRole('article', { name: 'Posts with a link, against posts without' });
    expect(links).toHaveTextContent('Clearly lower');
    expect(links).toHaveTextContent(
      'Posts with a link were seen 52% as much as posts without (95% interval 41% to 66%).',
    );
    const premium = screen.getByRole('article', { name: 'With Premium, against before it' });
    expect(premium).toHaveTextContent('Not enough data');
    expect(premium).toHaveTextContent('With Premium: 3 posts. Before: 0 posts. Each side needs 15.');
  });

  it('lists the posts with their numbers and links to X, their text as text', () => {
    render(<ReachView summary={summary()} handle="me" />);
    const posts = screen.getByRole('region', { name: 'Posts' });
    expect(posts).toHaveTextContent('1,200 seen');
    expect(posts).toHaveTextContent('25% of usual');
    expect(posts).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(posts.querySelector('img')).toBeNull();
    expect(within(posts).getByRole('link', { name: /Open on X/ })).toHaveAttribute(
      'href',
      'https://x.com/me/status/1800000000000000001',
    );
  });

  it('always shows the guess box over the suspected posts, and never a cleanup', () => {
    render(<ReachView summary={summary()} handle="me" />);
    const guesses = screen.getByRole('region', { name: 'Suspected posts' });
    expect(within(guesses).getByText(REACH_GUESS_NOTICE)).toBeInTheDocument();
    expect(guesses).toHaveTextContent('SPAM_HIGH_RECALL · August 2026 · Low confidence');
    expect(guesses).toHaveTextContent('Seen 100 times');
    expect(guesses.textContent).not.toMatch(/clean ?up|delete|remove/i);
    for (const link of within(guesses).getAllByRole('link'))
      expect(link.getAttribute('href')).toMatch(/^https:\/\/x\.com\//);
  });

  it('keeps the guess box when there is no guess, and says why', () => {
    render(<ReachView summary={summary({ suspects: [], months: [] })} handle="me" />);
    const guesses = screen.getByRole('region', { name: 'Suspected posts' });
    expect(within(guesses).getByText(REACH_GUESS_NOTICE)).toBeInTheDocument();
    expect(guesses).toHaveTextContent("Xomoni guesses only from X's Under the hood report, and has none yet.");
  });

  it('shows X’s months, a month without labels as such, and how to get the report', () => {
    render(<ReachView summary={summary()} handle="me" />);
    const labels = screen.getByRole('region', { name: "X's labels" });
    expect(within(labels).getByRole('group', { name: 'August 2026' })).toHaveTextContent('SPAM_HIGH_RECALL: 2 posts');
    expect(within(labels).getByRole('group', { name: 'July 2026' })).toHaveTextContent(
      'No labels that month, across 30 posts.',
    );
    expect(labels.textContent).not.toMatch(/clean/i);
  });

  it('says what there is when nothing is', () => {
    render(<ReachView summary={summary({ posts: [], months: [], suspects: [], comparisons: [] })} handle="me" />);
    expect(screen.getByText('No post with a number in this period.')).toBeInTheDocument();
    expect(screen.getByText(/No Under the hood report yet/)).toBeInTheDocument();
  });

  it('never says a post was banned, penalized, suppressed or throttled', () => {
    const { container } = render(<ReachView summary={summary()} handle="me" />);
    expect(usesBannedReachWord(container.textContent)).toBe(false);
  });
});

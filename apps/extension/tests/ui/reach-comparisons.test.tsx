// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ReachComparisons } from '../../src/ui/components/reach/ReachComparisons';
import type { ReachRow } from '../../src/ui/reach';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 1);

/** A settled post as the page holds it. */
function row(id: string, impressions: number, over: Partial<ReachRow> = {}): ReachRow {
  return {
    id,
    createdAt: NOW - 20 * DAY,
    kind: 'post',
    text: '',
    format: 'text',
    impressions,
    source: 'live',
    asOf: NOW,
    engagements: null,
    rate: null,
    links: 0,
    media: 0,
    quote: false,
    hour: 9,
    weekday: 2,
    premium: null,
    followersAtTime: 500,
    ageAtAsOfDays: 20,
    onX: true,
    baseline: null,
    vsBaseline: null,
    growing: false,
    ...over,
  };
}

/** `n` rows seen about `center` times, with `over`. */
const many = (prefix: string, n: number, center: number, over: Partial<ReachRow> = {}) =>
  Array.from({ length: n }, (_, i) =>
    row(`${prefix}${String(i)}`, Math.round(center * (0.8 + (0.4 * i) / (n - 1))), over),
  );

const card = (title: string) => screen.getByRole('region', { name: title });
/** The verdict badge in the header of the card around the region named `title`. */
const verdictOf = (title: string) => card(title).parentElement?.closest('section')?.querySelector('[data-verdict]');

describe('Reach’s comparisons (#429, ADR-0045)', () => {
  afterEach(cleanup);

  it('says clearly lower for links at half the reach, with each side and the interval', () => {
    render(<ReachComparisons rows={[...many('l', 30, 500, { links: 1 }), ...many('t', 30, 1_000)]} periods={[]} />);
    const links = card('Posts with a link, against posts without');
    expect(document.querySelector('[data-verdict="clear-lower"]')).toHaveTextContent('Clearly lower');
    expect(within(links).getAllByText('30 posts')).toHaveLength(2);
    expect(links).toHaveTextContent(/Posts with a link were seen \d+% as much as posts without/);
    expect(links).toHaveTextContent('95% interval');
  });

  it('says not enough data, and nothing more, below 15 posts a side', () => {
    render(<ReachComparisons rows={[...many('l', 14, 100, { links: 1 }), ...many('t', 30, 1_000)]} periods={[]} />);
    const links = card('Posts with a link, against posts without');
    expect(verdictOf('Posts with a link, against posts without')).toHaveTextContent('Not enough data');
    expect(links).toHaveTextContent('Each side needs at least 15 posts');
    expect(links).not.toHaveTextContent('95% interval');
    expect(within(links).getByText('14 posts')).toBeInTheDocument();
  });

  it('says clearly higher for photos seen twice as much as text', () => {
    render(<ReachComparisons rows={[...many('m', 20, 2_000, { media: 1 }), ...many('t', 20, 1_000)]} periods={[]} />);
    expect(verdictOf('Posts with photos or videos, against text only')).toHaveTextContent('Clearly higher');
  });

  it('compares Premium with before it once Xomoni knows when it began, and says it can’t without', () => {
    const start = NOW - 70 * DAY;
    const before = many('b', 20, 1_000).map((r, i) => ({ ...r, createdAt: start - (i + 1) * DAY }));
    const after = many('a', 20, 3_000).map((r, i) => ({ ...r, createdAt: start + (8 + i) * DAY }));
    render(<ReachComparisons rows={[...before, ...after]} periods={[{ from: start, to: null }]} />);
    expect(verdictOf('With Premium, against before it')).toHaveTextContent('Clearly higher');
    expect(card('With Premium, against before it')).toHaveTextContent(
      /Posts with Premium were seen \d+% as much as posts before it/,
    );
    cleanup();
    render(<ReachComparisons rows={[...before, ...after]} periods={[]} />);
    expect(card('With Premium, against before it')).toHaveTextContent(
      "Xomoni doesn't know yet when you got Premium, so it can't compare.",
    );
  });

  it('folds out how it is computed and what can mislead it, and folds it away again', async () => {
    render(<ReachComparisons rows={[...many('l', 20, 500, { links: 1 }), ...many('t', 20, 1_000)]} periods={[]} />);
    const links = card('Posts with a link, against posts without');
    const button = within(links).getByRole('button', { name: 'How this is computed' });
    expect(links).not.toHaveTextContent('2,000 resamples');
    await userEvent.click(button);
    expect(links).toHaveTextContent('2,000 resamples');
    expect(links).toHaveTextContent('It shows what goes together, not why.');
    expect(links).toHaveTextContent('Your followers: about 500 for the first group');
    await userEvent.click(button);
    expect(links).not.toHaveTextContent('2,000 resamples');
  });

  it('gives the usual reach by day and time of day, with not enough data below 15', () => {
    render(
      <ReachComparisons rows={[...many('t', 16, 1_000), ...many('s', 2, 10, { weekday: 0, hour: 22 })]} periods={[]} />,
    );
    const days = screen.getByRole('table', { name: 'Day' });
    const tuesday = within(days).getByRole('row', { name: /Tuesday/ });
    expect(tuesday).toHaveTextContent('16');
    expect(tuesday).not.toHaveTextContent('Not enough data');
    expect(within(days).getByRole('row', { name: /Sunday/ })).toHaveTextContent('Not enough data');
    const parts = screen.getByRole('table', { name: 'Time of day' });
    expect(within(parts).getByRole('row', { name: /Morning/ })).toHaveTextContent('16');
    expect(within(parts).getByRole('row', { name: /Evening/ })).toHaveTextContent('2');
  });

  it('says not enough data everywhere with nothing to compare', () => {
    render(<ReachComparisons rows={[]} periods={[]} />);
    expect([...document.querySelectorAll('[data-verdict]')].map((v) => v.textContent)).toEqual([
      'Not enough data',
      'Not enough data',
      'Not enough data',
    ]);
  });
});

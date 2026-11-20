// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DailyNumbers } from '../domain/model';
import { Content } from './content';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const MONTH = { account: null, period: '30d' as const };

function day(d: string, over: Partial<DailyNumbers> = {}): DailyNumbers {
  return {
    xHandle: 'ada_x',
    day: d,
    followers: null,
    following: null,
    postsTotal: null,
    likesTotal: null,
    postedPosts: 0,
    postedReplies: 0,
    postedReposts: 0,
    postedQuotes: 0,
    receivedLikes: 0,
    receivedReplies: 0,
    receivedReposts: 0,
    receivedQuotes: 0,
    receivedViews: 0,
    observedPosts: 0,
    postsWithLikes: 0,
    repliesWithLikes: 0,
    removedPosts: 0,
    removedReplies: 0,
    removedReposts: 0,
    removedLikes: 0,
    updatedAt: `${d}T20:00:00Z`,
    ...over,
  };
}

const inXomoni = <button type="button">Open in Xomoni</button>;

describe('Content (#254)', () => {
  it('shows each type against the period before, by type over time, and the weekday you publish most', () => {
    render(
      <Content
        days={[
          day('2026-10-15', { postedPosts: 1 }),
          // Mondays: 2026-11-16 and 2026-11-09.
          day('2026-11-16', { postedPosts: 3, postedReplies: 4 }),
          day('2026-11-09', { postedPosts: 1, postedReposts: 2, postedQuotes: 1 }),
          day('2026-11-18', { postedReplies: 2 }),
        ]}
        scope={MONTH}
        now={NOW}
        shown
        inXomoni={inXomoni}
      />,
    );
    const tiles = within(screen.getByRole('list', { name: 'What you published' })).getAllByRole('listitem');
    expect(tiles.map((t) => t.textContent)).toEqual([
      'Posts4+3 (+300%) vs the 30 days before',
      'Replies6+6 vs the 30 days before',
      'Reposts2+2 vs the 30 days before',
      'Quotes1+1 vs the 30 days before',
    ]);
    expect(screen.getByRole('img', { name: 'Posts, replies, reposts and quotes: 13 in all' })).toBeInTheDocument();
    const when = screen.getByRole('region', { name: 'When you publish' });
    expect(when).toHaveTextContent('You publish most on Mondays.');
    const meters = within(when)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(meters[0]).toBe('Mon5.5');
    expect(meters[1]).toBe('Tue—');
    expect(meters[2]).toBe('Wed2.0');
    expect(screen.getByRole('region', { name: 'From your posts, in Xomoni' })).toHaveTextContent(
      'which never leave your computer',
    );
    expect(screen.getByRole('button', { name: 'Open in Xomoni' })).toBeInTheDocument();
  });

  it('says so when nothing was published on the days with numbers', () => {
    render(<Content days={[day('2026-11-18')]} scope={MONTH} now={NOW} shown inXomoni={inXomoni} />);
    expect(screen.getByRole('region', { name: 'When you publish' })).toHaveTextContent(
      'Nothing published on the days with numbers yet.',
    );
  });

  it('says where to turn the numbers on, or that they come with the next report', () => {
    const { unmount } = render(<Content days={[]} scope={MONTH} now={NOW} shown={false} inXomoni={inXomoni} />);
    expect(screen.getByRole('region', { name: 'No numbers yet' })).toHaveTextContent(
      'once you turn on Show my numbers on xomoni.com',
    );
    expect(screen.getByRole('link', { name: 'Turn them on in Overview' })).toHaveAttribute('href', '/dashboard');
    unmount();
    render(<Content days={[]} scope={MONTH} now={NOW} shown inXomoni={inXomoni} />);
    expect(screen.getByRole('region', { name: 'No numbers yet' })).toHaveTextContent('Xomoni’s next report');
    expect(screen.getByRole('region', { name: 'From your posts, in Xomoni' })).toBeInTheDocument();
  });
});

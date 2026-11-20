// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DailyNumbers } from '../domain/model';
import { Engagement } from './engagement';

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

describe('Engagement (#255)', () => {
  it('shows what the posts received as estimates, against the period before, with its charts', () => {
    render(
      <Engagement
        days={[
          day('2026-10-15', { receivedLikes: 10, receivedViews: 1000 }),
          day('2026-11-16', {
            receivedLikes: 30,
            receivedReplies: 6,
            receivedReposts: 2,
            receivedQuotes: 1,
            receivedViews: 1500,
            observedPosts: 40,
            postsWithLikes: 12,
            repliesWithLikes: 4,
          }),
        ]}
        scope={MONTH}
        now={NOW}
        shown
        inXomoni={inXomoni}
      />,
    );
    expect(screen.getByText(/Estimates: Xomoni counts what it saw rise on your posts/)).toHaveTextContent(
      'over 40 sightings in this period',
    );
    const tiles = within(screen.getByRole('list', { name: 'What your posts received' })).getAllByRole('listitem');
    expect(tiles.map((t) => t.textContent)).toEqual([
      'Likes received30+20 (+200%) vs the 30 days before',
      'Replies received6+6 vs the 30 days before',
      'Reposts and quotes3+3 vs the 30 days before',
      'Views1,500+500 (+50%) vs the 30 days before',
      'Engagement rate2.6%+1.6 pt vs the 30 days before',
      'Seen with at least one like40%4 of them replies',
    ]);
    expect(
      screen.getByRole('img', { name: 'Likes, replies, reposts and quotes received: 39 in all' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Views: 1,500 in all' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Engagement rate, per 100 views/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your most-liked replies' })).toHaveTextContent(
      'which never leave your computer',
    );
  });

  it('says what is missing without views', () => {
    render(
      <Engagement days={[day('2026-11-16', { receivedLikes: 2 })]} scope={MONTH} now={NOW} shown inXomoni={inXomoni} />,
    );
    const tiles = within(screen.getByRole('list', { name: 'What your posts received' })).getAllByRole('listitem');
    expect(tiles[4]).toHaveTextContent('Engagement rate—No views seen yet');
    expect(tiles[5]).toHaveTextContent('Seen with at least one like—');
    expect(screen.getByText('No views seen in this period yet.')).toBeInTheDocument();
  });

  it('says where to turn the numbers on, or that they come with the next report', () => {
    const { unmount } = render(<Engagement days={[]} scope={MONTH} now={NOW} shown={false} inXomoni={inXomoni} />);
    expect(screen.getByRole('region', { name: 'No numbers yet' })).toHaveTextContent(
      'once you turn on Show my numbers on xomoni.com',
    );
    expect(screen.getByRole('link', { name: 'Turn them on in Overview' })).toBeInTheDocument();
    unmount();
    render(<Engagement days={[]} scope={MONTH} now={NOW} shown inXomoni={inXomoni} />);
    expect(screen.getByRole('region', { name: 'No numbers yet' })).toHaveTextContent('Xomoni’s next report');
  });
});

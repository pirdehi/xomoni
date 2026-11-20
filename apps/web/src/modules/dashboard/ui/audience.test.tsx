// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DailyNumbers } from '../domain/model';
import { Audience } from './audience';

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

const archives = <button type="button">Open in Xomoni</button>;

describe('Audience (#253)', () => {
  it('shows where followers stand, what was gained and lost, the ratio, the charts and the milestones', () => {
    render(
      <Audience
        days={[
          day('2026-11-10', { followers: 990, following: 400 }),
          day('2026-11-12', { followers: 1004, following: 400 }),
          day('2026-11-15', { followers: 998, following: 410 }),
          day('2026-11-18', { followers: 1010, following: 404 }),
        ]}
        scope={MONTH}
        now={NOW}
        shown
        archives={archives}
      />,
    );
    const tiles = within(screen.getByRole('list', { name: 'Your audience in numbers' })).getAllByRole('listitem');
    expect(tiles[0]).toHaveTextContent('Followers1,010+20 in the last 30 days');
    expect(tiles[1]).toHaveTextContent('Gained26Most on Nov 12: +14');
    expect(tiles[2]).toHaveTextContent('Lost6Most on Nov 15: −6');
    expect(tiles[3]).toHaveTextContent('Followers per account you follow2.5You follow 404');

    expect(screen.getByRole('img', { name: 'Followers: 1,010 on Nov 18' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Followers gained or lost: +20 in all' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Following: 404 on Nov 18' })).toBeInTheDocument();
    const milestones = screen.getByRole('region', { name: 'Milestones' });
    expect(milestones).toHaveTextContent('1,000 followers on Nov 12');
    expect(milestones).toHaveTextContent('Next: 2,500, 1,490 to go.');
    expect(screen.getByRole('region', { name: 'Who followed or unfollowed you' })).toHaveTextContent(
      'the names stay there',
    );
    expect(screen.getByRole('button', { name: 'Open in Xomoni' })).toBeInTheDocument();
  });

  it('says what is missing instead of drawing empty charts', () => {
    render(<Audience days={[day('2026-11-18', { following: 0 })]} scope={MONTH} now={NOW} shown archives={archives} />);
    const tiles = within(screen.getByRole('list', { name: 'Your audience in numbers' })).getAllByRole('listitem');
    expect(tiles[0]).toHaveTextContent('Followers—No change to show yet');
    expect(tiles[1]).toHaveTextContent('No gains in this period');
    expect(tiles[2]).toHaveTextContent('No losses in this period');
    expect(tiles[3]).toHaveTextContent('—You follow 0');
    expect(screen.getByText(/No follower count in this period yet/)).toBeInTheDocument();
    expect(screen.getByText('It takes two days with a follower count to show a change.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Milestones' })).toHaveTextContent('No milestone in this period.');
  });

  it('says where to turn the numbers on, or that they come with the next report, and keeps the archive card', () => {
    const { unmount } = render(<Audience days={[]} scope={MONTH} now={NOW} shown={false} archives={archives} />);
    expect(screen.getByRole('region', { name: 'No numbers yet' })).toHaveTextContent(
      'once you turn on Show my numbers on xomoni.com',
    );
    expect(screen.getByRole('link', { name: 'Turn them on in Overview' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('region', { name: 'Who followed or unfollowed you' })).toBeInTheDocument();
    unmount();

    render(<Audience days={[]} scope={MONTH} now={NOW} shown archives={archives} />);
    expect(screen.getByRole('region', { name: 'No numbers yet' })).toHaveTextContent('Xomoni’s next report');
    expect(screen.queryByRole('link', { name: 'Turn them on in Overview' })).not.toBeInTheDocument();
  });

  it('shows following even before a follower count', () => {
    render(
      <Audience
        days={[day('2026-11-18', { following: 12, followers: null })]}
        scope={MONTH}
        now={NOW}
        shown
        archives={archives}
      />,
    );
    expect(screen.getByRole('img', { name: 'Following: 12 on Nov 18' })).toBeInTheDocument();
    expect(screen.queryByText('No following count in this period yet.')).not.toBeInTheDocument();
  });
});

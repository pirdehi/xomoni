import { describe, expect, it } from 'vitest';
import { MUTATION_OPS, PROFILE_OPS, TIMELINE_OPS, WATCHED_OPS } from '../src/shared/x-operations';

describe('the operations Xomoni reads from X (#61)', () => {
  it('forwards exactly the operations the content script parses, no more', () => {
    expect([...WATCHED_OPS].sort()).toEqual([...TIMELINE_OPS, ...MUTATION_OPS, ...PROFILE_OPS].sort());
  });

  it('watches the writes it confirms and the timelines it records', () => {
    expect([...MUTATION_OPS]).toEqual(['DeleteTweet', 'DeleteRetweet', 'FavoriteTweet', 'UnfavoriteTweet']);
    expect(TIMELINE_OPS.has('UserTweetsAndReplies')).toBe(true);
    expect(TIMELINE_OPS.has('HomeTimeline')).toBe(false);
  });
});

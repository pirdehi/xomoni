import { describe, expect, it } from 'vitest';
import { archiveLikeDrafts, archiveTweetDrafts } from '../src/shared/archive';
import { parseTweet, unavailableTweetIds } from '../src/shared/graphql';
import { isHandle, isXId, sameHandle } from '../src/shared/ids';
import { asPostId } from '../src/shared/json';

describe('X ids and handles (#144)', () => {
  it('takes digits only as an X id, up to the length of a 64-bit number', () => {
    expect(isXId('1')).toBe(true);
    expect(isXId('1859437268329648128')).toBe(true);
    expect(isXId('9'.repeat(20))).toBe(true);
    for (const bad of ['', '9'.repeat(21), '12a', ' 12', '12/../x', '-1', '1.5', '١٢٣'])
      expect(isXId(bad), JSON.stringify(bad)).toBe(false);
  });

  it('takes handles X allows', () => {
    expect(isHandle('pirdehi')).toBe(true);
    expect(isHandle('A_1')).toBe(true);
    for (const bad of ['', 'a'.repeat(16), 'me/status', 'me.x', '@me', 'امید'])
      expect(isHandle(bad), JSON.stringify(bad)).toBe(false);
  });

  it('compares handles as X does, ignoring case, and never matches an empty one', () => {
    expect(sameHandle('Pirdehi', 'pirdehi')).toBe(true);
    expect(sameHandle('pirdehi', 'someone')).toBe(false);
    expect(sameHandle('', '')).toBe(false);
  });

  it('reads post ids as digits only, from strings or whole numbers', () => {
    expect(asPostId('123')).toBe('123');
    expect(asPostId(123)).toBe('123');
    for (const bad of ['', 'abc', '1/2', 1.5, null, undefined, {}]) expect(asPostId(bad)).toBeUndefined();
  });
});

describe('parsers drop posts whose id isn’t an X id (#144)', () => {
  const tweet = (id: unknown, extra: object = {}) => ({ tweet: { id_str: id, full_text: 'hi', ...extra } });

  it('in the archive’s tweets and likes', () => {
    const drafts = archiveTweetDrafts([tweet('1001'), tweet('../settings'), tweet(''), tweet(1002)], '7', 'me');
    expect(drafts.map((d) => d.id)).toEqual(['1001', '1002']);
    const reply = archiveTweetDrafts([tweet('1003', { in_reply_to_status_id_str: 'x9' })], '7', 'me');
    expect(reply[0]).toMatchObject({ kind: 'post', inReplyToId: null });
    expect(
      archiveLikeDrafts([{ like: { tweetId: '2001' } }, { like: { tweetId: '2002?x' } }]).map((d) => d.id),
    ).toEqual(['2001']);
  });

  it('in X’s responses', () => {
    const result = (rest_id: string) => ({ __typename: 'Tweet', rest_id, legacy: { id_str: rest_id, full_text: '' } });
    expect(parseTweet(result('3001'), null)?.id).toBe('3001');
    expect(parseTweet(result('3001/x'), null)).toBeNull();
    const tomb = (rest_id: string) => ({ tweet_results: { result: { __typename: 'TweetUnavailable', rest_id } } });
    expect(unavailableTweetIds([tomb('4001'), tomb('4002x')])).toEqual(['4001']);
  });
});

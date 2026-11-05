import { describe, expect, it } from 'vitest';
import { MAX_DRAFTS, fromXPage, fromXomoniPage, parseRuntimeMessage } from '../src/shared/inbound';
import { POST_TIME_SLACK_MS, timeMatchesId } from '../src/shared/time';
import type { ItemDraft } from '../src/shared/types';
import { MAX_RESET_AHEAD_MS, capReset } from '../src/shared/x-limits';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const ME = '1000';

const draft: ItemDraft = {
  kind: 'reply',
  id: '1800000000000000000',
  targetId: '1800000000000000000',
  createdAt: Date.parse('2024-06-01T00:00:00Z'),
  likedAt: null,
  text: 'سلام',
  author: 'me',
  inReplyToId: '1700000000000000000',
  selfReply: true,
  likes: 3,
  reposts: 0,
  replies: 1,
};
const ingest = { type: 'ingest', accountId: ME, handle: 'me', op: 'UserTweets', drafts: [draft], observedAt: NOW };
const profile = {
  id: ME,
  handle: 'me',
  name: 'Me',
  avatar: 'https://pbs.twimg.com/profile_images/1/me_normal.jpg',
  postsCount: 10,
  likesCount: null,
  followers: 2,
  following: 3,
  createdAt: Date.parse('2012-01-01T00:00:00Z'),
  verified: false,
};
const obs = {
  key: `${ME}:Likes`,
  accountId: ME,
  op: 'Likes',
  limit: 500,
  remaining: 499,
  reset: NOW + 600_000,
  status: 200,
  at: NOW,
};

describe('messages from the content script, checked before the service worker stores them (#145)', () => {
  it('passes well-formed messages through as copies', () => {
    expect(parseRuntimeMessage(ingest, NOW)).toEqual(ingest);
    expect(parseRuntimeMessage({ type: 'profile', profile }, NOW)).toEqual({ type: 'profile', profile });
    expect(parseRuntimeMessage({ type: 'rate', obs }, NOW)).toEqual({ type: 'rate', obs });
    expect(parseRuntimeMessage({ ...ingest, handle: null }, NOW)).toMatchObject({ handle: null });
  });

  it('drops fields it doesn’t know, at every level', () => {
    const parsed = parseRuntimeMessage(
      { ...ingest, extra: 1, drafts: [{ ...draft, status: 'gone' }] },
      NOW,
    ) as typeof ingest;
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed.drafts[0]).not.toHaveProperty('status');
    expect(parseRuntimeMessage({ type: 'profile', profile: { ...profile, profileAt: 1 } }, NOW)).toEqual({
      type: 'profile',
      profile,
    });
  });

  it('takes up to MAX_DRAFTS posts in one message, and none from a longer list', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...draft, id: `${1000 + i}` }));
    expect(parseRuntimeMessage({ ...ingest, drafts: many(MAX_DRAFTS) }, NOW)).not.toBeNull();
    expect(parseRuntimeMessage({ ...ingest, drafts: many(MAX_DRAFTS + 1) }, NOW)).toBeNull();
    expect(parseRuntimeMessage({ ...ingest, drafts: [] }, NOW)).toBeNull();
    expect(parseRuntimeMessage({ ...ingest, drafts: 'all' }, NOW)).toBeNull();
  });

  it.each<[string, unknown]>([
    ['nothing', undefined],
    ['a string', 'ingest'],
    ['an unknown type', { ...ingest, type: 'delete' }],
    ['an account id with letters', { ...ingest, accountId: 'acct-me' }],
    ['a handle X doesn’t allow', { ...ingest, handle: 'me/../x' }],
    ['an operation that isn’t a timeline', { ...ingest, op: 'DeleteTweet' }],
    ['a time a year ahead', { ...ingest, observedAt: NOW + 365 * 86_400_000 }],
    ['a draft of an unknown kind', { ...ingest, drafts: [{ ...draft, kind: 'bookmark' }] }],
    ['a draft whose target isn’t an X id', { ...ingest, drafts: [{ ...draft, targetId: '../1' }] }],
    ['a draft with a negative count', { ...ingest, drafts: [{ ...draft, likes: -1 }] }],
    ['a draft with a fractional count', { ...ingest, drafts: [{ ...draft, reposts: 1.5 }] }],
    ['a draft with a text that isn’t text', { ...ingest, drafts: [{ ...draft, text: { html: '<b>' } }] }],
    ['a draft with a reply target that isn’t an X id', { ...ingest, drafts: [{ ...draft, inReplyToId: 'x' }] }],
    ['a draft with a like time that isn’t a time', { ...ingest, drafts: [{ ...draft, likedAt: 'yesterday' }] }],
    ['a draft with an author X wouldn’t allow', { ...ingest, drafts: [{ ...draft, author: '<img>' }] }],
    ['a profile without an X id', { type: 'profile', profile: { ...profile, id: 'me' } }],
    [
      'a profile with an avatar from another site',
      { type: 'profile', profile: { ...profile, avatar: 'https://evil.example/a.png' } },
    ],
    ['a profile with a name far too long', { type: 'profile', profile: { ...profile, name: 'x'.repeat(201) } }],
    ['a profile with a count that isn’t a number', { type: 'profile', profile: { ...profile, followers: '2' } }],
    ['a profile with a verified flag that isn’t one', { type: 'profile', profile: { ...profile, verified: 'yes' } }],
    ['a rate observation keyed for another operation', { type: 'rate', obs: { ...obs, key: `${ME}:DeleteTweet` } }],
    [
      'a rate observation for an operation Xomoni doesn’t watch',
      { type: 'rate', obs: { ...obs, op: 'Follow', key: `${ME}:Follow` } },
    ],
    ['a rate observation with an HTTP status out of range', { type: 'rate', obs: { ...obs, status: 1000 } }],
    ['a rate observation with a reset that isn’t a number', { type: 'rate', obs: { ...obs, reset: 'soon' } }],
  ])('drops %s', (_, message) => {
    expect(parseRuntimeMessage(message, NOW)).toBeNull();
  });

  it('keeps an empty avatar and accepts X’s other image host', () => {
    expect(parseRuntimeMessage({ type: 'profile', profile: { ...profile, avatar: '' } }, NOW)).not.toBeNull();
    const abs = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
    expect(parseRuntimeMessage({ type: 'profile', profile: { ...profile, avatar: abs } }, NOW)).not.toBeNull();
  });

  it('cuts a rate-limit reset to a day ahead, and keeps a missing one missing', () => {
    const yearAhead = { ...obs, reset: NOW + 365 * 86_400_000 };
    expect(parseRuntimeMessage({ type: 'rate', obs: yearAhead }, NOW)).toMatchObject({
      obs: { reset: NOW + MAX_RESET_AHEAD_MS },
    });
    expect(parseRuntimeMessage({ type: 'rate', obs: { ...obs, reset: null } }, NOW)).toMatchObject({
      obs: { reset: null },
    });
  });
});

describe('who may send what (#145)', () => {
  const tab = { id: 4 };

  it('hears only Xomoni’s content script in the top frame of an x.com tab', () => {
    const content = { id: 'xomoni', origin: 'https://x.com', frameId: 0, tab };
    expect(fromXPage(content, 'xomoni')).toBe(true);
    expect(fromXPage({ ...content, id: 'other' }, 'xomoni')).toBe(false);
    expect(fromXPage({ ...content, frameId: 1 }, 'xomoni')).toBe(false);
    expect(fromXPage({ ...content, tab: undefined }, 'xomoni')).toBe(false);
    expect(fromXPage({ ...content, origin: 'https://mobile.x.com' }, 'xomoni')).toBe(false);
    expect(fromXPage({ id: 'xomoni', url: 'not a url', frameId: 0, tab }, 'xomoni')).toBe(false);
  });

  it('takes commands only from Xomoni’s own pages', () => {
    expect(fromXomoniPage({ id: 'xomoni', origin: 'chrome-extension://xomoni', tab }, 'xomoni')).toBe(true);
    expect(fromXomoniPage({ id: 'xomoni', origin: 'https://x.com', tab }, 'xomoni')).toBe(false);
    expect(fromXomoniPage({ id: 'xomoni', url: 'chrome-extension://xomoni-evil/page.html' }, 'xomoni')).toBe(false);
    expect(fromXomoniPage({ id: 'other', origin: 'chrome-extension://xomoni' }, 'xomoni')).toBe(false);
  });
});

describe('a post’s id carries its time (#145)', () => {
  const idAt = (time: number) => ((BigInt(time) - 1_288_834_974_657n) << 22n).toString();
  const when = Date.parse('2017-03-04T05:06:07Z');

  it('agrees with a time within a minute either way', () => {
    expect(timeMatchesId(idAt(when), when)).toBe(true);
    expect(timeMatchesId(idAt(when), when + POST_TIME_SLACK_MS)).toBe(true);
    expect(timeMatchesId(idAt(when), when - POST_TIME_SLACK_MS)).toBe(true);
  });

  it('disagrees with any other time', () => {
    expect(timeMatchesId(idAt(when), when + POST_TIME_SLACK_MS + 1)).toBe(false);
    expect(timeMatchesId(idAt(when), Date.parse('2010-01-01T00:00:00Z'))).toBe(false);
  });

  it('can’t tell for ids from before November 2010, so other checks decide', () => {
    expect(timeMatchesId('20', Date.parse('2006-03-21T20:50:14Z'))).toBe(true);
    expect(timeMatchesId('29700859247', 0)).toBe(true);
  });
});

describe('capReset (#145)', () => {
  it('believes a reset at most a day ahead', () => {
    expect(capReset(null, NOW)).toBeNull();
    expect(capReset(NOW + 900_000, NOW)).toBe(NOW + 900_000);
    expect(capReset(NOW + 30 * 86_400_000, NOW)).toBe(NOW + MAX_RESET_AHEAD_MS);
  });
});

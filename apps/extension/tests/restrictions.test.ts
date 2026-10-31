import { describe, expect, it } from 'vitest';
import { classify } from '../src/content/actor';
import type { NetEvent } from '../src/content/net';
import { isCheckPath, isLoginPath, pageNeed, restrictionNotice } from '../src/shared/attention';
import { normalizeSettings } from '../src/shared/settings';
import { spendsQuota } from '../src/shared/x-limits';

const event = (status: number, json: unknown): NetEvent => ({ op: 'DeleteTweet', status, json, headers: {} }) as never;
const errors = (code: number) => ({ errors: [{ code, message: `Error ${code}` }] });

describe('X’s login routes (#20, PLAYBOOK D2)', () => {
  it.each(['/login', '/i/flow/login', '/i/jf/onboarding/web', '/i/jf/onboarding/web/verify'])(
    '%s is a login page',
    (path) => {
      expect(isLoginPath(path)).toBe(true);
      expect(isCheckPath(path)).toBe(false);
    },
  );

  it('treats a signed-in /i/jf/ page as needing the person', () => {
    // The content script reports loggedIn: false on any login path, even with X's cookie set.
    expect(
      pageNeed({ loggedIn: !isLoginPath('/i/jf/onboarding/web'), locked: false, challenge: false, viewerId: '1' }, '1'),
    ).toBe('login');
  });

  it('keeps ordinary pages and X’s other checks apart', () => {
    expect(isLoginPath('/home')).toBe(false);
    expect(isCheckPath('/account/access')).toBe(true);
    expect(isCheckPath('/i/flow/consent')).toBe(true);
  });
});

describe('suspension and restriction (#18, PLAYBOOK C3, C4)', () => {
  it('stops on a suspension instead of waiting', () => {
    expect(classify(event(403, errors(64)), 'DeleteTweet').outcome).toBe('suspended');
  });

  it('keeps an account lock as something the person can fix', () => {
    expect(classify(event(403, errors(326)), 'DeleteTweet').outcome).toBe('locked');
  });

  it.each([87, 220, 261])('treats code %i as a refused write', (code) => {
    expect(classify(event(403, errors(code)), 'DeleteTweet').outcome).toBe('restricted');
  });

  it('treats any 403 on a write as a restriction, never a retryable failure', () => {
    expect(classify(event(403, null), 'DeleteTweet').outcome).toBe('restricted');
    expect(classify(event(403, errors(999)), 'DeleteTweet').outcome).toBe('restricted');
    expect(classify(event(500, null), 'DeleteTweet').outcome).toBe('failed');
  });

  it('counts refusals against X’s quota', () => {
    expect(spendsQuota('suspended')).toBe(true);
    expect(spendsQuota('restricted')).toBe(true);
  });

  it('reads X’s limited and suspended notices', () => {
    expect(restrictionNotice('Home\nSome of your account features are temporarily limited\nLearn more')).toBe(
      'Some of your account features are temporarily limited',
    );
    expect(restrictionNotice('Your account is suspended')).toBe('Your account is suspended');
    expect(restrictionNotice('What is happening?!\nFor you\nFollowing')).toBeNull();
  });

  it('pauses after at most 3 unknown failures in a row (default 2)', () => {
    expect(normalizeSettings(null).maxConsecutiveFailures).toBe(2);
    expect(normalizeSettings({ maxConsecutiveFailures: 10 }).maxConsecutiveFailures).toBe(3);
    expect(normalizeSettings({ maxConsecutiveFailures: 0 }).maxConsecutiveFailures).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { viewerFromClaims } from './viewer';

describe('viewerFromClaims', () => {
  it('uses the provider profile', () => {
    expect(
      viewerFromClaims({
        sub: 'u1',
        email: 'ada@example.com',
        user_metadata: { full_name: ' Ada Lovelace ', avatar_url: 'https://lh3.googleusercontent.com/a/ada' },
      }),
    ).toEqual({
      id: 'u1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      avatarUrl: 'https://lh3.googleusercontent.com/a/ada',
      signInMethods: [],
    });
  });

  it('falls back to the email when there is no usable name', () => {
    const viewer = viewerFromClaims({
      sub: 'u2',
      email: 'bob@example.com',
      user_metadata: { full_name: '  ', avatar_url: 42 },
    });
    expect(viewer.name).toBe('bob@example.com');
    expect(viewer.avatarUrl).toBeNull();
  });

  // #147: the site's CSP loads images only from Google's avatar host, so another URL would show as broken.
  it.each([
    ['another host', 'https://img.example/a.png'],
    ['a look-alike host', 'https://lh3.googleusercontent.com.evil.example/a.png'],
    ['another Google content host', 'https://drive.googleusercontent.com/a.png'],
    ['plain HTTP', 'http://lh3.googleusercontent.com/a/ada'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['not a URL', 'lh3.googleusercontent.com/a/ada'],
  ])('drops an avatar on %s', (_name, avatar_url) => {
    expect(viewerFromClaims({ sub: 'u5', user_metadata: { avatar_url } }).avatarUrl).toBeNull();
  });

  it('accepts claims without metadata or email', () => {
    expect(viewerFromClaims({ sub: 'u3' })).toEqual({
      id: 'u3',
      email: '',
      name: '',
      avatarUrl: null,
      signInMethods: [],
    });
  });

  it('reads the sign-in methods and ignores junk', () => {
    expect(viewerFromClaims({ sub: 'u4', app_metadata: { providers: ['email', 'google', 7] } }).signInMethods).toEqual([
      'email',
      'google',
    ]);
  });
});

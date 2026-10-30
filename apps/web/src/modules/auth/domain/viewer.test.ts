import { describe, expect, it } from 'vitest';
import { viewerFromClaims } from './viewer';

describe('viewerFromClaims', () => {
  it('uses the provider profile', () => {
    expect(
      viewerFromClaims({
        sub: 'u1',
        email: 'ada@example.com',
        user_metadata: { full_name: ' Ada Lovelace ', avatar_url: 'https://img.example/a.png' },
      }),
    ).toEqual({ id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', avatarUrl: 'https://img.example/a.png' });
  });

  it('falls back to the email when there is no usable name', () => {
    const viewer = viewerFromClaims({ sub: 'u2', email: 'bob@example.com', user_metadata: { full_name: '  ', avatar_url: 42 } });
    expect(viewer.name).toBe('bob@example.com');
    expect(viewer.avatarUrl).toBeNull();
  });

  it('accepts claims without metadata or email', () => {
    expect(viewerFromClaims({ sub: 'u3' })).toEqual({ id: 'u3', email: '', name: '', avatarUrl: null });
  });
});

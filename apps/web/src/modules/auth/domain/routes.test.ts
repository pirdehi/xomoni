import { describe, expect, it } from 'vitest';
import { isGuestOnly, requiresSession, ROUTES, safeNextPath } from './routes';

describe('safeNextPath', () => {
  it('keeps same-site paths with query and hash', () => {
    expect(safeNextPath('/dashboard')).toBe('/dashboard');
    expect(safeNextPath('/dashboard?tab=jobs#top')).toBe('/dashboard?tab=jobs#top');
  });

  it.each([
    ['absolute URL', 'https://evil.example/phish'],
    ['protocol-relative URL', '//evil.example'],
    ['backslash trick', '/\\evil.example'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative path', 'dashboard'],
    ['empty', ''],
    ['missing', null],
    // Paths that only become protocol-relative once dot segments are resolved.
    ['dot segment before a double slash', '/.//evil.example'],
    ['parent segment before a double slash', '/x/..//evil.example'],
    ['encoded dot segment before a double slash', '/%2e//evil.example'],
  ])('falls back on %s', (_label, raw) => {
    expect(safeNextPath(raw)).toBe(ROUTES.dashboard);
  });

  it('uses the given fallback', () => {
    expect(safeNextPath('https://evil.example', '/')).toBe('/');
  });

  it('normalizes dot segments instead of escaping the site', () => {
    expect(safeNextPath('/../../etc')).toBe('/etc');
  });
});

describe('route policy', () => {
  it('protects the dashboard and its subpaths only', () => {
    expect(requiresSession('/dashboard')).toBe(true);
    expect(requiresSession('/dashboard/devices')).toBe(true);
    expect(requiresSession('/dashboards')).toBe(false);
    expect(requiresSession('/')).toBe(false);
  });

  it('treats the sign-in page as guest-only', () => {
    expect(isGuestOnly('/login')).toBe(true);
    expect(isGuestOnly('/dashboard')).toBe(false);
  });
});

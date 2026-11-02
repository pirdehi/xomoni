import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { ROUTES, isGuestOnly, requiresSession } from '@/modules/auth/domain/routes';
import { updateSession } from '@/modules/auth/server/proxy';
import { config, proxy } from './proxy';

vi.mock('@/modules/auth/server/proxy', () => ({ updateSession: vi.fn() }));

const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, url });

describe('proxy', () => {
  it('hands every matched request to the auth module’s session refresh', async () => {
    const response = NextResponse.next();
    vi.mocked(updateSession).mockResolvedValue(response);
    const request = new NextRequest('https://xomoni.test/dashboard');

    expect(await proxy(request)).toBe(response);
    expect(updateSession).toHaveBeenCalledWith(request);
  });

  it('runs on every page that needs a session and every guest-only page', () => {
    const guarded = Object.values(ROUTES).filter((path) => requiresSession(path) || isGuestOnly(path));

    expect(guarded.length).toBeGreaterThan(0);
    for (const path of guarded) expect(runsOn(path), path).toBe(true);
  });

  it.each(['/dashboard/devices', '/dashboard/jobs/j1', '/account/security'])(
    'runs on the protected sub-page %s',
    (path) => {
      expect(runsOn(path)).toBe(true);
    },
  );

  it.each(['/', '/privacy', '/terms', '/auth/callback', '/auth/confirm', '/auth/signout', '/dashboards'])(
    'leaves %s alone, so marketing pages stay static and auth routes do their own checks',
    (path) => {
      expect(runsOn(path)).toBe(false);
    },
  );
});

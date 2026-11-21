// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetNavigation, router } from '@test/fakes/navigation';
import { loadPage, useSignedInNavigation } from './navigation';

describe('useSignedInNavigation', () => {
  beforeEach(() => {
    resetNavigation();
  });

  it('replaces the page, then makes Server Components re-read the new session', () => {
    const { result } = renderHook(() => useSignedInNavigation());

    result.current('/dashboard');

    expect(router.replace).toHaveBeenCalledWith('/dashboard');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalledOnce();
    expect(router.replace.mock.invocationCallOrder[0]).toBeLessThan(router.refresh.mock.invocationCallOrder[0]!);
  });

  it('returns the same function across renders', () => {
    const { result, rerender } = renderHook(() => useSignedInNavigation());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});

describe('loadPage (#173)', () => {
  it('loads the page anew instead of going through the client router, whose cache may hold a redirect', () => {
    const assign = vi.fn();

    loadPage('/reset-password', { assign });

    expect(assign).toHaveBeenCalledWith('/reset-password');
    expect(router.replace).not.toHaveBeenCalled();
  });
});

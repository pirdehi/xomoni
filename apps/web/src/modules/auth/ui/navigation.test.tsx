// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetNavigation, router } from '@test/fakes/navigation';
import { useSignedInNavigation } from './navigation';

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

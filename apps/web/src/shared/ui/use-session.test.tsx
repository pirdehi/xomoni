// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSession } from './use-session';

const session = vi.hoisted(() => ({ change: null as ((email: string | null, name?: string) => void) | null }));
vi.mock('@/shared/supabase/browser-session', () => ({
  watchSessionEmail: (onChange: (email: string | null, name?: string) => void) => {
    session.change = onChange;
    return () => undefined;
  },
}));

describe('useSession (#244)', () => {
  it('is undefined until read, then follows sign-ins and sign-outs', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current).toBeUndefined();
    act(() => session.change?.('ada@example.com', 'Ada'));
    expect(result.current).toEqual({ email: 'ada@example.com', name: 'Ada' });
    act(() => session.change?.('bo@example.com'));
    expect(result.current).toEqual({ email: 'bo@example.com', name: '' });
    act(() => session.change?.(null));
    expect(result.current).toBeNull();
  });
});

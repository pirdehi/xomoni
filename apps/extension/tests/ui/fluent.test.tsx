// @vitest-environment happy-dom
import { Button, useFluent } from '@fluentui/react-components';
import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressRing } from '../../src/ui/components/ProgressRing';
import { XOMONI_BRAND } from '@xomoni/fluent-theme';
import { FluentRoot, useThemeMode, xomoniDark, xomoniLight } from '../../src/ui/fluent';
import { setTheme } from '../../src/ui/theme';

/** A `matchMedia` whose dark-mode answer the test sets, with listeners it can fire. */
function stubSystemTheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    listeners,
    change(next: boolean) {
      dark = next;
      listeners.forEach((l) => l());
    },
  };
}

/** Which theme the provider around it uses, read from Fluent's context. */
function ThemeProbe() {
  const { targetDocument } = useFluent();
  return <span data-testid="probe">{targetDocument ? 'in provider' : 'none'}</span>;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Xomoni’s Fluent themes (ADR-0019)', () => {
  it('use Xomoni’s blue as the brand color in both modes, on the dashboard’s neutrals', () => {
    expect(XOMONI_BRAND[80]).toBe('#2a78d6');
    expect(xomoniLight.colorBrandBackground).toBe(XOMONI_BRAND[80]);
    expect(xomoniLight.colorNeutralBackground1).toBe('#fcfcfb');
    expect(xomoniDark.colorNeutralBackground1).toBe('#1a1a19');
    expect(xomoniDark.colorBrandForeground1).toBe(XOMONI_BRAND[100]);
    expect(xomoniLight.fontFamilyBase).toContain('Vazirmatn');
  });
});

describe('useThemeMode', () => {
  it('follows the system while the choice is “system”, and its changes', () => {
    const system = stubSystemTheme(true);
    const { result, unmount } = renderHook(() => useThemeMode());
    expect(result.current).toBe('dark');
    act(() => system.change(false));
    expect(result.current).toBe('light');
    unmount();
    expect(system.listeners.size).toBe(0);
  });

  it('follows the choice made in Settings, at once', () => {
    stubSystemTheme(true);
    const { result } = renderHook(() => useThemeMode());
    act(() => setTheme('light'));
    expect(result.current).toBe('light');
    act(() => setTheme('system'));
    expect(result.current).toBe('dark');
  });
});

describe('FluentRoot', () => {
  it('puts the dashboard inside Fluent’s provider, out of the layout and with no background', () => {
    stubSystemTheme(false);
    const { container } = render(
      <FluentRoot>
        <ThemeProbe />
        <Button>Go</Button>
      </FluentRoot>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('in provider');
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveStyle({ display: 'contents', backgroundColor: 'transparent' });
  });
});

describe('ProgressRing', () => {
  const ring = () => screen.getByRole('progressbar', { name: '3 of 10 settled' });

  it('is a named progressbar with the percentage in its middle', () => {
    render(<ProgressRing value={30} label="3 of 10 settled" />);
    expect(ring()).toHaveAttribute('aria-valuenow', '30');
    expect(ring()).toHaveAttribute('aria-valuemin', '0');
    expect(ring()).toHaveAttribute('aria-valuemax', '100');
    expect(ring()).toHaveTextContent('30%');
  });

  it('clamps to 0–100 and shows a sliver as “<1%”', () => {
    const { rerender } = render(<ProgressRing value={140} label="3 of 10 settled" />);
    expect(ring()).toHaveAttribute('aria-valuenow', '100');
    rerender(<ProgressRing value={-5} label="3 of 10 settled" />);
    expect(ring()).toHaveAttribute('aria-valuenow', '0');
    expect(ring()).toHaveTextContent('0%');
    rerender(<ProgressRing value={0.4} label="3 of 10 settled" />);
    expect(ring()).toHaveTextContent('<1%');
  });
});

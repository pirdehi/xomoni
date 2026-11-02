// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStoredTheme, getStoredTheme, setTheme } from '../../src/ui/theme';

const KEY = 'xomoni.theme';

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows the system until a theme is chosen', () => {
    expect(getStoredTheme()).toBe('system');
    applyStoredTheme();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('saves a light or dark choice and applies it at once', () => {
    setTheme('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(getStoredTheme()).toBe('dark');

    setTheme('light');
    expect(getStoredTheme()).toBe('light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('forgets the choice when switched back to system', () => {
    setTheme('dark');
    setTheme('system');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('applies the saved theme on start', () => {
    localStorage.setItem(KEY, 'light');
    applyStoredTheme();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(KEY, 'neon');
    expect(getStoredTheme()).toBe('system');
    applyStoredTheme();
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('falls back to system when storage cannot be read', () => {
    const getItem = vi.fn(() => {
      throw new Error('SecurityError');
    });
    vi.stubGlobal('localStorage', { getItem });
    expect(getStoredTheme()).toBe('system');
    expect(getItem).toHaveBeenCalledWith(KEY);
  });

  it('still applies the choice to this page when storage cannot be written', () => {
    const fail = vi.fn(() => {
      throw new Error('QuotaExceededError');
    });
    vi.stubGlobal('localStorage', { setItem: fail, removeItem: fail });
    expect(() => setTheme('dark')).not.toThrow();
    expect(fail).toHaveBeenCalledWith(KEY, 'dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(() => setTheme('system')).not.toThrow();
    expect(fail).toHaveBeenCalledWith(KEY);
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });
});

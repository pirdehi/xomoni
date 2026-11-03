// The dashboard's Fluent UI provider (ADR-0019): Xomoni's shared themes (`@xomoni/fluent-theme`) in light and dark,
// following the theme the person chose in Settings.
import { FluentProvider, type Theme } from '@fluentui/react-components';
import { xomoniDarkTheme, xomoniLightTheme } from '@xomoni/fluent-theme';
import { type ReactNode, useEffect, useState } from 'react';
import { THEME_EVENT, getStoredTheme, resolveTheme } from './theme';

/** The dashboard in light mode: Xomoni's shared light theme (`@xomoni/fluent-theme`). */
export const xomoniLight: Theme = xomoniLightTheme();

/** The dashboard in dark mode: Xomoni's shared dark theme (`@xomoni/fluent-theme`). */
export const xomoniDark: Theme = xomoniDarkTheme();

/**
 * `light` or `dark`: the theme chosen in Settings, or the operating system's when the choice is `system`. Follows
 * changes to either while mounted.
 */
export function useThemeMode(): 'light' | 'dark' {
  const [mode, setMode] = useState(() => resolveTheme(getStoredTheme()));
  useEffect(() => {
    const update = () => setMode(resolveTheme(getStoredTheme()));
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    window.addEventListener(THEME_EVENT, update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener(THEME_EVENT, update);
    };
  }, []);
  return mode;
}

/**
 * Wraps the dashboard in Fluent's provider with Xomoni's theme for the current mode. The provider's element takes
 * no part in the layout (`display: contents`; its theme variables still reach every child) and has no background,
 * so the page keeps its own while the rest of the dashboard moves to Fluent (#123).
 */
export function FluentRoot({ children }: { children: ReactNode }) {
  const mode = useThemeMode();
  return (
    <FluentProvider
      theme={mode === 'dark' ? xomoniDark : xomoniLight}
      style={{ display: 'contents', backgroundColor: 'transparent' }}
    >
      {children}
    </FluentProvider>
  );
}

// Xomoni's Fluent UI themes (ADR-0019): Fluent's web themes with Xomoni's blue as the brand ramp and the
// dashboard's own neutrals, in light and dark, following the theme the person chose in Settings.
import {
  type BrandVariants,
  FluentProvider,
  type Theme,
  createDarkTheme,
  createLightTheme,
} from '@fluentui/react-components';
import { type ReactNode, useEffect, useState } from 'react';
import { THEME_EVENT, getStoredTheme, resolveTheme } from './theme';

/** Xomoni's blue (#2a78d6 at shade 80) in Fluent's 16 brand shades, darkest first. */
export const XOMONI_BRAND: BrandVariants = {
  10: '#071322',
  20: '#091a2f',
  30: '#0c2440',
  40: '#102d51',
  50: '#143967',
  60: '#184781',
  70: '#1e589f',
  80: '#2a78d6',
  90: '#4387db',
  100: '#5d98df',
  110: '#79a8e2',
  120: '#94b9e5',
  130: '#aec9ea',
  140: '#c8d9ef',
  150: '#dce7f4',
  160: '#ecf2f9',
};

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Vazirmatn', sans-serif";

/** The dashboard in light mode: Fluent's light theme on Xomoni's warm neutrals. */
export const xomoniLight: Theme = {
  ...createLightTheme(XOMONI_BRAND),
  fontFamilyBase: FONT,
  colorNeutralBackground1: '#fcfcfb',
  colorNeutralBackground2: '#f0efec',
  colorNeutralBackground3: '#f4f4f1',
  colorNeutralForeground1: '#0b0b0b',
  colorNeutralForeground2: '#52514e',
  colorNeutralForeground3: '#898781',
  colorNeutralStroke1: 'rgba(11, 11, 11, 0.14)',
  colorNeutralStroke2: 'rgba(11, 11, 11, 0.1)',
};

/** The dashboard in dark mode: Fluent's dark theme on Xomoni's near-black surfaces. */
export const xomoniDark: Theme = {
  ...createDarkTheme(XOMONI_BRAND),
  fontFamilyBase: FONT,
  colorBrandForeground1: XOMONI_BRAND[100],
  colorBrandForeground2: XOMONI_BRAND[110],
  colorNeutralBackground1: '#1a1a19',
  colorNeutralBackground2: '#242423',
  colorNeutralBackground3: '#0d0d0d',
  colorNeutralForeground1: '#f0efec',
  colorNeutralForeground2: '#c3c2b7',
  colorNeutralForeground3: '#898781',
  colorNeutralStroke1: 'rgba(255, 255, 255, 0.14)',
  colorNeutralStroke2: 'rgba(255, 255, 255, 0.1)',
};

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

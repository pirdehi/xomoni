// Xomoni's Fluent UI themes (ADR-0019), one source for the extension dashboard and xomoni.com: Fluent's web themes
// with Xomoni's blue as the brand ramp and Xomoni's own warm neutrals, in light and dark.
import { type BrandVariants, type Theme, createDarkTheme, createLightTheme } from '@fluentui/react-components';

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

/** The font stack of every Xomoni interface: the system font, with Vazirmatn for Persian text. */
export const XOMONI_FONT =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Vazirmatn', sans-serif";

/**
 * The page colors behind Fluent's surfaces, for CSS that paints the page before React mounts (the extension's
 * `styles.css`, the website's `<html>` background and theme color). They equal each theme's
 * `colorNeutralBackground3`.
 */
export const PAGE_BACKGROUND = { light: '#f4f4f1', dark: '#0d0d0d' } as const;

/**
 * Xomoni's blue, deepened just enough to carry text at WCAG AA, 4.5:1 (#342), for the light theme: white text on a
 * primary button (`button`), and blue text on the light surfaces, the darkest of them included (`text`). Xomoni's blue
 * itself carries white text at 4.4:1, and sits on the page at 4.0:1.
 */
export const XOMONI_BRAND_AA = { button: '#2975d1', text: '#266bbf' } as const;

/**
 * Xomoni in light mode: Fluent's light theme on warm neutrals. `fontFamily` replaces the font stack, for an app that
 * loads its own font (the website's Geist). Text meets WCAG AA on every surface (#342): the blue of buttons and brand
 * text is `XOMONI_BRAND_AA`, and the muted grey is dark enough on the darkest surface, `colorNeutralBackground2`.
 */
export function xomoniLightTheme(fontFamily = XOMONI_FONT): Theme {
  return {
    ...createLightTheme(XOMONI_BRAND),
    fontFamilyBase: fontFamily,
    colorBrandBackground: XOMONI_BRAND_AA.button,
    colorBrandForeground1: XOMONI_BRAND_AA.text,
    colorNeutralBackground1: '#fcfcfb',
    colorNeutralBackground2: '#f0efec',
    colorNeutralBackground3: PAGE_BACKGROUND.light,
    colorNeutralForeground1: '#0b0b0b',
    colorNeutralForeground2: '#52514e',
    colorNeutralForeground3: '#6e6c67',
    colorNeutralStroke1: 'rgba(11, 11, 11, 0.14)',
    colorNeutralStroke2: 'rgba(11, 11, 11, 0.1)',
  };
}

/**
 * Xomoni in dark mode: Fluent's dark theme on near-black surfaces, with lighter brand text for contrast. The muted grey
 * is light enough for WCAG AA on the lightest surface, `colorNeutralBackground2` (#342).
 */
export function xomoniDarkTheme(fontFamily = XOMONI_FONT): Theme {
  return {
    ...createDarkTheme(XOMONI_BRAND),
    fontFamilyBase: fontFamily,
    colorBrandForeground1: XOMONI_BRAND[100],
    colorBrandForeground2: XOMONI_BRAND[110],
    colorNeutralBackground1: '#1a1a19',
    colorNeutralBackground2: '#242423',
    colorNeutralBackground3: PAGE_BACKGROUND.dark,
    colorNeutralForeground1: '#f0efec',
    colorNeutralForeground2: '#c3c2b7',
    colorNeutralForeground3: '#8e8c86',
    colorNeutralStroke1: 'rgba(255, 255, 255, 0.14)',
    colorNeutralStroke2: 'rgba(255, 255, 255, 0.1)',
  };
}

/**
 * A theme's tokens as CSS custom property declarations (`--colorNeutralBackground1: #fcfcfb; …`), the same variables
 * Fluent's provider sets. Server-rendered pages put the dark theme's under `@media (prefers-color-scheme: dark)`, so
 * the first paint already matches the visitor's system, with no flash before the browser knows it.
 */
export function themeVariables(theme: Theme): string {
  return Object.entries(theme)
    .map(([token, value]) => `--${token}: ${String(value)};`)
    .join(' ');
}

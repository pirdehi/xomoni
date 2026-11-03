import { describe, expect, it } from 'vitest';
import {
  PAGE_BACKGROUND,
  XOMONI_BRAND,
  XOMONI_FONT,
  themeVariables,
  xomoniDarkTheme,
  xomoniLightTheme,
} from '../src/index';

describe('Xomoni’s Fluent themes (ADR-0019)', () => {
  it('use Xomoni’s blue at shade 80 as the brand color, in 16 shades', () => {
    expect(Object.keys(XOMONI_BRAND)).toHaveLength(16);
    expect(XOMONI_BRAND[80]).toBe('#2a78d6');
    expect(xomoniLightTheme().colorBrandBackground).toBe(XOMONI_BRAND[80]);
  });

  it('paint the page in the same color as the theme’s page background', () => {
    expect(xomoniLightTheme().colorNeutralBackground3).toBe(PAGE_BACKGROUND.light);
    expect(xomoniDarkTheme().colorNeutralBackground3).toBe(PAGE_BACKGROUND.dark);
  });

  it('keep text readable in dark mode with lighter brand text', () => {
    const dark = xomoniDarkTheme();
    expect(dark.colorBrandForeground1).toBe(XOMONI_BRAND[100]);
    expect(dark.colorNeutralForeground1).toBe('#f0efec');
    expect(dark.colorNeutralBackground1).toBe('#1a1a19');
  });

  it('use the Xomoni font stack with Vazirmatn, or the font an app passes', () => {
    expect(xomoniLightTheme().fontFamilyBase).toBe(XOMONI_FONT);
    expect(XOMONI_FONT).toContain('Vazirmatn');
    expect(xomoniDarkTheme('var(--font-geist-sans), sans-serif').fontFamilyBase).toBe(
      'var(--font-geist-sans), sans-serif',
    );
  });

  it('turn a theme into the CSS variables Fluent sets, one per token', () => {
    const dark = xomoniDarkTheme();
    const css = themeVariables(dark);
    expect(css).toContain('--colorNeutralBackground1: #1a1a19;');
    expect(css).toContain(`--colorBrandForeground1: ${XOMONI_BRAND[100]};`);
    expect(css.split('; --')).toHaveLength(Object.keys(dark).length);
  });
});

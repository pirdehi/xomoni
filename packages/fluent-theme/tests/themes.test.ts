import { describe, expect, it } from 'vitest';
import {
  PAGE_BACKGROUND,
  XOMONI_BRAND,
  XOMONI_BRAND_AA,
  XOMONI_FONT,
  themeVariables,
  xomoniDarkTheme,
  xomoniLightTheme,
} from '../src/index';

describe('Xomoni’s Fluent themes (ADR-0019)', () => {
  it('use Xomoni’s blue at shade 80 as the brand color, in 16 shades', () => {
    expect(Object.keys(XOMONI_BRAND)).toHaveLength(16);
    expect(XOMONI_BRAND[80]).toBe('#2a78d6');
    expect(xomoniDarkTheme().colorBrandBackground).toBe(XOMONI_BRAND[70]);
  });

  it('deepen the blue of light mode’s buttons and brand text only as far as WCAG AA needs (#342)', () => {
    const light = xomoniLightTheme();
    expect(light.colorBrandBackground).toBe(XOMONI_BRAND_AA.button);
    expect(light.colorBrandForeground1).toBe(XOMONI_BRAND_AA.text);
    // Xomoni's blue itself falls short, which is why they differ from it.
    expect(contrast('#ffffff', XOMONI_BRAND[80])).toBeLessThan(4.5);
    expect(contrast(XOMONI_BRAND[80], PAGE_BACKGROUND.light)).toBeLessThan(4.5);
  });

  it.each([
    ['light', xomoniLightTheme()],
    ['dark', xomoniDarkTheme()],
  ])('keep text at WCAG AA, 4.5:1, on every surface in %s mode (#342)', (_, theme) => {
    const surfaces = [theme.colorNeutralBackground1, theme.colorNeutralBackground2, theme.colorNeutralBackground3];
    const text = [
      theme.colorNeutralForeground1,
      theme.colorNeutralForeground2,
      theme.colorNeutralForeground3,
      theme.colorBrandForeground1,
      theme.colorBrandForegroundLink,
      // A quiet (subtle or transparent) button's text while hovered or selected (#345).
      theme.colorNeutralForeground2BrandHover,
      theme.colorNeutralForeground2BrandSelected,
      theme.colorNeutralForeground3BrandHover,
      theme.colorNeutralForeground3BrandSelected,
    ];
    for (const color of text)
      for (const surface of surfaces) expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5);
    // A primary button's text, at rest, hovered, pressed and selected (#345: dark mode's hover was 4.4:1).
    for (const background of [
      theme.colorBrandBackground,
      theme.colorBrandBackgroundHover,
      theme.colorBrandBackgroundPressed,
      theme.colorBrandBackgroundSelected,
    ])
      expect(contrast(theme.colorNeutralForegroundOnBrand, background)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['light', xomoniLightTheme()],
    ['dark', xomoniDarkTheme()],
  ])(
    'keep muted text at WCAG AA in a quiet control while it is hovered, pressed or open, in %s mode (#389)',
    (_, theme) => {
      // A subtle button, a menu's trigger or a list row: its muted parts take the muted grey of the state it is in.
      const states = [
        [theme.colorNeutralForeground3Hover, [theme.colorSubtleBackgroundHover, theme.colorNeutralBackground1Hover]],
        [
          theme.colorNeutralForeground3Pressed,
          [theme.colorSubtleBackgroundPressed, theme.colorNeutralBackground1Pressed],
        ],
        [
          theme.colorNeutralForeground3Selected,
          [theme.colorSubtleBackgroundSelected, theme.colorNeutralBackground1Selected],
        ],
      ] as const;
      for (const [text, surfaces] of states)
        for (const surface of surfaces) expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('need those states’ own muted grey: the one at rest is too faint on a hovered or open control (#389)', () => {
    const dark = xomoniDarkTheme();
    const light = xomoniLightTheme();
    // Why the extension's account button changes its handle's grey while hovered or open.
    expect(contrast(dark.colorNeutralForeground3, dark.colorSubtleBackgroundHover)).toBeLessThan(4.5);
    expect(contrast(light.colorNeutralForeground3, light.colorSubtleBackgroundSelected)).toBeLessThan(4.5);
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

/** The WCAG 2 contrast ratio of two `#rrggbb` colors, from 1 to 21. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(color.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

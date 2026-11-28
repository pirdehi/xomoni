// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { FEATURES, type Feature } from '@xomoni/entitlements';
import { afterEach, describe, expect, it } from 'vitest';
import { PlusBadge } from '../../src/ui/components/reach/PlusBadge';
import { FluentRoot, xomoniDark, xomoniLight } from '../../src/ui/fluent';

// "Plus · preview" (#425, CV.2.5): the badge Reach shows on each paid part (#475, from `@xomoni/entitlements`) is the
// one the vault's plan asked for. Here, what CV.2.5 adds to its own tests: every paid part is marked the same way and
// keeps working, the badge takes no focus, and its words read at AA contrast in both themes.

/** WCAG's relative luminance of a `#rrggbb` color. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG's contrast ratio of two colors. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** Every part `FEATURES` names: each is on a paid plan. */
const PAID = Object.keys(FEATURES) as Feature[];

afterEach(cleanup);

describe('Plus · preview on every paid part (#425, CV.2.5)', () => {
  it('marks every paid part the same way, and locks nothing beside it', () => {
    expect(PAID.length).toBeGreaterThan(0);
    render(
      <FluentRoot>
        {PAID.map((feature) => (
          <div key={feature}>
            <PlusBadge feature={feature} />
            <button type="button">{feature}</button>
          </div>
        ))}
      </FluentRoot>,
    );
    expect(screen.getAllByText('Plus · preview')).toHaveLength(PAID.length);
    for (const feature of PAID) expect(screen.getByRole('button', { name: feature })).toBeEnabled();
  });

  it('is not in the Tab order: it says something, and does nothing', () => {
    const { container } = render(
      <FluentRoot>
        <PlusBadge feature="reach-compare" />
      </FluentRoot>,
    );
    expect(container.querySelector('[tabindex]')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('reads at AA contrast in both themes: brand text on the brand tint (Fluent’s tint badge)', () => {
    for (const theme of [xomoniLight, xomoniDark]) {
      expect(contrast(theme.colorBrandForeground2, theme.colorBrandBackground2)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

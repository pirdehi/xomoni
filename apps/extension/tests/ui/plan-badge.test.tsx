// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PLUS_FEATURES } from '../../src/shared/plan';
import { PLAN_BADGE, PlanBadge } from '../../src/ui/components/PlanBadge';
import { FluentRoot, xomoniDark, xomoniLight } from '../../src/ui/fluent';

// "Plus · preview" (#425, CV.2.5): it says which parts will be on Plus, and locks nothing.

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

afterEach(cleanup);

describe('PlanBadge', () => {
  it('is a note named Plus · preview, described as free while Xomoni is in preview', () => {
    render(
      <FluentRoot>
        <PlanBadge feature="reach-history" />
      </FluentRoot>,
    );
    const badge = screen.getByRole('note', { name: 'Plus · preview' });
    expect(badge).toHaveAccessibleDescription('Free while Xomoni is in preview');
    expect(badge).toHaveTextContent(PLAN_BADGE.label);
    expect(badge).toHaveAttribute('title', PLAN_BADGE.description);
    expect(badge).toHaveAttribute('data-feature', 'reach-history');
    expect(badge).toHaveAttribute('data-plan', 'preview');
  });

  it('marks every Plus part the same way, and locks nothing beside it', () => {
    render(
      <FluentRoot>
        {PLUS_FEATURES.map((feature) => (
          <div key={feature}>
            <PlanBadge feature={feature} />
            <button type="button">{feature}</button>
          </div>
        ))}
      </FluentRoot>,
    );
    expect(screen.getAllByRole('note', { name: 'Plus · preview' })).toHaveLength(PLUS_FEATURES.length);
    for (const feature of PLUS_FEATURES) expect(screen.getByRole('button', { name: feature })).toBeEnabled();
  });

  it('is not in the Tab order: it says something, and does nothing', () => {
    render(
      <FluentRoot>
        <PlanBadge feature="reach-compare" />
      </FluentRoot>,
    );
    expect(screen.getByRole('note')).not.toHaveAttribute('tabindex');
  });

  it('reads at AA contrast in both themes: brand text on the brand tint (Fluent’s tint badge)', () => {
    for (const theme of [xomoniLight, xomoniDark]) {
      expect(contrast(theme.colorBrandForeground2, theme.colorBrandBackground2)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

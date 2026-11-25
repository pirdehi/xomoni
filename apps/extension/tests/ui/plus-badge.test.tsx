// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { FEATURES } from '@xomoni/entitlements';
import { afterEach, describe, expect, it } from 'vitest';
import { PlusBadge, SALES_OPEN, planBadgeWords } from '../../src/ui/components/reach/PlusBadge';

const NOW = Date.UTC(2026, 10, 24, 12);

describe('the plan badge of Reach’s paid parts (ADR-0042)', () => {
  afterEach(cleanup);

  it('says each feature’s plan from @xomoni/entitlements, and preview while sales aren’t open', () => {
    expect(SALES_OPEN).toBe(false);
    for (const feature of Object.keys(FEATURES) as (keyof typeof FEATURES)[]) {
      expect(planBadgeWords(feature, NOW)).toBe('Plus · preview');
      expect(planBadgeWords(feature, NOW, true)).toBe('Plus');
    }
  });

  it('marks the part with its feature, and locks nothing', () => {
    render(
      <div>
        <PlusBadge feature="reach-compare" />
        <p>Still here</p>
      </div>,
    );
    expect(screen.getByText('Plus · preview').closest('[data-feature]')).toHaveAttribute(
      'data-feature',
      'reach-compare',
    );
    expect(screen.getByText('Still here')).toBeVisible();
  });
});

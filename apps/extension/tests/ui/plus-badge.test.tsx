// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { FEATURES } from '@xomoni/entitlements';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIVE_KEY } from '../../src/cloud/entitlement';
import { kvSet } from '../../src/shared/db';
import { PlusBadge, planBadgeWords } from '../../src/ui/components/reach/PlusBadge';
import { stubChrome } from '../support/chrome';
import { resetDb } from '../support/fixtures';

const NOW = Date.UTC(2026, 10, 24, 12);

describe('the plan badge of Reach’s paid parts (ADR-0042)', () => {
  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(cleanup);

  it('says each feature’s plan from @xomoni/entitlements, and preview while sales aren’t open', () => {
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

  it('drops preview once xomoni.com says sales are open (#423)', async () => {
    await kvSet(LIVE_KEY, true);
    render(<PlusBadge feature="reach-history" />);
    expect(await screen.findByText('Plus')).toBeInTheDocument();
    expect(screen.queryByText('Plus · preview')).not.toBeInTheDocument();
  });
});

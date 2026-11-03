// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardMain, DashboardSkeleton } from './dashboard-shell';

describe('DashboardMain', () => {
  it('is the page’s main landmark around the dashboard', () => {
    render(
      <DashboardMain>
        <h1>Ada Lovelace</h1>
      </DashboardMain>,
    );

    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Ada Lovelace' }));
  });
});

describe('DashboardSkeleton', () => {
  it('tells assistive technology the dashboard is loading', () => {
    render(<DashboardSkeleton />);

    const loading = screen.getByRole('progressbar', { name: 'Loading your dashboard' });
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });
});

// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LegalPage } from './legal-page';

describe('LegalPage', () => {
  it('puts the dated title and the text between the site header and footer', () => {
    render(
      <LegalPage title="Privacy Policy" updated="November 2, 2026">
        <p>Your X content never leaves your browser.</p>
      </LegalPage>,
    );

    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(within(main).getByText('Last updated November 2, 2026')).toBeInTheDocument();
    expect(within(main).getByText('Your X content never leaves your browser.')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});

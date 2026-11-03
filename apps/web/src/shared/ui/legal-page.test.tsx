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

  it('styles the plain text the route writes: headings, lists, links and code stay what they are', () => {
    render(
      <LegalPage title="Risks" updated="November 1, 2026">
        <h2>Deletions are permanent</h2>
        <ul>
          <li>
            Type <code>I UNDERSTAND</code> first.
          </li>
        </ul>
        <a href="/terms">Terms of Use</a>
      </LegalPage>,
    );

    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 2, name: 'Deletions are permanent' })).toBeInTheDocument();
    expect(within(main).getByRole('listitem')).toHaveTextContent('Type I UNDERSTAND first.');
    expect(within(main).getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms');
    // The calendar icon beside the date is decoration.
    expect(within(main).getByText('Last updated November 1, 2026').querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });
});

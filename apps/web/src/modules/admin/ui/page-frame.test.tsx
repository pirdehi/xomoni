// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsolePage, ConsoleSkeleton, LoadFailed, UserBadges } from './page-frame';

describe('console page parts', () => {
  it('give a page its heading, its line and its content', () => {
    render(
      <ConsolePage title="Users" description="3 accounts">
        <p>Table</p>
      </ConsolePage>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText('3 accounts')).toBeInTheDocument();
    expect(screen.getByText('Table')).toBeInTheDocument();
  });

  it('say when the database couldn’t give a page', () => {
    render(<LoadFailed what="the accounts" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load the accounts. Reload the page to try again.');
  });

  it('stand in while a page loads', () => {
    render(<ConsoleSkeleton />);
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
  });

  it('label an account in words, never by color alone', () => {
    const { container, rerender } = render(<UserBadges badges={['superadmin', 'suspended', 'unconfirmed']} />);
    expect(container).toHaveTextContent('Super-adminSuspendedUnconfirmed');
    expect(container.querySelector('[data-badge="suspended"]')).toHaveTextContent('Suspended');
    rerender(<UserBadges badges={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

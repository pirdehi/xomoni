// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CheckInbox, FormAlert } from './form-alert';

describe('FormAlert', () => {
  it('announces an error by default', () => {
    render(<FormAlert message="Too many attempts." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts.');
    expect(screen.getByRole('alert')).toHaveAttribute('data-tone', 'error');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a neutral notice as a status, not an alert', () => {
    render(<FormAlert tone="info" message="Your new password is saved." />);

    expect(screen.getByRole('status')).toHaveTextContent('Your new password is saved.');
    expect(screen.getByRole('status')).toHaveAttribute('data-tone', 'info');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is not labelled by a title it doesn’t have', () => {
    render(<FormAlert message="Too many attempts." />);

    expect(screen.getByRole('alert')).not.toHaveAttribute('aria-labelledby');
  });
});

describe('CheckInbox', () => {
  it('says to check the inbox, then what was sent where', () => {
    render(
      <CheckInbox>
        We sent a link to <strong>ada@example.com</strong>.
      </CheckInbox>,
    );

    expect(screen.getByText('Check your inbox')).toBeInTheDocument();
    expect(screen.getByText(/We sent a link to/)).toHaveTextContent('We sent a link to ada@example.com.');
  });
});

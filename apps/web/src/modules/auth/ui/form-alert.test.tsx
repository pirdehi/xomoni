// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormAlert } from './form-alert';

describe('FormAlert', () => {
  it('announces an error by default', () => {
    render(<FormAlert message="Too many attempts." />);

    expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts.');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a neutral notice as a status, not an alert', () => {
    render(<FormAlert tone="info" message="Your new password is saved." />);

    expect(screen.getByRole('status')).toHaveTextContent('Your new password is saved.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

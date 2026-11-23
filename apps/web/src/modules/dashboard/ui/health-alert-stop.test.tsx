// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetNavigation, setLocation } from '@test/fakes/navigation';
import { HealthAlertStop } from './health-alert-stop';

const TOKEN = '3f2a6c1e-9b7d-4e8a-a1c2-5d6e7f8091ab';

beforeEach(() => resetNavigation());

describe('HealthAlertStop (#407, ADR-0042)', () => {
  it('asks first, with one button that posts the link’s token', () => {
    setLocation('/health-alert/stop', `token=${TOKEN}`);
    const { container } = render(<HealthAlertStop />);
    expect(screen.getByText('Stop the emails when X warns your account?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop the alerts' })).toHaveAttribute('type', 'submit');
    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', `/api/health-alert/stop?token=${TOKEN}`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says when stopping failed, and offers the button again', () => {
    setLocation('/health-alert/stop', `token=${TOKEN}&failed=1`);
    render(<HealthAlertStop />);
    expect(screen.getByRole('alert')).toHaveTextContent('That didn’t work. Try again in a moment.');
    expect(screen.getByRole('button', { name: 'Stop the alerts' })).toBeInTheDocument();
  });

  it('says they are stopped, that Xomoni still stops by itself, and where to turn them on again', () => {
    setLocation('/health-alert/stop', 'stopped=1');
    render(<HealthAlertStop />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'The alerts are stopped. No more will come, and none still waiting is sent.',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Xomoni still stops by itself when X warns an account.');
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/dashboard/settings');
  });

  it('offers no button for a link that isn’t complete', () => {
    setLocation('/health-alert/stop', 'token=abc');
    render(<HealthAlertStop />);
    expect(screen.getByText(/^This link isn’t complete\./)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

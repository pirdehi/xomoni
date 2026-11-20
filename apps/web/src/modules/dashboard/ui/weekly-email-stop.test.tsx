// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetNavigation, setLocation } from '@test/fakes/navigation';
import { WeeklyEmailStop } from './weekly-email-stop';

const TOKEN = '3f2a6c1e-9b7d-4e8a-a1c2-5d6e7f8091ab';

beforeEach(() => resetNavigation());

describe('WeeklyEmailStop (ADR-0031)', () => {
  it('asks first, with one button that posts the link’s token', () => {
    setLocation('/weekly-email/stop', `token=${TOKEN}`);
    const { container } = render(<WeeklyEmailStop />);
    expect(screen.getByText('Stop the weekly email of your numbers?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop the weekly email' })).toHaveAttribute('type', 'submit');
    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', `/api/weekly-email/stop?token=${TOKEN}`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says when stopping failed, and offers the button again', () => {
    setLocation('/weekly-email/stop', `token=${TOKEN}&failed=1`);
    render(<WeeklyEmailStop />);
    expect(screen.getByRole('alert')).toHaveTextContent('That didn’t work. Try again in a moment.');
    expect(screen.getByRole('button', { name: 'Stop the weekly email' })).toBeInTheDocument();
  });

  it('says it is stopped, and where to turn it on again', () => {
    setLocation('/weekly-email/stop', 'stopped=1');
    render(<WeeklyEmailStop />);
    expect(screen.getByRole('status')).toHaveTextContent('The weekly email is stopped. Nothing more will come.');
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/dashboard/reports');
  });

  it('offers no button for a link that isn’t complete', () => {
    setLocation('/weekly-email/stop', 'token=abc');
    render(<WeeklyEmailStop />);
    expect(screen.getByText(/^This link isn’t complete\./)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

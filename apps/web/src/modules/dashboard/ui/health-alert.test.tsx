// @vitest-environment happy-dom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HealthAlertCard } from './health-alert';

const choice = () => screen.getByRole('switch', { name: 'Email me when X warns my account' });

describe('HealthAlertCard (#407, ADR-0042)', () => {
  it('is off until the person turns it on, and turns on with the switch', async () => {
    const onSet = vi.fn(() => Promise.resolve(null));
    render(<HealthAlertCard status={{ enabled: false, canSend: true }} onSet={onSet} />);
    expect(screen.getByRole('heading', { level: 2, name: 'When X warns your account' })).toBeInTheDocument();
    expect(choice()).not.toBeChecked();
    expect(choice()).toBeEnabled();
    expect(screen.getByText(/^Off\. Turn it on/)).toBeInTheDocument();
    await userEvent.click(choice());
    expect(onSet).toHaveBeenCalledWith(true);
  });

  it('shows it on, and says how often at most and that each email can stop it', () => {
    render(<HealthAlertCard status={{ enabled: true, canSend: true }} onSet={vi.fn()} />);
    expect(choice()).toBeChecked();
    expect(screen.getByText(/at most every 6 hours\. Each email has a link to stop it\./)).toBeInTheDocument();
  });

  it('keeps the choice while sending isn’t set up, and says nothing is sent until it is', async () => {
    const onSet = vi.fn(() => Promise.resolve(null));
    render(<HealthAlertCard status={{ enabled: false, canSend: false }} onSet={onSet} />);
    expect(screen.getByText(/Sending isn’t set up on xomoni\.com yet/)).toBeInTheDocument();
    expect(choice()).toBeEnabled();
    await userEvent.click(choice());
    expect(onSet).toHaveBeenCalledWith(true);
  });

  it('waits while the choice is read, and says when it couldn’t be read, with the switch held', () => {
    const { rerender } = render(<HealthAlertCard status={null} onSet={vi.fn()} />);
    expect(choice()).toBeDisabled();
    expect(screen.getByText('Reading your choice…')).toBeInTheDocument();
    rerender(<HealthAlertCard status="error" onSet={vi.fn()} />);
    expect(choice()).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t read your choice. Reload the page to try again.');
  });

  it('says what went wrong when a change fails, and holds the switch meanwhile', async () => {
    let finish: (message: string | null) => void = () => undefined;
    const onSet = vi.fn(() => new Promise<string | null>((resolve) => (finish = resolve)));
    render(<HealthAlertCard status={{ enabled: false, canSend: true }} onSet={onSet} />);
    await userEvent.click(choice());
    expect(choice()).toBeDisabled();
    finish('Couldn’t turn the alert on. Try again in a moment.');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t turn the alert on. Try again in a moment.');
    await waitFor(() => expect(choice()).toBeEnabled());
  });

  it('says what the email holds: the @handle and what Xomoni does next, and a link to the dashboard only', () => {
    render(<HealthAlertCard status={{ enabled: true, canSend: true }} onSet={vi.fn()} />);
    expect(
      screen.getByText(/the account’s @handle and what Xomoni does next, nothing X showed or you posted/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resume|approve|start/i })).not.toBeInTheDocument();
  });
});

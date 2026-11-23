// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASES_URL, saveReleaseNews } from '../../src/cloud/release';
import { UpdateNotice } from '../../src/ui/components/UpdateNotice';
import { stubChrome } from '../support/chrome';
import { resetDb } from '../support/fixtures';

// stubChrome's manifest says this browser runs 0.3.0.
describe('the update notice (#151)', () => {
  beforeEach(async () => {
    stubChrome();
    await resetDb();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('says nothing while no newer version is known', async () => {
    const { container } = render(<UpdateNotice />);
    await saveReleaseNews({ latest: '0.3.0', security: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Only the live region the notice will show in, empty.
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // A screen reader hears the notice appear, politely, as it does other news (#457).
  it('shows the notice in a polite live region that is there before it', async () => {
    const { container } = render(<UpdateNotice />);
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe('');

    await saveReleaseNews({ latest: '0.4.0', security: false });

    const title = await screen.findByText('Xomoni 0.4.0 is out');
    expect(title.closest('[aria-live]')).toBe(region);
    expect(region).toHaveTextContent('This browser runs 0.3.0.');
    // Polite, never an interruption: not an alert, not assertive.
    expect(region).not.toHaveAttribute('role', 'alert');
    expect(container.querySelector('[aria-live="assertive"]')).toBeNull();
  });

  it('says a newer version is out, links to the release page, and goes away when dismissed', async () => {
    await saveReleaseNews({ latest: '0.4.0', security: false });
    const { container } = render(<UpdateNotice />);

    expect(await screen.findByText('Xomoni 0.4.0 is out')).toBeInTheDocument();
    expect(container).toHaveTextContent('This browser runs 0.3.0.');
    const link = screen.getByRole('link', { name: /Download 0\.4\.0/ });
    expect(link).toHaveAttribute('href', RELEASES_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');

    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('marks a security release and offers no way to dismiss it', async () => {
    await saveReleaseNews({ latest: '0.4.0', security: true });
    render(<UpdateNotice />);

    expect(await screen.findByText('Xomoni 0.4.0 is out, with a security fix')).toBeInTheDocument();
    expect(screen.getByText(/fixes a security problem/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
  });
});

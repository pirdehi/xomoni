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
    expect(container).toBeEmptyDOMElement();
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
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('marks a security release and offers no way to dismiss it', async () => {
    await saveReleaseNews({ latest: '0.4.0', security: true });
    render(<UpdateNotice />);

    expect(await screen.findByText('Xomoni 0.4.0 is out, with a security fix')).toBeInTheDocument();
    expect(screen.getByText(/fixes a security problem/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Not now' })).not.toBeInTheDocument();
  });
});

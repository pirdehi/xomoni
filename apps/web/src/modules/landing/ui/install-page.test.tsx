// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DOWNLOAD_URL, RELEASES_URL } from '@/shared/config/site';
import { InstallPage } from './install-page';

describe('InstallPage (#44)', () => {
  it('downloads the latest release and links every version with its checksums', () => {
    render(<InstallPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Install Xomoni' })).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download the latest version' });
    expect(download).toHaveAttribute('href', DOWNLOAD_URL);
    expect(download).toHaveAttribute('data-appearance', 'primary');
    expect(screen.getByRole('link', { name: 'All versions and checksums' })).toHaveAttribute('href', RELEASES_URL);
    expect(screen.getByText(/with a SHA-256 checksum/)).toBeInTheDocument();
  });

  it('starts with the risks, then walks through loading the extension and connecting it, in order', () => {
    render(<InstallPage />);

    const steps = within(screen.getByRole('list', { name: 'Install steps' })).getAllByRole('listitem');
    expect(steps.map((step) => within(step).getByRole('heading', { level: 2 }).textContent)).toEqual([
      'Read what can go wrong',
      'Download and unzip',
      'Load it in Chrome, Edge or Brave',
      'Follow it here (optional)',
    ]);
    expect(within(steps[0]!).getByRole('link', { name: 'the risks' })).toHaveAttribute('href', '/risks');
    expect(steps[2]).toHaveTextContent('chrome://extensions');
    expect(steps[3]).toHaveTextContent('Only job status is sent');
  });

  it('says how to update without losing data', () => {
    render(<InstallPage />);

    expect(screen.getByText(/replace the folder’s contents/)).toHaveTextContent('Your data stays.');
  });

  it('sits between the site header and footer', () => {
    render(<InstallPage />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});

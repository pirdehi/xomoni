// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DOWNLOAD_URL, RELEASES_URL } from '@/shared/config/site';
import { InstallGuide } from './install-guide';

describe('InstallGuide (#44)', () => {
  it('downloads the latest release and links every version with its checksums', () => {
    render(<InstallGuide />);
    expect(screen.getByRole('link', { name: 'Download the latest version' })).toHaveAttribute('href', DOWNLOAD_URL);
    expect(screen.getByRole('link', { name: 'All versions and checksums' })).toHaveAttribute('href', RELEASES_URL);
  });

  it('starts with the risks, then walks through loading the extension and connecting it', () => {
    render(<InstallGuide />);
    const steps = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(steps).toEqual([
      'Read what can go wrong',
      'Download and unzip',
      'Load it in Chrome, Edge or Brave',
      'Follow it here (optional)',
    ]);
    expect(screen.getByRole('link', { name: 'the risks' })).toHaveAttribute('href', '/risks');
    expect(screen.getByText(/Only job status is sent/)).toBeInTheDocument();
  });
});

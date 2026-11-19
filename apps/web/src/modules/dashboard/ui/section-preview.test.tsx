// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GITHUB_URL } from '@/shared/config/site';
import { SECTIONS } from '../domain/sections';
import { SectionPreview } from './section-preview';

describe('SectionPreview (#245)', () => {
  it('says what a place not built yet will show, where its data comes from, and where the work is followed', () => {
    const engagement = SECTIONS.find((s) => s.id === 'engagement')!;
    render(<SectionPreview section={engagement} />);

    const card = screen.getByRole('region', { name: 'Engagement: coming soon' });
    expect(card).toHaveTextContent('What Engagement will show');
    expect(card).toHaveTextContent('Coming soon');
    expect(within(card).getAllByRole('listitem')).toHaveLength(engagement.shows.length);
    expect(card).toHaveTextContent('From: Daily numbers from Xomoni on your computer, if you turn them on.');
    expect(within(card).getByRole('link', { name: '#255' })).toHaveAttribute('href', `${GITHUB_URL}/issues/255`);
  });

  it('says that lists from Xomoni never reach the servers', () => {
    render(<SectionPreview section={SECTIONS.find((s) => s.id === 'library')!} />);
    expect(screen.getByRole('region', { name: 'Library: coming soon' })).toHaveTextContent(
      'your posts never reach our servers',
    );
  });

  it('offers what works today, such as Open in Xomoni, below the preview', () => {
    render(
      <SectionPreview
        section={SECTIONS.find((s) => s.id === 'watch')!}
        action={<button type="button">Open in Xomoni</button>}
      />,
    );
    const card = screen.getByRole('region', { name: 'Watch: coming soon' });
    expect(card).toHaveTextContent('Until then, it is in Xomoni on your computer.');
    expect(within(card).getByRole('button', { name: 'Open in Xomoni' })).toBeInTheDocument();
  });

  it('adds nothing when there is no action', () => {
    render(<SectionPreview section={SECTIONS.find((s) => s.id === 'audience')!} />);
    expect(screen.queryByText(/Until then/)).not.toBeInTheDocument();
  });
});

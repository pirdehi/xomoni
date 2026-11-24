// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { type Digest, parseDigest } from '../domain/parse';
import { DigestList, LIMITS_TEXT, digestLine } from './digest-list';
import { DigestShell } from './digest-shell';

/** A published digest of `month`, with the given changes. */
function digest(month: string, changes: Partial<Digest> = {}): Digest {
  const read = parseDigest({
    version: 1,
    month,
    repo: 'xai-org/x-algorithm',
    from: 'a'.repeat(40),
    to: 'b'.repeat(40),
    toDate: `${month}-20`,
    status: 'published',
    summary: 'Plain words.',
    commits: 12,
    files: 3,
    filesCapped: false,
    areas: [
      { area: 'ranking', files: 2, paths: ['home-mixer/scorers/a.rs', 'home-mixer/scorers/b.rs'] },
      { area: 'ads-blending', files: 1, paths: ['home-mixer/ads/c.rs'] },
    ],
    parameters: [],
    parameterCount: 0,
    messages: ['A change'],
    ...changes,
  });
  if (!read.ok) throw new Error(read.problems.join('; '));
  return read.digest;
}

describe('DigestShell', () => {
  it('puts the eyebrow, the title, the line under it and the text between the site’s header and footer', () => {
    render(
      <DigestShell eyebrow="Algorithm digest" title="A title" lead="One line.">
        <p>The text.</p>
      </DigestShell>,
    );
    const main = screen.getByRole('main');
    expect(within(main).getByRole('heading', { level: 1, name: 'A title' })).toBeInTheDocument();
    expect(within(main).getByText('Algorithm digest')).toBeInTheDocument();
    expect(within(main).getByText('One line.')).toBeInTheDocument();
    expect(within(main).getByText('The text.')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});

describe('DigestList (#430)', () => {
  it('lists each digest by its month, newest first as given, each linking its page with what it covers', () => {
    render(<DigestList digests={[digest('2026-11'), digest('2026-05', { commits: 1 })]} />);
    expect(screen.getByRole('heading', { level: 1, name: 'X’s ranking code, month by month' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Digests, newest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole('link', { name: 'November 2026' })).toHaveAttribute(
      'href',
      '/algorithm/2026-11',
    );
    expect(items[0]).toHaveTextContent('Up to November 20, 2026 · 12 commits · Ranking, Ads blending');
    expect(within(items[1]!).getByRole('link', { name: 'May 2026' })).toHaveAttribute('href', '/algorithm/2026-05');
    expect(items[1]).toHaveTextContent('1 commit ·');
  });

  it('says how a digest is made, from which public repository, and what it can’t tell', () => {
    render(<DigestList digests={[digest('2026-11')]} />);
    expect(screen.getByRole('link', { name: 'xai-org/x-algorithm' })).toHaveAttribute(
      'href',
      'https://github.com/xai-org/x-algorithm',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'How each digest is made' })).toBeInTheDocument();
    expect(screen.getByText(/these pages set no cookie/)).toBeInTheDocument();
    expect(screen.getByText(/A person then writes the summary/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'What a digest can’t tell you' })).toBeInTheDocument();
    expect(screen.getByText(LIMITS_TEXT)).toBeInTheDocument();
    expect(LIMITS_TEXT).toMatch(/X hides the real weights/);
  });

  it('says so when no digest is out yet', () => {
    render(<DigestList digests={[]} />);
    expect(screen.queryByRole('list', { name: 'Digests, newest first' })).not.toBeInTheDocument();
    expect(screen.getByText(/No digest is out yet/)).toBeInTheDocument();
    // What a digest is and can't tell is there all the same.
    expect(screen.getByText(LIMITS_TEXT)).toBeInTheDocument();
  });

  it('writes a digest’s line without areas when its range touched none', () => {
    expect(digestLine(digest('2026-11', { areas: [], files: 0 }))).toBe('Up to November 20, 2026 · 12 commits');
  });
});

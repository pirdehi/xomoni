// @vitest-environment happy-dom
import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type Digest, parseDigest } from '../domain/parse';
import { LIMITS_TEXT } from './digest-list';
import { DigestPage, rangeLine } from './digest-page';

const FROM = '1234567'.padEnd(40, 'a');
const TO = '89abcde'.padEnd(40, 'b');
const MARKUP = '<script>window.ran = true</script><img src=x onerror="window.ran = true">';

/** A published digest of November 2026, with the given changes. */
function digest(changes: Record<string, unknown> = {}): Digest {
  const read = parseDigest({
    version: 1,
    month: '2026-11',
    repo: 'xai-org/x-algorithm',
    from: FROM,
    to: TO,
    toDate: '2026-11-21',
    status: 'published',
    summary: 'Ranking gained a scorer (`home-mixer/scorers/a.rs`).\n\nA filter was removed.',
    commits: 20,
    files: 300,
    filesCapped: false,
    areas: [
      { area: 'ranking', files: 102, paths: ['home-mixer/scorers/a.rs', 'home-mixer/scorers/b.rs'] },
      { area: 'parameters', files: 3, paths: ['home-mixer/params/config.rs'] },
    ],
    parameters: ['rust_home_mixer_reply_weight', 'rust_home_mixer_click_weight'],
    parameterCount: 208,
    messages: ['Open-source X Recommendation Algorithm', MARKUP],
    ...changes,
  });
  if (!read.ok) throw new Error(read.problems.join('; '));
  return read.digest;
}

describe('DigestPage (#430, ADR-0046)', () => {
  it('names the month, the range and how much changed', () => {
    render(<DigestPage digest={digest()} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'What changed in X’s ranking code: November 2026' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('From commit 1234567 to 89abcde, up to November 21, 2026: 20 commits, 300 files changed.'),
    ).toBeInTheDocument();
    expect(rangeLine(digest({ commits: 1, files: 1 }))).toMatch(/: 1 commit, 1 file changed\.$/);
  });

  it('shows the summary as paragraphs of text, then what it can’t tell', () => {
    render(<DigestPage digest={digest()} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Summary',
      'What this can’t tell you',
      'Where the code changed',
      'Parameters that changed',
      'Commit messages',
    ]);
    expect(screen.getByText('Ranking gained a scorer (`home-mixer/scorers/a.rs`).').tagName).toBe('P');
    expect(screen.getByText('A filter was removed.').tagName).toBe('P');
    expect(screen.getByText(LIMITS_TEXT)).toBeInTheDocument();
  });

  it('lists the areas in a table with their counts and some of their files', () => {
    render(<DigestPage digest={digest()} />);
    const table = screen.getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Part of the code', 'Files', 'Some of them']);
    const ranking = within(table)
      .getByRole('rowheader', { name: /^Ranking/ })
      .closest('tr')!;
    expect(ranking).toHaveTextContent('102');
    expect(within(ranking).getByText('home-mixer/scorers/b.rs').tagName).toBe('CODE');
    expect(within(table).getByRole('rowheader', { name: /^Parameters/ })).toHaveTextContent(
      'The settings and switches that tune the rest, by name.',
    );
    expect(within(table).queryByText(/300 files at most/)).not.toBeInTheDocument();
  });

  it('says when GitHub cut the file list, and when no file was listed', () => {
    const { unmount } = render(<DigestPage digest={digest({ filesCapped: true })} />);
    expect(screen.getByRole('table')).toHaveTextContent('GitHub lists 300 files at most');
    unmount();
    render(<DigestPage digest={digest({ areas: [], files: 0 })} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('GitHub listed no file for this range.')).toBeInTheDocument();
  });

  it('names the parameters, with how many more changed, or says none did', () => {
    const { unmount } = render(<DigestPage digest={digest()} />);
    const names = screen.getByRole('list', { name: 'Parameters' });
    expect(
      within(names)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['rust_home_mixer_reply_weight', 'rust_home_mixer_click_weight']);
    expect(screen.getByText('And 206 more.')).toBeInTheDocument();
    expect(screen.getByText(/the values in the public code aren’t the ones X runs with/)).toBeInTheDocument();
    unmount();
    render(<DigestPage digest={digest({ parameters: [], parameterCount: 0 })} />);
    expect(screen.queryByRole('list', { name: 'Parameters' })).not.toBeInTheDocument();
    expect(screen.getByText('No parameter’s definition changed in this range.')).toBeInTheDocument();
    expect(screen.queryByText(/more\.$/)).not.toBeInTheDocument();
  });

  it('shows a commit message with markup as the text it is, never as HTML (security)', () => {
    const { container } = render(<DigestPage digest={digest()} />);
    const messages = screen.getByRole('list', { name: 'Commit messages' });
    expect(within(messages).getByText(MARKUP)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    // The logo in the header is the page's only image.
    expect(container.querySelector('main img[src="x"]')).toBeNull();
    expect(within(messages).queryByRole('img')).not.toBeInTheDocument();
    const html = renderToString(<DigestPage digest={digest()} />);
    expect(html).not.toContain('<script>window.ran');
    expect(html).toContain('&lt;script&gt;window.ran = true&lt;/script&gt;');
  });

  it('says so when there is no commit message', () => {
    render(<DigestPage digest={digest({ messages: [] })} />);
    expect(screen.queryByRole('list', { name: 'Commit messages' })).not.toBeInTheDocument();
    expect(screen.getByText('None.')).toBeInTheDocument();
  });

  it('links the exact range on GitHub in a new tab that can’t reach back, and every digest', () => {
    render(<DigestPage digest={digest()} />);
    const github = screen.getByRole('link', { name: 'See every change on GitHub' });
    expect(github).toHaveAttribute('href', `https://github.com/xai-org/x-algorithm/compare/${FROM}...${TO}`);
    expect(github).toHaveAttribute('target', '_blank');
    expect(github).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'All digests' })).toHaveAttribute('href', '/algorithm');
  });
});

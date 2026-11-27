// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALGORITHM_DIGEST_URL, AlgorithmDigestCard } from '../../src/ui/components/reach/AlgorithmDigestCard';
import { FluentRoot } from '../../src/ui/fluent';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AlgorithmDigestCard (#430, ADR-0046)', () => {
  it('links the digests on xomoni.com in a new tab that can’t reach back, with nothing about the person in the address', () => {
    render(
      <FluentRoot>
        <AlgorithmDigestCard />
      </FluentRoot>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'What changed in X’s ranking code' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Read the digests on xomoni.com' });
    expect(link).toHaveAttribute('href', 'https://xomoni.com/algorithm');
    expect(ALGORITHM_DIGEST_URL).toBe('https://xomoni.com/algorithm');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('says what a digest can’t tell: X hides the real weights', () => {
    render(
      <FluentRoot>
        <AlgorithmDigestCard />
      </FluentRoot>,
    );
    expect(screen.getByText(/X hides the real weights/)).toBeInTheDocument();
    expect(
      screen.getByText(/made from the code X publishes for its recommendations, and from nothing else/),
    ).toBeInTheDocument();
  });

  it('fetches nothing: the digest lives on xomoni.com only (security)', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(
      <FluentRoot>
        <AlgorithmDigestCard />
      </FluentRoot>,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

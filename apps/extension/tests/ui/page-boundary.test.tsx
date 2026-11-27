// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageBoundary } from '../../src/ui/components/PageBoundary';

/** A page that fails while it draws, as one does when its live query fails. */
function Broken(): never {
  throw new RangeError('Maximum call stack size exceeded');
}

describe('a page that fails to draw (#497)', () => {
  beforeEach(() => {
    // React reports the error it caught in the console.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('draws the page as it is while nothing fails', () => {
    render(
      <PageBoundary>
        <h1>Reach</h1>
      </PageBoundary>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Reach' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so in the page’s place, and leaves what is drawn beside it alone', () => {
    render(
      <>
        <nav aria-label="Menu">
          <button type="button">Home</button>
        </nav>
        <PageBoundary>
          <Broken />
        </PageBoundary>
      </>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("This page couldn't be shown");
    expect(alert).toHaveTextContent('open another page from the menu');
    expect(screen.getByRole('heading', { level: 1, name: "This page couldn't be shown" })).toBeInTheDocument();
    // Nothing of the error itself is shown.
    expect(alert).not.toHaveTextContent('Maximum call stack');
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
  });

  it('draws another page afresh once the shell gives it another key', () => {
    const { rerender } = render(
      <PageBoundary key="reach">
        <Broken />
      </PageBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    rerender(
      <PageBoundary key="overview">
        <h1>Home</h1>
      </PageBoundary>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

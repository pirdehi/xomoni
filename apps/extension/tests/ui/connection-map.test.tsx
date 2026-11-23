// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PageInfo } from '../../src/shared/messages';
import { ConnectionMap, describeConnections, sentToWebsite, xLinkOf } from '../../src/ui/components/ConnectionMap';

afterEach(cleanup);

/** The two lines of the map, X ↔ this browser and this browser ↔ xomoni.com. */
const lines = (container: HTMLElement) => [...container.querySelectorAll('[data-flow]')];

describe('the connection map (#182)', () => {
  it('lets data flow along live links, with what crosses each written underneath', () => {
    const { container } = render(<ConnectionMap x="signed-in" cloud="connected" />);

    expect(lines(container).map((line) => line.getAttribute('data-flow'))).toEqual(['live', 'live']);
    // Three dots travel each live line, staggered.
    expect(lines(container).map((line) => line.childElementCount)).toEqual([3, 3]);
    expect(container).toHaveTextContent('Posts stay here');
    expect(container).toHaveTextContent('Status only');
  });

  it('marches dashes along a link waiting for the person, and draws no link as a still dashed line', () => {
    const pending = render(<ConnectionMap x="signed-out" cloud="pending" />);
    expect(lines(pending.container).map((line) => line.getAttribute('data-flow'))).toEqual(['off', 'pending']);
    expect(lines(pending.container).every((line) => line.childElementCount === 0)).toBe(true);
    expect(pending.container).toHaveTextContent('Waiting for you');
    cleanup();

    const off = render(<ConnectionMap x="unknown" cloud="off" size="large" />);
    expect(lines(off.container).map((line) => line.getAttribute('data-flow'))).toEqual(['off', 'off']);
    expect(off.container).toHaveTextContent('Not connected');
  });

  it('names the three ends and tells the whole picture to screen readers', () => {
    render(<ConnectionMap x="signed-in" cloud="off" />);

    const map = screen.getByRole('img');
    expect(map).toHaveTextContent('X account');
    expect(map).toHaveTextContent('This browser');
    expect(map).toHaveTextContent('xomoni.com');
    expect(map).toHaveAccessibleName(describeConnections('signed-in', 'off'));
  });

  it.each(['signed-in', 'signed-out', 'unknown'] as const)(
    'names X in words, with a generic person icon and never X’s mark, when %s (#322, ADR-0035)',
    (x) => {
      const { container } = render(<ConnectionMap x={x} cloud="connected" size="large" />);

      const node = container.querySelector('[data-node="x"]')!;
      // A person icon, the same kind as the other nodes' icons: an SVG, not a letter.
      expect(node.querySelector('svg')).not.toBeNull();
      expect(node.textContent).toBe('');
      expect(node.querySelector('img')).toBeNull();
      // No double-struck 𝕏 (U+1D54F) or bold 𝐗 (U+1D417) anywhere in the map.
      expect(container.textContent).not.toMatch(/\u{1D54F}|\u{1D417}/u);
      expect(screen.getByText('X account')).toBeInTheDocument();
    },
  );

  it('shows Xomoni in this browser with its own icon, not a platform’s', () => {
    const { container } = render(<ConnectionMap x="signed-in" cloud="off" />);
    const images = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(images).toEqual(['icons/icon48.png']);
  });

  it.each([
    ['signed-in', 'connected', /signed in to X; your posts are read and cleaned here and stay here\..*only that/],
    ['signed-out', 'pending', /signed out of X\..*waiting for you/],
    ['unknown', 'off', /the X account this browser is signed in to\..*isn’t connected/],
  ] as const)('describes %s with xomoni.com %s', (x, cloud, words) => {
    expect(describeConnections(x, cloud)).toMatch(words);
  });

  // What reaches xomoni.com, said exactly in both states (ADR-0004, ADR-0026, #450).
  it('says job status only while the daily numbers are off, and names the numbers while they are on', () => {
    const off = render(<ConnectionMap x="signed-in" cloud="connected" />);
    expect(off.container).toHaveTextContent('Status only');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'This browser is signed in to X; your posts are read and cleaned here and stay here. It sends job status, and only that, to xomoni.com.',
    );
    cleanup();

    const on = render(<ConnectionMap x="signed-in" cloud="connected" numbers />);
    expect(on.container).toHaveTextContent('Status and numbers');
    expect(on.container).not.toHaveTextContent('Status only');
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'This browser is signed in to X; your posts are read and cleaned here and stay here. It sends job status and your daily numbers, and only those, to xomoni.com.',
    );
  });

  it('says nothing about numbers on a link that sends nothing', () => {
    expect(describeConnections('signed-in', 'pending', true)).toMatch(/waiting for you\.$/);
    expect(describeConnections('signed-in', 'off', true)).toMatch(/isn’t connected to xomoni\.com\.$/);
    const { container } = render(<ConnectionMap x="signed-in" cloud="off" numbers />);
    expect(container).toHaveTextContent('Not connected');
    expect(container).not.toHaveTextContent(/numbers/);
  });

  it('words what is sent for the panel: job status, and the numbers only while on', () => {
    expect(sentToWebsite(false)).toBe('Only job status is sent: titles, states and counts, never your posts or likes.');
    expect(sentToWebsite(true)).toBe(
      'Only job status and your daily numbers are sent: titles, states and counts, never your posts or likes.',
    );
  });

  it('reads the X link from the worker’s last look at X', () => {
    expect(xLinkOf({ info: null })).toBe('unknown');
    expect(xLinkOf({ info: { loggedIn: true } as PageInfo })).toBe('signed-in');
    expect(xLinkOf({ info: { loggedIn: false } as PageInfo })).toBe('signed-out');
  });
});

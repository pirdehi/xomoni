// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PageInfo } from '../../src/shared/messages';
import { ConnectionMap, describeConnections, xLinkOf } from '../../src/ui/components/ConnectionMap';

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
    expect(map).toHaveTextContent('X');
    expect(map).toHaveTextContent('This browser');
    expect(map).toHaveTextContent('xomoni.com');
    expect(map).toHaveAccessibleName(describeConnections('signed-in', 'off'));
  });

  it.each([
    ['signed-in', 'connected', /signed in to X; your posts are read and cleaned here and stay here\..*only that/],
    ['signed-out', 'pending', /signed out of X\..*waiting for you/],
    ['unknown', 'off', /the X account this browser is signed in to\..*isn’t connected/],
  ] as const)('describes %s with xomoni.com %s', (x, cloud, words) => {
    expect(describeConnections(x, cloud)).toMatch(words);
  });

  it('reads the X link from the worker’s last look at X', () => {
    expect(xLinkOf({ info: null })).toBe('unknown');
    expect(xLinkOf({ info: { loggedIn: true } as PageInfo })).toBe('signed-in');
    expect(xLinkOf({ info: { loggedIn: false } as PageInfo })).toBe('signed-out');
  });
});

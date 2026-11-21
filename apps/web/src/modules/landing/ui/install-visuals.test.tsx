// @vitest-environment happy-dom
import { RendererProvider, createDOMRenderer } from '@fluentui/react-components';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Platform, UNKNOWN_PLATFORM } from '../domain/install-guide';
import { installVisual } from '../domain/install-visuals';
import { usePlatform } from './install-guide';
import { InstallVisualFigure, InstallVisuals, usePrefersReducedMotion } from './install-visuals';

const UA = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
};

const CHROME_MAC: Platform = { browser: 'chrome', os: 'mac', phone: false };
const EDGE_WINDOWS: Platform = { browser: 'edge', os: 'windows', phone: false };
const BRAVE_MAC: Platform = { browser: 'brave', os: 'mac', phone: false };

/** A `matchMedia` that answers whether the system asks for less motion, with the listeners it was given. */
function system({ reducedMotion }: { reducedMotion: boolean }) {
  const listeners = new Set<() => void>();
  const state = { reducedMotion };
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('prefers-reduced-motion: reduce') && state.reducedMotion;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    change(next: boolean) {
      state.reducedMotion = next;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
}

/** Makes this test's browser say it is this one. */
function browser(userAgent: string, brands: string[], platform: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(window.navigator, 'userAgentData', {
    value: { brands: brands.map((brand) => ({ brand, version: '131' })), platform, mobile: false },
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'userAgent');
  Reflect.deleteProperty(window.navigator, 'userAgentData');
  vi.unstubAllGlobals();
});

/**
 * Renders with Fluent's styles kept in memory, as on the server: the tests' DOM takes no styles (`test/setup.ts`), so
 * this is how a test reads the rules each part of a drawing gets.
 */
function renderStyled(ui: ReactNode) {
  // No document: Griffel keeps the rules it would insert, as it does while rendering on the server. The provider
  // looks in an empty one, so it doesn't adopt the <style> elements other tests' renders left in this one.
  const renderer = createDOMRenderer(null as unknown as Document);
  const result = render(
    <RendererProvider renderer={renderer} targetDocument={document.implementation.createHTMLDocument('')}>
      {ui}
    </RendererProvider>,
  );
  const rules = () => Object.values(renderer.stylesheets).flatMap((sheet) => sheet.cssRules());
  return { ...result, rules };
}

/** The drawing in a figure, without the button's icon. */
const drawing = (figure: HTMLElement) => figure.querySelector(':scope > svg')!;

/** The class names a rule gives `declaration` to, such as `animation-name:` (not under a media query). */
function classesWith(rules: string[], declaration: RegExp): Set<string> {
  return new Set(
    rules.flatMap((rule) => {
      const match = /^\.([\w-]+)\{([^}]*)\}$/.exec(rule);
      return match && declaration.test(match[2]!) ? [match[1]!] : [];
    }),
  );
}

/** The parts of a drawing that its styles animate. */
function movingParts(figure: HTMLElement, rules: string[]): Element[] {
  const animated = classesWith(rules, /animation-name:(?!none)/);
  return Array.from(drawing(figure).querySelectorAll('*')).filter((part) =>
    Array.from(part.classList).some((name) => animated.has(name)),
  );
}

/** Whether the drawing's own classes pause every animation inside it. */
function pausesInside(figure: HTMLElement, rules: string[]): boolean {
  return Array.from(drawing(figure).classList).some((name) =>
    rules.includes(`.${name} *{animation-play-state:paused;}`),
  );
}

const figures = () => screen.getAllByRole('figure');

describe('InstallVisuals (#299)', () => {
  it('shows turning on Developer mode and dragging the folder in when adding Xomoni, in Chrome on a Mac', () => {
    system({ reducedMotion: false });
    render(<InstallVisuals step="add" platform={CHROME_MAC} />);

    expect(figures()).toHaveLength(2);
    const [developerMode, folder] = figures() as [HTMLElement, HTMLElement];
    expect(developerMode).toHaveAccessibleName(
      'Illustration On chrome://extensions, the Developer mode switch at the top right is turned on, and Load unpacked appears.',
    );
    expect(developerMode).toHaveAttribute('data-layout', 'top-bar');
    expect(developerMode).toHaveAttribute('data-frame', 'mac');
    expect(folder).toHaveAccessibleName(
      'Illustration The xomoni-extension folder is dragged onto chrome://extensions and dropped there.',
    );
    // The drawing writes the browser's own words, and Chrome says Drop to install over the page.
    expect(drawing(developerMode)).toHaveTextContent('chrome://extensions');
    expect(drawing(developerMode)).toHaveTextContent('Developer mode');
    expect(drawing(developerMode)).toHaveTextContent('Load unpacked');
    expect(drawing(folder)).toHaveTextContent('Drop to install');
    expect(drawing(folder)).toHaveTextContent('xomoni-extension');
  });

  it('draws Edge’s extensions page with Developer mode in the left panel, a Windows window, and the eye to pin', () => {
    system({ reducedMotion: false });
    const { unmount } = render(<InstallVisuals step="add" platform={EDGE_WINDOWS} />);
    const [developerMode, folder] = figures() as [HTMLElement, HTMLElement];
    expect(developerMode).toHaveAttribute('data-layout', 'side-panel');
    expect(developerMode).toHaveAttribute('data-frame', 'windows');
    expect(developerMode).toHaveAccessibleName(/the Developer mode switch in the panel on the left is turned on/);
    expect(developerMode.querySelector('[data-part="window-buttons"]')).toBeInTheDocument();
    expect(drawing(developerMode)).toHaveTextContent('edge://extensions');
    // Edge's page isn't drawn saying what only Chrome's says.
    expect(drawing(folder)).not.toHaveTextContent('Drop to install');
    unmount();

    render(<InstallVisuals step="connect" platform={EDGE_WINDOWS} />);
    expect(figures()).toHaveLength(1);
    expect(figures()[0]).toHaveAttribute('data-control', 'eye');
    expect(figures()[0]).toHaveAccessibleName(/the eye next to Xomoni \(Show in toolbar\) puts it in the toolbar/);
  });

  it('draws Brave’s own address, laid out like Chrome’s, with the pin', () => {
    system({ reducedMotion: false });
    render(
      <>
        <InstallVisuals step="add" platform={BRAVE_MAC} />
        <InstallVisuals step="connect" platform={BRAVE_MAC} />
      </>,
    );
    const [developerMode, , pin] = figures() as [HTMLElement, HTMLElement, HTMLElement];
    expect(developerMode).toHaveAttribute('data-layout', 'top-bar');
    expect(drawing(developerMode)).toHaveTextContent('brave://extensions');
    expect(pin).toHaveAttribute('data-control', 'pin');
    expect(pin).toHaveAccessibleName(/the pin next to Xomoni puts it in the toolbar/);
  });

  it('shows nothing for a step without an illustration', () => {
    const { container } = render(<InstallVisuals step="download" platform={CHROME_MAC} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('InstallVisualFigure (#299)', () => {
  const visual = installVisual('developer-mode', CHROME_MAC);

  it('is labelled an illustration, and says in words what it shows; the drawing itself is hidden from screen readers', () => {
    system({ reducedMotion: false });
    render(<InstallVisualFigure visual={visual} />);

    const figure = screen.getByRole('figure');
    const caption = figure.querySelector('figcaption')!;
    expect(caption).toHaveTextContent(`Illustration ${visual.caption}`);
    expect(figure).toHaveAccessibleName(`Illustration ${visual.caption}`);
    expect(drawing(figure)).toHaveAttribute('aria-hidden', 'true');
    // No picture to name: the words are the caption, and nothing but the caption and its button is read.
    expect(within(figure).queryByRole('img')).not.toBeInTheDocument();
  });

  it('plays, pauses and plays again, saying which in its button', async () => {
    system({ reducedMotion: false });
    const user = userEvent.setup();
    const { rules } = renderStyled(<InstallVisualFigure visual={visual} />);
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute('data-motion', 'playing');
    // The pointer, its click, the switch, its knob, the buttons that appear and the fade between loops.
    expect(movingParts(figure, rules())).toHaveLength(6);
    expect(pausesInside(figure, rules())).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Pause the illustration of turning on Developer mode' }));
    expect(figure).toHaveAttribute('data-motion', 'paused');
    const play = screen.getByRole('button', { name: 'Play the illustration of turning on Developer mode' });
    expect(play).toHaveTextContent('Play');
    // Paused where it was: every moving part holds still.
    expect(pausesInside(figure, rules())).toBe(true);

    await user.click(play);
    expect(figure).toHaveAttribute('data-motion', 'playing');
    expect(screen.getByRole('button', { name: /^Pause/ })).toHaveTextContent('Pause');
    expect(pausesInside(figure, rules())).toBe(false);
  });

  it('stops every moving part under reduced motion in its styles, before the page knows the system’s wish', () => {
    system({ reducedMotion: false });
    for (const id of ['developer-mode', 'add-folder', 'pin'] as const) {
      const { rules, unmount } = renderStyled(<InstallVisualFigure visual={installVisual(id, EDGE_WINDOWS)} />);
      const figure = screen.getByRole('figure');
      const moving = movingParts(figure, rules());
      expect(moving.length).toBeGreaterThan(2);
      const stilled = new Set(
        rules().flatMap((rule) => {
          const match = /^@media \(prefers-reduced-motion: reduce\)\{\.([\w-]+)\{animation-name:none;\}\}$/.exec(rule);
          return match ? [match[1]!] : [];
        }),
      );
      for (const part of moving) expect(Array.from(part.classList).some((name) => stilled.has(name))).toBe(true);
      // And its Pause button is hidden there too.
      const button = within(figure).getByRole('button');
      expect(
        Array.from(button.classList).some((name) =>
          rules().includes(`@media (prefers-reduced-motion: reduce){.${name}{display:none;}}`),
        ),
      ).toBe(true);
      unmount();
    }
  });

  it('stands still on its last frame under reduced motion, with nothing to pause', () => {
    system({ reducedMotion: true });
    const { rules } = renderStyled(<InstallVisualFigure visual={visual} />);

    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute('data-motion', 'still');
    expect(movingParts(figure, rules())).toEqual([]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // The last frame: the switch on, Load unpacked showing, the words the same.
    expect(figure.querySelector('[data-part="developer-buttons"]')).toHaveTextContent('Load unpacked');
    expect(figure).toHaveAccessibleName(`Illustration ${visual.caption}`);
  });

  it('stops when the system starts asking for less motion, and plays again when it stops asking', () => {
    const media = system({ reducedMotion: false });
    const { rules } = renderStyled(<InstallVisualFigure visual={installVisual('pin', CHROME_MAC)} />);
    const figure = screen.getByRole('figure');
    // The pointer, its two clicks, the menu, the pin's head and needle, Xomoni in the toolbar and the fade.
    expect(movingParts(figure, rules())).toHaveLength(8);

    media.change(true);
    expect(figure).toHaveAttribute('data-motion', 'still');
    expect(movingParts(figure, rules())).toEqual([]);
    media.change(false);
    expect(figure).toHaveAttribute('data-motion', 'playing');
    expect(movingParts(figure, rules())).toHaveLength(8);
  });

  it('draws in the theme’s colors only, so it is light or dark with the page', () => {
    system({ reducedMotion: false });
    for (const id of ['developer-mode', 'add-folder', 'pin'] as const) {
      const { rules, unmount } = renderStyled(<InstallVisualFigure visual={installVisual(id, EDGE_WINDOWS)} />);
      const parts = Array.from(drawing(screen.getByRole('figure')).querySelectorAll('*'));
      expect(parts.length).toBeGreaterThan(20);
      // No color is written into the drawing: every fill and stroke comes from a class.
      for (const part of parts) {
        expect(part.getAttribute('fill')).toBeNull();
        expect(part.getAttribute('stroke')).toBeNull();
        expect(part.getAttribute('style')).toBeNull();
      }
      // And every class's color is one of Fluent's theme variables, which the dark theme redefines.
      const used = new Set(parts.flatMap((part) => Array.from(part.classList)));
      const colors = rules().flatMap((rule) => {
        const match = /^\.([\w-]+)\{(fill|stroke):([^;]+);\}$/.exec(rule);
        return match && used.has(match[1]!) ? [match[3]!] : [];
      });
      expect(colors.length).toBeGreaterThan(10);
      for (const color of colors) expect(color).toMatch(/^(none|var\(--color[A-Za-z0-9]+\))$/);
      unmount();
    }
  });
});

describe('usePrefersReducedMotion and the server (#299)', () => {
  it('renders the general drawing, playing, on the server, then the browser’s own once hydrated, with no mismatch', async () => {
    system({ reducedMotion: true });
    browser(UA.edgeWindows, ['Chromium', 'Microsoft Edge'], 'Windows');
    function Visuals() {
      return <InstallVisuals step="add" platform={usePlatform()} />;
    }
    const html = renderToString(<Visuals />);
    // The server knows neither the browser nor the system's wish: general words, and a Pause button the page's
    // styles hide under reduced motion until the browser renders.
    expect(html).toContain('chrome://extensions');
    expect(html).toContain('data-layout="top-bar"');
    expect(html).toContain('data-motion="playing"');
    expect(html).toContain('Pause');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.append(container);
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <Visuals />, { onRecoverableError: (error) => errors.push(error) });
    });
    expect(errors).toEqual([]);
    const [developerMode] = within(container).getAllByRole('figure');
    expect(developerMode).toHaveAttribute('data-layout', 'side-panel');
    expect(developerMode).toHaveAttribute('data-motion', 'still');
    expect(within(container).queryByRole('button')).not.toBeInTheDocument();
    container.remove();
  });

  it('is false on the server and follows the system in the browser', () => {
    system({ reducedMotion: true });
    function Wish() {
      return <p>{usePrefersReducedMotion() ? 'less motion' : 'motion'}</p>;
    }
    expect(renderToString(<Wish />)).toContain('>motion<');
    render(<Wish />);
    expect(screen.getByText('less motion')).toBeInTheDocument();
  });

  it('keeps the general drawing before the page knows the browser', () => {
    system({ reducedMotion: false });
    render(<InstallVisuals step="connect" platform={UNKNOWN_PLATFORM} />);
    expect(figures()[0]).toHaveAttribute('data-frame', 'plain');
    expect(figures()[0]).toHaveAttribute('data-control', 'pin');
  });
});

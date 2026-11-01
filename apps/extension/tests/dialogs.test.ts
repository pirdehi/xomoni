// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/content/actor';
import { pageNeed } from '../src/shared/attention';
import type { ClearResult, PageInfo } from '../src/shared/messages';

interface Popup {
  label: string;
  /** Escape closes it, as most of X's modals do. */
  escapeCloses?: boolean;
  /** It has its own "×" button (X's `app-bar-close`). */
  closeButton?: boolean;
  text?: string;
}

/** Every button clicked inside a pop-up, by `data-testid`. */
let clicks: string[] = [];

// One listener for the whole file: `body` outlives each rendered page.
document.body.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelectorAll('[data-escape-closes]').forEach((d) => d.remove());
});

/** Renders a signed-in x.com page with X's `#layers` and, optionally, pop-ups in it. */
function renderX(popups: Popup[] = [], extra = '') {
  clicks = [];
  document.body.innerHTML = `
    <main><div data-testid="primaryColumn">Home</div></main>
    <div id="layers">${extra}</div>`;
  const layers = document.getElementById('layers')!;
  for (const { label, escapeCloses = true, closeButton = false, text = 'Get more out of X' } of popups) {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', label);
    if (escapeCloses) dialog.setAttribute('data-escape-closes', '');
    dialog.innerHTML = `<p>${text}</p><button data-testid="subscribe">Subscribe</button>${
      closeButton ? '<button data-testid="app-bar-close" aria-label="Close"></button>' : ''
    }`;
    dialog.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        clicks.push(b.dataset.testid ?? '');
        if (b.dataset.testid === 'app-bar-close') dialog.remove();
      }),
    );
    layers.append(dialog);
  }
}

const ping = () => runCommand({ cmd: 'ping' }) as Promise<PageInfo>;
const clearPage = () => runCommand({ cmd: 'clearPage' }) as Promise<ClearResult>;
const dialogs = () => document.querySelectorAll('[role="dialog"]').length;

beforeEach(() => {
  document.cookie = 'twid=u%3D1000; path=/';
  history.pushState({}, '', '/home');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('pop-ups over X’s page (#29, PLAYBOOK F3)', { timeout: 15_000 }, () => {
  it('reports a pop-up in X’s layers, but not menus or non-modal panels', async () => {
    renderX([{ label: 'Unlock more on X' }]);
    expect((await ping()).obstructed).toBe(true);
    renderX([], '<div role="menu"><div role="menuitem">Delete</div></div>');
    expect((await ping()).obstructed).toBe(false);
    renderX();
    document.body.insertAdjacentHTML('beforeend', '<aside role="dialog" aria-label="Messages">DMs</aside>');
    expect((await ping()).obstructed).toBe(false);
  });

  it('closes a pop-up with Escape, clicking nothing in it', async () => {
    renderX([{ label: 'Unlock more on X' }]);
    expect(await clearPage()).toEqual({ clear: true, what: 'Unlock more on X' });
    expect(dialogs()).toBe(0);
    expect(clicks).toEqual([]);
  });

  it('uses the pop-up’s own close button when Escape doesn’t work, and nothing else', async () => {
    renderX([{ label: 'Turn on notifications', escapeCloses: false, closeButton: true }]);
    expect(await clearPage()).toEqual({ clear: true, what: 'Turn on notifications' });
    expect(clicks).toEqual(['app-bar-close']);
  });

  it('reports a pop-up it can’t close, without clicking its other buttons', async () => {
    renderX([{ label: 'Subscribe to Premium', escapeCloses: false }]);
    expect(await clearPage()).toEqual({ clear: false, what: 'Subscribe to Premium' });
    expect(dialogs()).toBe(1);
    expect(clicks).toEqual([]);
  });

  it('never touches X’s login, which is a pop-up too', async () => {
    history.pushState({}, '', '/i/flow/login');
    renderX([{ label: 'Sign in to X' }]);
    expect(await clearPage()).toEqual({ clear: false, what: 'Sign in to X' });
    expect(dialogs()).toBe(1); // Escape was never pressed
  });

  it('reads a restriction notice shown in a pop-up', async () => {
    renderX([{ label: 'Notice', text: 'Your account is temporarily limited' }]);
    expect((await ping()).restriction).toMatch(/temporarily limited/);
  });

  it('asks the person only after login, X’s checks and the account are fine', () => {
    const page = { loggedIn: true, locked: false, challenge: false, viewerId: '1000', obstructed: true };
    expect(pageNeed(page, '1000')).toBe('obstruction');
    expect(pageNeed({ ...page, loggedIn: false }, '1000')).toBe('login');
    expect(pageNeed({ ...page, challenge: true }, '1000')).toBe('verify');
    expect(pageNeed({ ...page, viewerId: '2000' }, '1000')).toBe('account');
    expect(pageNeed({ ...page, obstructed: false }, '1000')).toBeNull();
  });
});

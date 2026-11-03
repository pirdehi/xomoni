// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/content/actor';
import type { CanaryResult } from '../src/shared/messages';

interface Page {
  /** Labels of the post menu the "…" button opens; `null` removes the "…" button. */
  menu?: string[] | null;
  /** Whether Escape closes an open menu, as on X. */
  escapeCloses?: boolean;
  liked?: boolean | null;
  reposted?: boolean | null;
}

/** Every click on a menu option, which a canary must never make. */
let optionClicks: string[] = [];
/** Escapes that reached `document.body`, where X's React handlers never hear them (#121). */
let bodyEscapes = 0;

// One listener for the whole file: `body` outlives each rendered page. It only counts: on X nothing there closes menus.
document.body.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') bodyEscapes++;
});

/** Renders a simulated x.com timeline with one of the person's posts (id 1) and X's menu behavior. */
function renderX({
  menu = ['Pin to your profile', 'Delete'],
  escapeCloses = true,
  liked = true,
  reposted = true,
}: Page = {}) {
  optionClicks = [];
  bodyEscapes = 0;
  const button = (testid: string) => `<button data-testid="${testid}"></button>`;
  document.body.innerHTML = `
    <article data-testid="tweet">
      <a href="/me/status/1"><time datetime="2024-01-01T00:00:00.000Z"></time></a>
      ${menu ? button('caret') : ''}
      ${liked == null ? '' : button(liked ? 'unlike' : 'like')}
      ${reposted == null ? '' : button(reposted ? 'unretweet' : 'retweet')}
    </article>`;

  // Like X: the menu opens in #layers, takes focus, and only its own (React) handler closes it on Escape.
  const openMenu = (items: string) => {
    const layers = document.getElementById('layers') ?? document.body.appendChild(document.createElement('div'));
    layers.id = 'layers';
    const el = document.createElement('div');
    el.setAttribute('role', 'menu');
    el.tabIndex = -1;
    el.innerHTML = items;
    el.querySelectorAll('[role="menuitem"]').forEach((item) =>
      item.addEventListener('click', () => optionClicks.push(item.textContent)),
    );
    el.addEventListener('keydown', (event) => {
      // Older handlers, like some of X's, check the legacy key code.
      if (escapeCloses && event.key === 'Escape' && Reflect.get(event, 'keyCode') === 27) el.remove();
    });
    layers.append(el);
    el.focus();
  };
  document
    .querySelector('[data-testid="caret"]')
    ?.addEventListener('click', () =>
      openMenu((menu ?? []).map((label) => `<div role="menuitem"><span>${label}</span></div>`).join('')),
    );
  document
    .querySelector('[data-testid="unretweet"]')
    ?.addEventListener('click', () =>
      openMenu('<div role="menuitem" data-testid="unretweetConfirm"><span>Undo repost</span></div>'),
    );
}

const canary = (action: 'delete' | 'unlike' | 'relike' | 'unretweet', id = '1') =>
  runCommand({ cmd: 'canary', action, id }) as Promise<CanaryResult>;
const menuOpen = () => !!document.querySelector('[role="menu"]');

afterEach(() => {
  document.body.innerHTML = '';
});

// The canary waits for X's menu in real time: up to 4 s for an option that never appears.
describe('canary: X’s page checked before acting, nothing done (#21, PLAYBOOK F1)', { timeout: 15_000 }, () => {
  it('finds Delete in the post menu, closes it, and clicks nothing in it', async () => {
    renderX();
    expect(await canary('delete')).toEqual({ verdict: 'ok', message: 'a Delete option is where Xomoni expects it' });
    expect(optionClicks).toEqual([]);
    expect(menuOpen()).toBe(false);
  });

  it('closes X’s menu with an Escape from inside it, as X only hears it there (#121)', async () => {
    renderX();
    expect(await canary('delete')).toMatchObject({ verdict: 'ok' });
    // An Escape on the body alone, as before #121, would have left X's menu open.
    expect(bodyEscapes).toBeGreaterThan(0);
    expect(menuOpen()).toBe(false);
  });

  it('reports a changed page when the menu has no Delete option, and closes the menu', async () => {
    renderX({ menu: ['Pin to your profile', 'Remove'] });
    const result = await canary('delete');
    expect(result.verdict).toBe('changed');
    expect(result.message).toMatch(/Delete/);
    expect(optionClicks).toEqual([]);
    expect(menuOpen()).toBe(false);
  });

  it('reports a changed page when the "…" button is gone', async () => {
    renderX({ menu: null });
    expect(await canary('delete')).toMatchObject({ verdict: 'changed' });
  });

  it('reports a changed page when Escape no longer closes the menu', async () => {
    renderX({ escapeCloses: false });
    const result = await canary('delete');
    expect(result.verdict).toBe('changed');
    // Where the menu sat, for the log: never its text.
    expect(result.message).toBe(
      'Escape no longer closes X’s menu (focus: div role=menu (in the menu), menu in #layers, no mask)',
    );
    expect(optionClicks).toEqual([]);
  });

  it('a Delete that opens no confirmation fails, saying what was open instead (#121)', async () => {
    document.cookie = 'twid=u%3D1';
    renderX();
    // The simulated Delete option records the click and opens nothing, as an ignored click would.
    const result = (await runCommand({ cmd: 'delete', id: '1' })) as { outcome: string; message: string };
    expect(result.outcome).toBe('failed');
    expect(result.message).toBe(
      'Delete confirmation did not appear for this post (menus open: 1, pop-ups: none, buttons: none)',
    );
    expect(optionClicks).toEqual(['Delete']);
    expect(menuOpen()).toBe(false);
    document.cookie = 'twid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('cannot tell from a post that is not on the page', async () => {
    renderX();
    expect(await canary('delete', '999')).toMatchObject({ verdict: 'unknown' });
  });

  it('finds the unlike button, or the like button for a ghost like', async () => {
    renderX({ liked: true });
    expect(await canary('unlike')).toMatchObject({ verdict: 'ok' });
    renderX({ liked: false });
    expect(await canary('unlike')).toMatchObject({ verdict: 'unknown' });
    expect(await canary('relike')).toMatchObject({ verdict: 'ok' });
    renderX({ liked: null });
    expect(await canary('unlike')).toMatchObject({ verdict: 'changed' });
  });

  it('finds Undo repost in the repost menu without clicking it', async () => {
    renderX({ reposted: true });
    expect(await canary('unretweet')).toMatchObject({ verdict: 'ok' });
    expect(optionClicks).toEqual([]);
    expect(menuOpen()).toBe(false);
    renderX({ reposted: null });
    expect(await canary('unretweet')).toMatchObject({ verdict: 'changed' });
  });
});

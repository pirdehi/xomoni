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
/** Whether Escape closes an open menu on the simulated page. */
let escapeWorks = true;

// One listener for the whole file: `body` outlives each rendered page.
document.body.addEventListener('keydown', (event) => {
  if (escapeWorks && event.key === 'Escape') document.querySelectorAll('[role="menu"]').forEach((m) => m.remove());
});

/** Renders a simulated x.com timeline with one of the person's posts (id 1) and X's menu behavior. */
function renderX({
  menu = ['Pin to your profile', 'Delete'],
  escapeCloses = true,
  liked = true,
  reposted = true,
}: Page = {}) {
  optionClicks = [];
  escapeWorks = escapeCloses;
  const button = (testid: string) => `<button data-testid="${testid}"></button>`;
  document.body.innerHTML = `
    <article data-testid="tweet">
      <a href="/me/status/1"><time datetime="2024-01-01T00:00:00.000Z"></time></a>
      ${menu ? button('caret') : ''}
      ${liked == null ? '' : button(liked ? 'unlike' : 'like')}
      ${reposted == null ? '' : button(reposted ? 'unretweet' : 'retweet')}
    </article>`;

  const openMenu = (items: string) => {
    const el = document.createElement('div');
    el.setAttribute('role', 'menu');
    el.innerHTML = items;
    el.querySelectorAll('[role="menuitem"]').forEach((item) =>
      item.addEventListener('click', () => optionClicks.push(item.textContent ?? '')),
    );
    document.body.append(el);
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
  escapeWorks = true;
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

  it('reports a changed page when the menu has no Delete option, and closes the menu', async () => {
    renderX({ menu: ['Pin to your profile', 'Remove'] });
    expect(await canary('delete')).toMatchObject({ verdict: 'changed', message: expect.stringMatching(/Delete/) });
    expect(optionClicks).toEqual([]);
    expect(menuOpen()).toBe(false);
  });

  it('reports a changed page when the "…" button is gone', async () => {
    renderX({ menu: null });
    expect(await canary('delete')).toMatchObject({ verdict: 'changed' });
  });

  it('reports a changed page when Escape no longer closes the menu', async () => {
    renderX({ escapeCloses: false });
    expect(await canary('delete')).toMatchObject({ verdict: 'changed', message: expect.stringMatching(/Escape/) });
    expect(optionClicks).toEqual([]);
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

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/content/actor';
import { handleCapture } from '../src/content/net';
import type { CanaryResult } from '../src/shared/messages';

interface Page {
  /** Labels of the post menu the "…" button opens; `null` removes the "…" button. */
  menu?: string[] | null;
  /** Whether Escape closes an open menu, as on X. */
  escapeCloses?: boolean;
  liked?: boolean | null;
  reposted?: boolean | null;
  /** Whether X's Delete and Undo repost options and the confirm button act on a click. */
  answers?: boolean;
  /**
   * When X builds an open menu's items again (ms after opening; null: never). X's Dropdown does this once it has
   * positioned the menu, so an item found right after opening is soon off the page (#121).
   */
  rebuildAfterMs?: number | null;
  /** Who X shows as the post's author (#144). */
  author?: string;
  /** The handle in the sidebar's Profile link; null: X hasn't rendered it. */
  profile?: string | null;
}

/** Every click on a menu option, which a canary must never make. */
let optionClicks: string[] = [];
/** Escapes that reached `document.body`, where X's React handlers never hear them (#121). */
let bodyEscapes = 0;

// One listener for the whole file: `body` outlives each rendered page. It only counts: on X nothing there closes menus.
document.body.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') bodyEscapes++;
});

/**
 * Renders a simulated x.com timeline with one of the person's posts (id 1) and X's menu behavior. Like React, the
 * menus' handlers sit on one container (`#layers`), so a click on an element that has left the page reaches none.
 */
function renderX({
  menu = ['Pin to your profile', 'Delete'],
  escapeCloses = true,
  liked = true,
  reposted = true,
  answers = true,
  rebuildAfterMs = 20,
  author = 'me',
  profile = null,
}: Page = {}) {
  optionClicks = [];
  bodyEscapes = 0;
  const button = (testid: string) => `<button data-testid="${testid}"></button>`;
  document.body.innerHTML = `
    ${profile == null ? '' : `<a data-testid="AppTabBar_Profile_Link" href="/${profile}">Profile</a>`}
    <article data-testid="tweet">
      <a href="/${author}/status/1"><time datetime="2024-01-01T00:00:00.000Z"></time></a>
      ${menu ? button('caret') : ''}
      ${liked == null ? '' : button(liked ? 'unlike' : 'like')}
      ${reposted == null ? '' : button(reposted ? 'unretweet' : 'retweet')}
    </article>
    <div id="layers"></div>`;
  const layers = document.getElementById('layers')!;

  // X's answer to a mutation, as the interceptor passes it on.
  const answer = (op: string, variables: Record<string, string>, data: object) =>
    handleCapture({
      op,
      url: `https://x.com/i/api/graphql/q/${op}`,
      status: 200,
      reqBody: JSON.stringify({ variables }),
      headers: {},
      body: JSON.stringify({ data }),
    });

  // The menu opens in #layers and takes focus; X builds its items again once it has positioned it.
  const openMenu = (items: string) => {
    const el = document.createElement('div');
    el.setAttribute('role', 'menu');
    el.tabIndex = -1;
    el.innerHTML = items;
    layers.append(el);
    el.focus();
    if (rebuildAfterMs != null) setTimeout(() => el.isConnected && (el.innerHTML = items), rebuildAfterMs);
  };
  // X's "Delete post?" sheet, which replaces the menu.
  const openSheet = () => {
    layers.querySelector('[role="menu"]')?.remove();
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'alertdialog');
    sheet.innerHTML = '<button data-testid="confirmationSheetConfirm"><span>Delete</span></button>';
    layers.append(sheet);
  };

  layers.addEventListener('click', (event) => {
    const target = event.target as Element;
    const item = target.closest('[role="menuitem"]');
    if (item) {
      optionClicks.push(item.textContent);
      if (!answers) return;
      if (item.textContent === 'Delete') openSheet();
      if (item.getAttribute('data-testid') === 'unretweetConfirm') {
        layers.querySelector('[role="menu"]')?.remove();
        answer('DeleteRetweet', { source_tweet_id: '1' }, { unretweet: { source_tweet_results: {} } });
      }
    } else if (answers && target.closest('[data-testid="confirmationSheetConfirm"]')) {
      layers.querySelector('[role="alertdialog"]')?.remove();
      answer('DeleteTweet', { tweet_id: '1' }, { delete_tweet: { tweet_results: {} } });
    }
  });
  layers.addEventListener('keydown', (event) => {
    // Older handlers, like some of X's, check the legacy key code.
    if (escapeCloses && event.key === 'Escape' && Reflect.get(event, 'keyCode') === 27)
      layers.querySelector('[role="menu"]')?.remove();
  });
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
  runCommand({ cmd: 'canary', action, id, handle: 'me' }) as Promise<CanaryResult>;
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

  it('deletes, clicking the Delete option X shows at that moment, not the one it replaced (#121)', async () => {
    document.cookie = 'twid=u%3D1';
    // X builds the menu's items again 20 ms after opening it, before Xomoni clicks.
    renderX();
    expect(await runCommand({ cmd: 'delete', id: '1', handle: 'me' })).toEqual({ outcome: 'done', http: 200 });
    expect(optionClicks).toEqual(['Delete']);
    document.cookie = 'twid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('deletes when X builds the menu again only after the click, or never', async () => {
    document.cookie = 'twid=u%3D1';
    for (const rebuildAfterMs of [1_000, null]) {
      renderX({ rebuildAfterMs });
      expect(await runCommand({ cmd: 'delete', id: '1', handle: 'me' })).toEqual({ outcome: 'done', http: 200 });
    }
    document.cookie = 'twid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('undoes a repost, clicking the Undo repost option X shows at that moment (#121)', async () => {
    document.cookie = 'twid=u%3D1';
    renderX();
    expect(await runCommand({ cmd: 'unretweet', id: '1' })).toEqual({ outcome: 'done', http: 200 });
    expect(optionClicks).toEqual(['Undo repost']);
    document.cookie = 'twid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('a Delete that opens no confirmation fails, saying what was open instead (#121)', async () => {
    document.cookie = 'twid=u%3D1';
    renderX({ answers: false });
    const result = (await runCommand({ cmd: 'delete', id: '1', handle: 'me' })) as { outcome: string; message: string };
    expect(result.outcome).toBe('failed');
    expect(result.message).toBe(
      'Delete confirmation did not appear for this post (menus open: 1, pop-ups: none, buttons: none)',
    );
    // One click, on the Delete option only, and the menu closed again.
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

describe('only the person’s own posts (#144)', { timeout: 15_000 }, () => {
  const signedIn = () => (document.cookie = 'twid=u%3D1');
  const signedOut = () => (document.cookie = 'twid=; expires=Thu, 01 Jan 1970 00:00:00 GMT');
  const deleteAs = (handle: string, id = '1') => runCommand({ cmd: 'delete', id, handle });

  it('leaves someone else’s post alone, without even opening its menu', async () => {
    signedIn();
    renderX({ author: 'someone', menu: ['Block @someone', 'Report post'] });
    expect(await deleteAs('me')).toEqual({ outcome: 'skipped', message: 'not your post: X shows it by @someone' });
    expect(menuOpen()).toBe(false);
    expect(optionClicks).toEqual([]);
    signedOut();
  });

  it('matches the handle whatever its case, as X does', async () => {
    signedIn();
    renderX({ author: 'Me' });
    expect(await deleteAs('me')).toEqual({ outcome: 'done', http: 200 });
    signedOut();
  });

  it('falls back to the page’s own profile link, and with neither deletes nothing', async () => {
    signedIn();
    renderX({ profile: 'me' });
    expect(await deleteAs('')).toEqual({ outcome: 'done', http: 200 });
    renderX({ profile: null });
    expect(await deleteAs('')).toEqual({ outcome: 'skipped', message: 'could not confirm that the post is yours' });
    expect(optionClicks).toEqual([]);
    signedOut();
  });

  it('refuses every write for an id that isn’t an X id, before looking at the page', async () => {
    signedIn();
    renderX();
    for (const command of [
      { cmd: 'delete', id: '1/../../settings', handle: 'me' },
      { cmd: 'delete', id: '', handle: 'me' },
      { cmd: 'unretweet', id: '' },
      { cmd: 'unlike', id: 'abc' },
      { cmd: 'relikeUnlike', id: '1'.repeat(21) },
    ] as const) {
      expect(await runCommand(command)).toMatchObject({
        outcome: 'skipped',
        message: expect.stringMatching(/is not an X post id$/),
      });
    }
    expect(optionClicks).toEqual([]);
    expect(menuOpen()).toBe(false);
    signedOut();
  });

  it('never undoes a repost by guessing which post is meant', async () => {
    signedIn();
    renderX({ reposted: true });
    expect(await runCommand({ cmd: 'unretweet', id: '' })).toMatchObject({ outcome: 'skipped' });
    expect(optionClicks).toEqual([]);
    signedOut();
  });

  it('checks before deleting only on the person’s own post', async () => {
    renderX({ author: 'someone' });
    expect(await canary('delete')).toEqual({ verdict: 'unknown', message: 'not your post: X shows it by @someone' });
    expect(menuOpen()).toBe(false);
    // Unlike and undo repost act on other people's posts by nature.
    expect(await canary('unlike')).toMatchObject({ verdict: 'ok' });
    expect(await canary('delete', 'x1')).toMatchObject({ verdict: 'unknown', message: 'the post is not on the page' });
  });
});

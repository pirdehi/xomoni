// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  articleInfo,
  closeMenus,
  describeDialog,
  findArticle,
  findDeleteMenuItem,
  noticeText,
  openDialog,
  viewerHandle,
  viewerIdFromCookie,
  waitFor,
} from '../src/content/dom';

/** A timeline post as X renders it: the timestamp link carries the handle and id. */
const post = (handle: string, id: string, datetime = '2019-05-01T10:00:00.000Z') =>
  `<article data-testid="tweet"><a href="/${handle}/status/${id}"><time datetime="${datetime}"></time></a></article>`;

afterEach(() => {
  document.body.innerHTML = '';
  document.cookie = 'twid=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  vi.useRealTimers();
});

describe('reading posts from X’s page', () => {
  it('reads the id, handle and time from the timestamp link, not from a quoted post', () => {
    document.body.innerHTML = `<article data-testid="tweet">
      <div><time datetime="2010-01-01T00:00:00Z"></time></div>
      <a href="/me/status/123"><time datetime="2019-05-01T10:00:00.000Z"></time></a>
    </article>`;
    expect(articleInfo(document.querySelector('article')!)).toEqual({
      handle: 'me',
      id: '123',
      time: Date.UTC(2019, 4, 1, 10),
    });
  });

  it('returns null for an article without a status link, and null time for a bad date', () => {
    document.body.innerHTML = `<article data-testid="tweet"><a href="/me"><time></time></a></article>`;
    expect(articleInfo(document.querySelector('article')!)).toBeNull();
    document.body.innerHTML = post('me', '9', 'not a date');
    expect(articleInfo(document.querySelector('article')!)).toMatchObject({ id: '9', time: null });
  });

  it('finds the article of one post among several, or null when X has unloaded it', () => {
    document.body.innerHTML = post('me', '1') + post('me', '2');
    expect(findArticle('2')).toBe(document.querySelectorAll('article')[1]);
    expect(findArticle('3')).toBeNull();
  });
});

describe('the Delete item of a post menu (PLAYBOOK F2)', () => {
  const menu = (items: string) => {
    document.body.innerHTML = `<div role="menu">${items}</div>`;
  };

  it('matches the label in English and in other languages', () => {
    menu('<div role="menuitem">Pin to your profile</div><div role="menuitem"> Delete </div>');
    expect(findDeleteMenuItem()?.textContent).toContain('Delete');
    menu('<div role="menuitem">سنجاق</div><div role="menuitem">حذف</div>');
    expect(findDeleteMenuItem()?.textContent).toBe('حذف');
  });

  it('falls back to X’s red for a language it does not know, and finds nothing otherwise', () => {
    menu(
      '<div role="menuitem"><span>Pin</span></div><div role="menuitem"><span style="color: rgb(244, 33, 46)">Xóa bỏ</span></div>',
    );
    expect(findDeleteMenuItem()?.textContent).toBe('Xóa bỏ');
    menu('<div role="menuitem">Pin to your profile</div>');
    expect(findDeleteMenuItem()).toBeNull();
  });
});

describe('menus, pop-ups and notices', () => {
  it('closes menus by clicking the mask, then pressing Escape', () => {
    document.body.innerHTML = '<div data-testid="mask"></div>';
    const maskClick = vi.fn();
    const escape = vi.fn<(key: string) => void>();
    document.querySelector('[data-testid="mask"]')!.addEventListener('click', maskClick);
    document.body.addEventListener('keydown', (e) => escape(e.key));
    closeMenus();
    expect(maskClick).toHaveBeenCalledOnce();
    expect(escape).toHaveBeenCalledWith('Escape');
  });

  it('finds a pop-up in X’s layers but not a menu, and describes it by label or first line', () => {
    document.body.innerHTML = '<div id="layers"><div role="menu">menu</div></div>';
    expect(openDialog()).toBeNull();
    document.body.innerHTML = '<div id="layers"><div role="dialog" aria-label="Keep less relevant ads">x</div></div>';
    const labelled = openDialog()!;
    expect(describeDialog(labelled)).toBe('Keep less relevant ads');
    // Without a label, its text, cut at 80 characters for the log.
    document.body.innerHTML = `<div aria-modal="true">Your account is locked ${'x'.repeat(100)}</div>`;
    expect(describeDialog(openDialog()!)).toMatch(/^Your account is locked x+$/);
    expect(describeDialog(openDialog()!)).toHaveLength(80);
    document.body.innerHTML = '<div aria-modal="true"></div>';
    expect(describeDialog(openDialog()!)).toBe('a pop-up');
  });

  it('reads notices from alerts, pop-ups and the top of the main column only', () => {
    document.body.innerHTML = `<div role="alert">Rate limit</div>
      <div id="layers"><div role="dialog">Your account is temporarily limited</div></div>
      <div data-testid="primaryColumn">${'a'.repeat(2000)}SUSPENDED</div>`;
    const text = noticeText();
    expect(text).toContain('Rate limit');
    expect(text).toContain('temporarily limited');
    expect(text).not.toContain('SUSPENDED');
  });
});

describe('who is signed in', () => {
  it('reads the user id from the twid cookie only, and null when logged out', () => {
    expect(viewerIdFromCookie()).toBeNull();
    document.cookie = 'twid=u%3D1234567890';
    expect(viewerIdFromCookie()).toBe('1234567890');
  });

  it('reads the handle from the sidebar Profile link once X renders it', () => {
    expect(viewerHandle()).toBeNull();
    document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/pirdehi">Profile</a>';
    expect(viewerHandle()).toBe('pirdehi');
  });
});

describe('waitFor', () => {
  it('resolves at once when the element is already there', async () => {
    document.body.innerHTML = '<p id="ready"></p>';
    expect(await waitFor(() => document.getElementById('ready'), 1000)).not.toBeNull();
  });

  it('resolves when X adds the element, and null after the timeout', async () => {
    const appears = waitFor(() => document.getElementById('late'), 2000);
    setTimeout(() => document.body.insertAdjacentHTML('beforeend', '<p id="late"></p>'), 10);
    expect(await appears).toBe(document.getElementById('late'));

    vi.useFakeTimers();
    const never = waitFor(() => document.getElementById('never'), 1000);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await never).toBeNull();
  });
});

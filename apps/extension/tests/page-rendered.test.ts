// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/home"}
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/content/actor';
import { pageRendered } from '../src/content/dom';
import type { PageInfo } from '../src/shared/messages';

// Whether X has drawn the page far enough for its notices to be read (#375). X's web app arrives as an empty shell
// and draws the page, its account notices included, with its scripts; the content script answers from the start of
// the load, so a notice read before then is missed.

/** X's page as it arrives: the shell its web app draws into, with the sidebar but no main column yet. */
const SHELL = `
  <div id="react-root">
    <header role="banner"><nav><a data-testid="AppTabBar_Profile_Link" href="/me">Profile</a></nav></header>
    <main role="main"></main>
  </div>
  <div id="layers"></div>`;

const ping = () => runCommand({ cmd: 'ping' }) as Promise<PageInfo>;

/** Draws X's main column into the shell, with `notice` at its top when given. */
function drawColumn(notice?: string) {
  document.querySelector('main')!.innerHTML = `<div data-testid="primaryColumn">${
    notice ? `<div role="alert"><h2>${notice}</h2></div>` : ''
  }<h1>Home</h1><section aria-label="Timeline: Your Home Timeline"></section></div>`;
}

beforeEach(() => {
  document.cookie = 'twid=u%3D1000; path=/';
  document.body.innerHTML = SHELL;
});

afterEach(() => {
  // Back to the document's own readyState.
  Reflect.deleteProperty(document, 'readyState');
});

describe('pageRendered: X’s page is read for notices only once X drew it (#375)', () => {
  it('is false on the shell X’s page arrives as, where no notice shows yet', async () => {
    expect(pageRendered()).toBe(false);
    expect(await ping()).toMatchObject({ rendered: false, restriction: null, loggedIn: true });
  });

  it('is true once X draws the main column, and the notice at its top is read', async () => {
    drawColumn('Your account is temporarily limited');
    expect(await ping()).toMatchObject({ rendered: true, restriction: 'Your account is temporarily limited' });
  });

  it('is true for a main column without a notice, which then shows none', async () => {
    drawColumn();
    expect(await ping()).toMatchObject({ rendered: true, restriction: null });
  });

  it('is true for X’s alert or a pop-up shown without the main column', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div role="alert">Your account is suspended</div>');
    expect(await ping()).toMatchObject({ rendered: true, restriction: 'Your account is suspended' });

    document.body.innerHTML = SHELL;
    document.getElementById('layers')!.innerHTML = '<div role="dialog" aria-modal="true">Sign in to X</div>';
    expect(await ping()).toMatchObject({ rendered: true, obstructed: true });
  });

  it('is false while the document is still being parsed, even with part of the column in it', () => {
    drawColumn();
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
    expect(pageRendered()).toBe(false);
  });

  it('doesn’t take a post with X’s wording for X’s notice once the page is drawn (#146)', async () => {
    drawColumn();
    document.querySelector('section')!.innerHTML =
      '<article data-testid="tweet"><div data-testid="tweetText">Your account is temporarily limited</div></article>';
    expect(await ping()).toMatchObject({ rendered: true, restriction: null });
  });
});

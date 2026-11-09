// @vitest-environment happy-dom
// @vitest-environment-options {"url": "https://x.com/settings/download_your_data"}
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../src/content/actor';
import { ARCHIVE_LABELS } from '../src/content/dom';
import { NEED_TITLE, needMessage, pageNeed } from '../src/shared/attention';
import type { ArchivePressResult, ArchiveState, ClearResult, PageInfo } from '../src/shared/messages';
import { ARCHIVE_PATH } from '../src/shared/x-archive';

// X's archive page as Xomoni expects it (#186): the settings list with its search box, and the section that changes
// with each step. X's markup isn't public; the live check with the maintainer replaces these with recorded markup.
const SETTINGS_LIST = `
  <div data-testid="primaryColumn">
    <input data-testid="SearchBox_Search_Input" role="combobox" placeholder="Search Settings" />
    <a href="/settings/download_your_data">Download an archive of your data</a>
  </div>`;

const SECTIONS = {
  password: `<h2>Verify your password</h2><input type="password" name="current_password" /><button>Confirm</button>`,
  sendCode: `<h2>Verify it’s you</h2><label><input type="radio" name="method" value="email" /> Email</label>
    <div role="button" tabindex="0"><span>Send code</span></div>`,
  code: `<h2>Enter your code</h2><input type="text" name="verification_code" autocomplete="one-time-code" />
    <div role="button"><span>Next</span></div>`,
  request: `<h2>X data</h2><p>Get insights into the information stored for your account.</p>
    <div role="button" tabindex="0" data-press="preparing"><span><span>Request archive</span></span></div>`,
  requestData: `<h2>X data</h2><button data-press="preparing">Request   data</button>`,
  preparing: `<h2>X data</h2><div role="button" aria-disabled="true"><span>Requesting archive</span></div>`,
  ready: `<h2>X data</h2><p>Your archive is ready.</p><div role="button" tabindex="0" data-press="ready"><span>Download archive</span></div>`,
  otherLanguage: `<h2>Datos de X</h2><div role="button" tabindex="0"><span>Solicitar archivo</span></div>`,
  twoRequests: `<div role="button" data-press="preparing"><span>Request archive</span></div>
    <div role="button" data-press="preparing"><span>Request archive</span></div>`,
  requestOff: `<div role="button" aria-disabled="true" data-press="preparing"><span>Request archive</span></div>`,
} as const;

/** Every button pressed on the page, by label. */
let pressed: string[] = [];

/**
 * Renders X's archive page with `section`. A button with `data-press` shows that section once pressed, as X's page
 * changes after *Request archive*.
 */
function renderArchive(section: string, path = ARCHIVE_PATH) {
  pressed = [];
  history.pushState({}, '', path);
  document.body.innerHTML = `<main role="main">${SETTINGS_LIST}<section aria-label="Section details">${section}</section></main><div id="layers"></div>`;
  document.querySelectorAll<HTMLElement>('[data-press]').forEach((button) =>
    button.addEventListener('click', () => {
      pressed.push(button.textContent.trim());
      const next = button.dataset.press as keyof typeof SECTIONS;
      setTimeout(() => {
        document.querySelector('section')!.innerHTML = SECTIONS[next];
      }, 50);
    }),
  );
}

const ping = () => runCommand({ cmd: 'ping' }) as Promise<PageInfo>;
const state = (timeoutMs = 0) => runCommand({ cmd: 'archiveState', timeoutMs }) as Promise<ArchiveState>;
const press = (button: 'request' | 'download') =>
  runCommand({ cmd: 'archivePress', button }) as Promise<ArchivePressResult>;

beforeEach(() => {
  document.cookie = 'twid=u%3D1000; path=/';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('reading X’s archive page (#186)', () => {
  it.each<[keyof typeof SECTIONS, ArchiveState]>([
    ['password', 'identity'],
    ['sendCode', 'identity'],
    ['code', 'identity'],
    ['request', 'request'],
    ['requestData', 'request'],
    ['preparing', 'preparing'],
    ['ready', 'ready'],
    ['otherLanguage', 'unknown'],
  ])('reads the %s step as %s', async (section, expected) => {
    renderArchive(SECTIONS[section]);
    expect(await state()).toBe(expected);
    expect((await ping()).asksIdentity).toBe(expected === 'identity');
  });

  it('reads nothing on any other page, even with the same buttons', async () => {
    renderArchive(SECTIONS.request, '/settings/account');
    expect(await state()).toBe('unknown');
    expect((await ping()).asksIdentity).toBe(false);
  });

  it('waits for X to show the page, up to the time it is given', async () => {
    renderArchive('<p>Loading…</p>');
    setTimeout(() => (document.querySelector('section')!.innerHTML = SECTIONS.ready), 100);
    expect(await state(0)).toBe('unknown');
    expect(await state(3000)).toBe('ready');
  });

  it('treats a password field anywhere as X asking for the password, and never closes it', async () => {
    renderArchive('', '/home');
    document.getElementById('layers')!.innerHTML =
      '<div role="dialog" aria-modal="true" aria-label="Confirm your password"><input type="password" /></div>';
    const info = await ping();
    expect(info).toMatchObject({ asksIdentity: true, obstructed: true });
    expect(pageNeed(info, '1000')).toBe('identity');
    expect((await runCommand({ cmd: 'clearPage' })) as ClearResult).toEqual({
      clear: false,
      what: 'Confirm your password',
    });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('knows only the English labels it presses', () => {
    expect(ARCHIVE_LABELS.request).toContain('request archive');
    expect(ARCHIVE_LABELS.download).toContain('download archive');
  });
});

describe('pressing X’s archive buttons (#186)', () => {
  it('presses Request archive, and reports it once X shows the archive being made', async () => {
    renderArchive(SECTIONS.request);
    expect(await press('request')).toEqual({ outcome: 'done', state: 'preparing', message: '' });
    expect(pressed).toEqual(['Request archive']);
  });

  it('presses Download archive on a ready archive', async () => {
    renderArchive(SECTIONS.ready);
    expect(await press('download')).toMatchObject({ outcome: 'done' });
    expect(pressed).toEqual(['Download archive']);
  });

  it.each<[string, keyof typeof SECTIONS, 'request' | 'download']>([
    ['the page shows another step', 'ready', 'request'],
    ['X asks for the password', 'password', 'request'],
    ['the archive is still being made', 'preparing', 'download'],
    ['two buttons say Request archive', 'twoRequests', 'request'],
    ['the button is turned off', 'requestOff', 'request'],
    ['the page is in another language', 'otherLanguage', 'request'],
  ])('presses nothing when %s', async (_why, section, button) => {
    renderArchive(SECTIONS[section]);
    expect(await press(button)).toMatchObject({ outcome: 'refused' });
    expect(pressed).toEqual([]);
  });

  it('presses nothing when signed out', async () => {
    document.cookie = 'twid=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
    renderArchive(SECTIONS.request);
    expect(await press('request')).toMatchObject({ outcome: 'refused' });
    expect(pressed).toEqual([]);
  });

  it('says so when X asks for the password after Request archive', async () => {
    renderArchive(SECTIONS.request.replace('data-press="preparing"', 'data-press="password"'));
    expect(await press('request')).toMatchObject({ outcome: 'refused', state: 'identity' });
    expect(pressed).toEqual(['Request archive']);
  });

  it('reports a failure when X’s page shows something else after Request archive', async () => {
    renderArchive(SECTIONS.request.replace('data-press="preparing"', 'data-press="otherLanguage"'));
    expect(await press('request')).toMatchObject({ outcome: 'failed', state: 'unknown' });
  });
});

describe('the person confirming it’s them (#186)', () => {
  const page = { loggedIn: true, locked: false, challenge: false, viewerId: '1000' };

  it('comes after login, X’s checks and the account, and before a hidden window or a pop-up', () => {
    expect(pageNeed({ ...page, asksIdentity: true, hidden: true, obstructed: true }, '1000')).toBe('identity');
    expect(pageNeed({ ...page, loggedIn: false, asksIdentity: true }, '1000')).toBe('login');
    expect(pageNeed({ ...page, challenge: true, asksIdentity: true }, '1000')).toBe('verify');
    expect(pageNeed({ ...page, viewerId: '2', asksIdentity: true }, '1000')).toBe('account');
    expect(pageNeed({ ...page, asksIdentity: false }, '1000')).toBeNull();
  });

  it('tells the person to type it on X, where Xomoni never sees it', () => {
    expect(NEED_TITLE.identity).toBe('Type your password on X');
    expect(needMessage('identity', 'me')).toMatch(/on X’s page in the Xomoni window\. Xomoni never sees them\./);
  });
});

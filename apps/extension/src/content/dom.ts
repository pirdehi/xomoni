// Every X DOM dependency lives here, so a UI change on x.com means editing one file.
/**
 * CSS selectors for the parts of X's page that Xomoni reads or clicks. Most rely on X's own
 * `data-testid` attributes, which X can rename at any time (PLAYBOOK F1).
 */
export const SEL = {
  article: 'article[data-testid="tweet"]',
  /** The "…" (More) button on a post, which opens the post menu. */
  caret: '[data-testid="caret"]',
  menu: '[role="menu"]',
  menuItem: '[role="menu"] [role="menuitem"]',
  /** The confirm button of X's "Delete post?" sheet. */
  confirm: '[data-testid="confirmationSheetConfirm"]',
  /** A post's text. */
  tweetText: '[data-testid="tweetText"]',
  /** A post's author line: display name, then @handle. */
  userName: '[data-testid="User-Name"]',
  like: '[data-testid="like"]',
  unlike: '[data-testid="unlike"]',
  retweet: '[data-testid="retweet"]',
  unretweet: '[data-testid="unretweet"]',
  /** The "Undo repost" item in the menu that `unretweet` opens. */
  unretweetConfirm: '[data-testid="unretweetConfirm"]',
  /** X's placeholder for a timeline or search with no results. */
  empty: '[data-testid="emptyState"]',
  /** X's error panel, shown in place of content that failed to load. */
  errorDetail: '[data-testid="error-detail"]',
  /** The sidebar Profile link; its `href` is `/<handle>` of the signed-in user. */
  profileLink: 'a[data-testid="AppTabBar_Profile_Link"]',
  /** The overlay behind an open menu or sheet; clicking it closes them. */
  mask: '[data-testid="mask"]',
  /**
   * A pop-up over the page: X renders its modals and sheets in `#layers`; a modal elsewhere says so with
   * `aria-modal`. Menus (`role="menu"`) are not included.
   */
  dialog: '#layers [role="dialog"], #layers [role="alertdialog"], [aria-modal="true"]',
  /** A pop-up's own close button: the "×" in the header of X's modals, or a button labeled Close. */
  dialogClose: '[data-testid="app-bar-close"], [aria-label="Close"]',
} as const;

/** "Delete" in the post menu, in the languages X ships most. */
const DELETE_LABELS = new Set([
  'delete',
  'حذف',
  'löschen',
  'supprimer',
  'eliminar',
  'elimina',
  'excluir',
  'apagar',
  'sil',
  'удалить',
  'видалити',
  '削除',
  '삭제',
  '删除',
  '刪除',
  'verwijderen',
  'usuń',
  'hapus',
  'हटाएं',
  'हटाएँ',
  'מחק',
  'ลบ',
  'xóa',
]);

/** X's destructive red, used as a fallback when the label is in another language. */
const DANGER_RGB = 'rgb(244, 33, 46)';

/** `querySelector` shorthand: the first match under `root` (the whole document by default), or null. */
export const $ = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
/** `querySelectorAll` shorthand that returns a real array. */
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(sel),
];

/**
 * Resolves after `ms` milliseconds. It uses the tab's own `setTimeout`, which Chrome throttles in
 * hidden tabs, so keep it to short in-page pauses; the engine's pacing timers live elsewhere.
 */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** A uniformly random number between `min` and `max`; callers pass milliseconds to vary click timing. */
export const jitter = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * The post an article renders: the first timestamp link (`<a href=".../status/ID"><time>`).
 * Quoted posts never wrap their timestamp in a link, so they are not picked up.
 */
export function articleInfo(article: Element): { id: string; handle: string; time: number | null } | null {
  for (const time of $$('time', article)) {
    const link = time.parentElement;
    if (link?.tagName !== 'A') continue;
    const [, handle, id] = (link.getAttribute('href') ?? '').match(/^\/([^/]+)\/status\/(\d+)/) ?? [];
    if (!handle || !id) continue;
    const t = Date.parse(time.getAttribute('datetime') ?? '');
    return { handle, id, time: Number.isNaN(t) ? null : t };
  }
  return null;
}

/**
 * The author's display name on a post: the first link in its author line that isn't the @handle (X links both to
 * the profile). Empty when there is none.
 */
export function authorName(article: Element): string {
  const line = $(SEL.userName, article);
  for (const link of line ? $$('a', line) : []) {
    const text = link.textContent.trim();
    if (text && !text.startsWith('@')) return text.slice(0, 100);
  }
  return '';
}

/**
 * The rendered post article for status `id`, or null. X virtualizes its timelines, so a post that
 * has scrolled far out of view is no longer in the DOM.
 */
export function findArticle(id: string): HTMLElement | null {
  return $$(SEL.article).find((a) => articleInfo(a)?.id === id) ?? null;
}

/**
 * The "Delete" item of an open post menu: matched by label in the languages of `DELETE_LABELS`,
 * then by X's red danger color for other languages (PLAYBOOK F2). It searches every open menu,
 * so callers must make sure only the menu they opened is on the page, and that the post is the
 * person's own: on anyone else's post the red item could be Block (#144).
 */
export function findDeleteMenuItem(): HTMLElement | null {
  const items = $$(SEL.menuItem);
  return (
    items.find((el) => DELETE_LABELS.has(el.textContent.trim().toLowerCase())) ??
    items.find((el) => getComputedStyle($('span', el) ?? el).color === DANGER_RGB) ??
    null
  );
}

/**
 * Clicks with `HTMLElement.click()`. The event is synthetic (`isTrusted` is false); Xomoni accepts
 * this instead of faking trusted input (PLAYBOOK B3).
 */
export function click(el: Element) {
  (el as HTMLElement).click();
}

/**
 * Closes open X menus and sheets: clicks the overlay mask if there is one, then presses Escape from inside each
 * open menu or pop-up, and on `document.body` last. X is a React app, and React only hears events that pass
 * through its root or a portal: an Escape sent to `document.body` alone never reaches X's handlers (#121). So
 * each Escape starts at the focused element when it is inside what is open, otherwise at the menu or pop-up
 * itself, and bubbles up through every handler around it. Nothing inside is clicked, and the keys are
 * synthetic like every Xomoni event (PLAYBOOK B3).
 */
export function closeMenus() {
  const focused = document.activeElement;
  const layers = [...$$(SEL.menu), openDialog()].filter((el): el is HTMLElement => el != null);
  const targets = new Set<Element>(layers.map((layer) => (focused && layer.contains(focused) ? focused : layer)));
  targets.add(document.body);
  const mask = $(SEL.mask);
  if (mask) click(mask);
  for (const target of targets) {
    if (!target.isConnected) continue;
    for (const type of ['keydown', 'keyup'] as const) target.dispatchEvent(keyEvent(type, 'Escape', 27));
  }
}

/** A key event that bubbles, with the legacy `keyCode` and `which` that the constructor leaves at 0. */
function keyEvent(type: 'keydown' | 'keyup', key: 'Escape', legacyCode: number): KeyboardEvent {
  const event = new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'keyCode', { get: () => legacyCode });
  Object.defineProperty(event, 'which', { get: () => legacyCode });
  return event;
}

/** Names an element for the activity log by tag, role and test id, never by its text. */
function elementName(el: Element | null): string {
  if (!el) return 'nothing';
  const role = el.getAttribute('role');
  const testid = el.getAttribute('data-testid');
  return [el.tagName.toLowerCase(), role && `role=${role}`, testid && `testid=${testid}`].filter(Boolean).join(' ');
}

/**
 * What is open over X's page, for the activity log when an expected sheet doesn't appear: how many menus, each
 * pop-up and the test ids of the buttons in X's `#layers`. Structure only, never text.
 */
export function describeLayers(): string {
  const menus = $$(SEL.menu).length;
  const dialogs = $$(SEL.dialog).map(elementName);
  const buttons = $$('#layers [data-testid]')
    .filter((el) => el.matches('button, [role="button"]'))
    .map((el) => el.getAttribute('data-testid'));
  return [
    `menus open: ${menus}`,
    `pop-ups: ${dialogs.length ? dialogs.join('; ') : 'none'}`,
    `buttons: ${buttons.length ? buttons.join(', ') : 'none'}`,
  ].join(', ');
}

/**
 * Where an open menu sits, for the activity log when it won't close: what has focus, whether the menu is in
 * X's `#layers` and whether a mask covers the page. Names elements by tag, role and test id, never by text.
 */
export function describeOpenMenu(): string {
  const menu = $(SEL.menu);
  if (!menu) return 'no menu open';
  const focused = document.activeElement;
  return [
    `focus: ${elementName(focused)}${focused && menu.contains(focused) ? ' (in the menu)' : ''}`,
    menu.closest('#layers') ? 'menu in #layers' : 'menu outside #layers',
    $(SEL.mask) ? 'mask shown' : 'no mask',
  ].join(', ');
}

/** Resolves with the first truthy result of `probe`, re-checked on DOM changes. */
export function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const first = probe();
    if (first) {
      resolve(first);
      return;
    }
    let done = false;
    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      observer.disconnect();
      clearTimeout(timer);
      clearInterval(poll);
      resolve(value);
    };
    const check = () => {
      const v = probe();
      if (v) finish(v);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'href'],
    });
    // Mutation callbacks are not throttled in background tabs; the poll is a safety net.
    const poll = setInterval(check, 500);
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * The signed-in user's numeric id from X's `twid` cookie (`u=<id>`), or null when logged out.
 * This is the only cookie Xomoni reads, and it never writes cookies (PLAYBOOK D4, D5).
 */
export function viewerIdFromCookie(): string | null {
  const twid = document.cookie.split('; ').find((c) => c.startsWith('twid='));
  if (!twid) return null;
  return decodeURIComponent(twid.slice(5)).match(/u=(\d+)/)?.[1] ?? null;
}

/**
 * What anyone on X can write: posts (with their quotes and replies), post text, names and bios. X's notices are
 * never inside these (#146).
 */
const USER_CONTENT = `${SEL.article}, [data-testid="tweetText"], [data-testid="UserName"], [data-testid="UserDescription"]`;

/** The rendered text of `el` without the text of what anyone can write inside it. */
function textWithoutUserContent(el: HTMLElement): string {
  let text = el.innerText;
  for (const part of $$(USER_CONTENT, el)) {
    if (part.parentElement?.closest(USER_CONTENT)) continue;
    const written = part.innerText;
    if (written) text = text.replace(written, '');
  }
  return text;
}

/**
 * Text where X puts account notices: alerts, pop-ups and the top of the main column (where the "temporarily
 * limited" banner appears), without posts, names or bios. Anyone could otherwise stop a job by replying with
 * X's wording (#146). Capped so a long page is not scanned.
 */
export function noticeText(): string {
  const alerts = $$('[role="alert"]').map(textWithoutUserContent);
  const dialogs = $$(SEL.dialog).map((el) => textWithoutUserContent(el).slice(0, 1500));
  const column = $('[data-testid="primaryColumn"]');
  return [...alerts, ...dialogs, column ? textWithoutUserContent(column).slice(0, 1500) : ''].join('\n');
}

/** The first pop-up covering X's page (PLAYBOOK F3), or null. Between actions Xomoni has none open itself. */
export function openDialog(): HTMLElement | null {
  return $(SEL.dialog);
}

/** A short description of a pop-up for the activity log: its label, or its first line of text. */
export function describeDialog(dialog: HTMLElement): string {
  const label = dialog.getAttribute('aria-label');
  const firstLine = dialog.innerText.trim().split(/\n+/)[0] ?? '';
  return (label || firstLine || 'a pop-up').slice(0, 80);
}

/** The signed-in user's handle, read from the sidebar Profile link; null until X has rendered that link. */
export function viewerHandle(): string | null {
  return $(SEL.profileLink)?.getAttribute('href')?.replace(/^\//, '') || null;
}

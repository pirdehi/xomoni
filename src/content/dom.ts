// Every X DOM dependency lives here, so a UI change on x.com means editing one file.
export const SEL = {
  article: 'article[data-testid="tweet"]',
  caret: '[data-testid="caret"]',
  menu: '[role="menu"]',
  menuItem: '[role="menu"] [role="menuitem"]',
  confirm: '[data-testid="confirmationSheetConfirm"]',
  like: '[data-testid="like"]',
  unlike: '[data-testid="unlike"]',
  retweet: '[data-testid="retweet"]',
  unretweet: '[data-testid="unretweet"]',
  unretweetConfirm: '[data-testid="unretweetConfirm"]',
  empty: '[data-testid="emptyState"]',
  errorDetail: '[data-testid="error-detail"]',
  profileLink: 'a[data-testid="AppTabBar_Profile_Link"]',
  mask: '[data-testid="mask"]',
} as const;

/** "Delete" in the post menu, in the languages X ships most. */
const DELETE_LABELS = new Set([
  'delete', 'حذف', 'löschen', 'supprimer', 'eliminar', 'elimina', 'excluir', 'apagar', 'sil', 'удалить',
  'видалити', '削除', '삭제', '删除', '刪除', 'verwijderen', 'usuń', 'hapus', 'हटाएं', 'हटाएँ', 'מחק', 'ลบ', 'xóa',
]);

/** X's destructive red, used as a fallback when the label is in another language. */
const DANGER_RGB = 'rgb(244, 33, 46)';

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const jitter = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * The post an article renders: the first timestamp link (`<a href=".../status/ID"><time>`).
 * Quoted posts never wrap their timestamp in a link, so they are not picked up.
 */
export function articleInfo(article: Element): { id: string; handle: string; time: number | null } | null {
  for (const time of $$('time', article)) {
    const link = time.parentElement;
    if (link?.tagName !== 'A') continue;
    const m = (link.getAttribute('href') ?? '').match(/^\/([^/]+)\/status\/(\d+)/);
    if (!m) continue;
    const t = Date.parse(time.getAttribute('datetime') ?? '');
    return { handle: m[1], id: m[2], time: Number.isNaN(t) ? null : t };
  }
  return null;
}

export function findArticle(id: string): HTMLElement | null {
  return $$(SEL.article).find((a) => articleInfo(a)?.id === id) ?? null;
}

export function findDeleteMenuItem(): HTMLElement | null {
  const items = $$(SEL.menuItem);
  return (
    items.find((el) => DELETE_LABELS.has((el.textContent ?? '').trim().toLowerCase())) ??
    items.find((el) => getComputedStyle($('span', el) ?? el).color === DANGER_RGB) ??
    null
  );
}

export function click(el: Element) {
  (el as HTMLElement).click();
}

export function closeMenus() {
  const mask = $(SEL.mask);
  if (mask) click(mask);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
}

/** Resolves with the first truthy result of `probe`, re-checked on DOM changes. */
export function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const first = probe();
    if (first) return resolve(first);
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
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid', 'href'] });
    // Mutation callbacks are not throttled in background tabs; the poll is a safety net.
    const poll = setInterval(check, 500);
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

export function viewerIdFromCookie(): string | null {
  const twid = document.cookie.split('; ').find((c) => c.startsWith('twid='));
  if (!twid) return null;
  return decodeURIComponent(twid.slice(5)).match(/u=(\d+)/)?.[1] ?? null;
}

export function viewerHandle(): string | null {
  return $<HTMLAnchorElement>(SEL.profileLink)?.getAttribute('href')?.replace(/^\//, '') || null;
}

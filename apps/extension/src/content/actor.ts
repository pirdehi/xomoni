// Performs one user-equivalent action at a time on the x.com page: the same
// clicks a person would make. X's own code sends the request (with all of its
// headers); success is only reported once X's response confirms it.
import { isCheckPath, isLoginPath, restrictionNotice } from '../shared/attention';
import { extractErrors } from '../shared/graphql';
import type {
  ActionResult,
  ActorCommand,
  CanaryResult,
  ContentState,
  PageInfo,
  ScrollResult,
  VisibleTweet,
} from '../shared/messages';
import {
  $,
  $$,
  SEL,
  articleInfo,
  click,
  closeMenus,
  findArticle,
  findDeleteMenuItem,
  jitter,
  noticeText,
  sleep,
  viewerHandle,
  viewerIdFromCookie,
  waitFor,
} from './dom';
import { type NetEvent, lastTimelineStatus, resetAtFrom, waitForNet } from './net';

const bootId = Math.random().toString(36).slice(2);

/**
 * Runs one dashboard command on this x.com page and returns its reply; the reply type for each
 * `cmd` is mapped in `engine/worker-tab.ts`. Write commands are refused while the account is
 * locked or logged out, click only X's own buttons, and report `done` only once X's response
 * to that request confirms it.
 */
export async function runCommand(command: ActorCommand): Promise<unknown> {
  switch (command.cmd) {
    case 'ping':
      return pageInfo();
    case 'waitContent':
      return waitContent(command.timeoutMs);
    case 'visible':
      return visibleTweets();
    case 'scroll':
      return scrollMore();
    case 'delete':
      return guarded(() => deletePost(command.id));
    case 'unlike':
      return guarded(() => unlike(command.id));
    case 'relikeUnlike':
      return guarded(() => relikeUnlike(command.id));
    case 'unretweet':
      return guarded(() => unretweet(command.id));
    case 'canary':
      return canary(command.action, command.id);
  }
}

function pageInfo(): PageInfo {
  const path = location.pathname;
  const viewerId = viewerIdFromCookie();
  return {
    bootId,
    url: location.href,
    path,
    viewerId,
    handle: viewerHandle(),
    loggedIn: !!viewerId && !isLoginPath(path),
    locked: path.startsWith('/account/access'),
    challenge: isCheckPath(path),
    restriction: restrictionNotice(noticeText()),
    lang: document.documentElement.lang || '',
    hidden: document.hidden,
  };
}

async function guarded(action: () => Promise<ActionResult>): Promise<ActionResult> {
  const info = pageInfo();
  if (info.locked) return { outcome: 'locked', message: 'X is asking you to unlock the account' };
  if (info.restriction) return { outcome: 'restricted', message: `X shows: ${info.restriction}` };
  if (!info.loggedIn) return { outcome: 'logged_out', message: 'Not logged in to X in the worker window' };
  try {
    return await action();
  } catch (err) {
    closeMenus();
    return { outcome: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
}

async function waitContent(timeoutMs: number): Promise<ContentState> {
  const kind = await waitFor<ContentState['kind']>(() => {
    if ($(SEL.article)) return 'tweets';
    if ($(SEL.empty)) return 'empty';
    if ($(SEL.errorDetail)) return 'error';
    return null;
  }, timeoutMs);
  if (kind === 'tweets') await sleep(400); // let the rest of the first page render
  return { kind: kind ?? 'timeout', count: $$(SEL.article).length, http: lastTimelineStatus() };
}

function visibleTweets(): VisibleTweet[] {
  const out: VisibleTweet[] = [];
  for (const article of $$(SEL.article)) {
    const info = articleInfo(article);
    if (!info) continue;
    out.push({ ...info, liked: !!$(SEL.unlike, article), reposted: !!$(SEL.unretweet, article) });
  }
  return out;
}

async function scrollMore(): Promise<ScrollResult> {
  const ids = () =>
    $$(SEL.article)
      .map((a) => articleInfo(a)?.id)
      .filter(Boolean) as string[];
  const before = new Set(ids());
  const last = $$(SEL.article).at(-1);
  last?.scrollIntoView({ block: 'end' });
  window.scrollBy(0, Math.round(window.innerHeight * 0.75));
  await waitFor(() => ids().some((id) => !before.has(id)), 6000);
  const now = ids();
  const scroller = document.scrollingElement ?? document.documentElement;
  return {
    added: now.filter((id) => !before.has(id)).length,
    total: now.length,
    atEnd: scroller.scrollTop + window.innerHeight >= scroller.scrollHeight - 8,
  };
}

async function noMenuOpen() {
  if (!$(SEL.menu)) return true;
  closeMenus();
  return !!(await waitFor(() => !$(SEL.menu), 2000));
}

async function focus(article: HTMLElement) {
  article.scrollIntoView({ block: 'center' });
  await sleep(jitter(250, 600));
}

async function deletePost(id: string): Promise<ActionResult> {
  const article = findArticle(id);
  if (!article) return { outcome: 'not_found', message: 'Post is not on the page' };
  await focus(article);
  const caret = $(SEL.caret, article);
  if (!caret) return { outcome: 'failed', message: 'Post menu button not found' };
  // The Delete option must come from the menu this click opens, never a leftover one.
  if (!(await noMenuOpen())) return { outcome: 'failed', message: 'Another menu is open on the X page' };
  click(caret);
  const item = await waitFor(() => $$(SEL.menu).length === 1 && findDeleteMenuItem(), 4000);
  if (!item) {
    closeMenus();
    return { outcome: 'failed', message: 'No "Delete" option — not your post, or X changed its menu' };
  }
  await sleep(jitter(150, 400));
  click(item);
  const confirm = await waitFor(() => $(SEL.confirm), 4000);
  if (!confirm || !findArticle(id)) {
    closeMenus();
    return { outcome: 'failed', message: 'Delete confirmation did not appear for this post' };
  }
  const response = waitForNet(['DeleteTweet'], (v) => v.tweet_id === id);
  await sleep(jitter(150, 400));
  click(confirm);
  return classify(await response, 'DeleteTweet');
}

async function unlike(id: string): Promise<ActionResult> {
  const article = findArticle(id);
  if (!article) return { outcome: 'not_found', message: 'Post is not on the page' };
  await focus(article);
  const button = $(SEL.unlike, article);
  if (!button) {
    return $(SEL.like, article)
      ? { outcome: 'already', message: 'X shows this post as not liked (a "ghost" like)' }
      : { outcome: 'failed', message: 'Like button not found' };
  }
  const response = waitForNet(['UnfavoriteTweet'], (v) => v.tweet_id === id);
  click(button);
  return classify(await response, 'UnfavoriteTweet');
}

/** Removes a like X no longer displays: like it again, then unlike it. */
async function relikeUnlike(id: string): Promise<ActionResult> {
  let article = findArticle(id);
  if (!article) return { outcome: 'not_found', message: 'Post is not on the page' };
  await focus(article);
  if (!$(SEL.unlike, article)) {
    const like = $(SEL.like, article);
    if (!like) return { outcome: 'failed', message: 'Like button not found' };
    const liked = waitForNet(['FavoriteTweet'], (v) => v.tweet_id === id);
    click(like);
    const result = classify(await liked, 'FavoriteTweet');
    if (result.outcome !== 'done' && result.outcome !== 'already') return result;
    await sleep(jitter(1500, 3000));
  }
  // Never leave a re-like behind: retry the unlike before giving up.
  for (let attempt = 0; attempt < 3; attempt++) {
    article = findArticle(id);
    if (article && (await waitFor(() => $(SEL.unlike, article!), 5000))) {
      const result = await unlike(id);
      if (result.outcome !== 'failed') return result;
    }
    await sleep(jitter(2000, 4000));
  }
  return {
    outcome: 'failed',
    message: 'Re-liked, but unliking failed — the post is still liked; run the cleanup again',
  };
}

/**
 * Undo a repost of `id` (the original post). With an empty id (archive reposts
 * don't name their original) it acts only if exactly one post on the page is reposted.
 */
async function unretweet(id: string): Promise<ActionResult> {
  const reposted = id ? [] : $$(SEL.article).filter((a) => $(SEL.unretweet, a));
  const article = id ? findArticle(id) : reposted.length === 1 ? reposted[0] : null;
  if (!article) return { outcome: 'not_found', message: 'Post is not on the page' };
  await focus(article);
  const button = $(SEL.unretweet, article);
  if (!button) {
    return $(SEL.retweet, article)
      ? { outcome: 'already', message: 'Not reposted anymore' }
      : { outcome: 'failed', message: 'Repost button not found' };
  }
  const sourceId = id || articleInfo(article)?.id || '';
  click(button);
  const confirm = await waitFor(() => $(SEL.unretweetConfirm), 4000);
  if (!confirm) {
    closeMenus();
    return { outcome: 'failed', message: 'Undo-repost option did not appear' };
  }
  const response = waitForNet(['DeleteRetweet'], (v) => !sourceId || v.source_tweet_id === sourceId);
  await sleep(jitter(150, 400));
  click(confirm);
  return classify(await response, 'DeleteRetweet');
}

const verdict = (v: CanaryResult['verdict'], message: string): CanaryResult => ({ verdict: v, message });

/**
 * Checks, on post `id`, that X's page still has what `action` needs, without acting (PLAYBOOK F1). Delete:
 * the "…" menu opens with a Delete option and closes again with Escape. Undo repost: the repost menu likewise,
 * with its Undo repost option. Unlike: the unlike button (or, for a ghost like, the like button). Nothing
 * inside a menu is ever clicked.
 */
async function canary(action: CanaryAction, id: string): Promise<CanaryResult> {
  const article = id ? findArticle(id) : null;
  if (!article) return verdict('unknown', 'the post is not on the page');
  await focus(article);
  switch (action) {
    case 'delete':
      return menuCheck(
        $(SEL.caret, article),
        () => $$(SEL.menu).length === 1 && findDeleteMenuItem(),
        'the post menu (…)',
        'a Delete option',
      );
    case 'unretweet':
      if (!$(SEL.unretweet, article)) {
        return $(SEL.retweet, article)
          ? verdict('unknown', 'X shows this post as not reposted')
          : verdict('changed', 'the repost button is missing from the post');
      }
      return menuCheck(
        $(SEL.unretweet, article),
        () => $(SEL.unretweetConfirm),
        'the repost menu',
        'an Undo repost option',
      );
    case 'unlike':
    case 'relike':
      if ($(SEL.unlike, article)) return verdict('ok', 'the unlike button is where Xomoni expects it');
      if (!$(SEL.like, article)) return verdict('changed', 'the like button is missing from the post');
      return action === 'relike'
        ? verdict('ok', 'the like button is where Xomoni expects it')
        : verdict('unknown', 'X shows this post as not liked');
  }
}

type CanaryAction = Extract<ActorCommand, { cmd: 'canary' }>['action'];

/** Opens the menu behind `button`, looks for the option `probe` finds, and closes the menu again. */
async function menuCheck(
  button: HTMLElement | null,
  probe: () => Element | false | null,
  menu: string,
  option: string,
): Promise<CanaryResult> {
  if (!button) return verdict('changed', `the button that opens ${menu} is missing`);
  if (!(await noMenuOpen())) return verdict('changed', 'a menu on the X page does not close');
  click(button);
  const found = await waitFor(probe, 4000);
  await sleep(jitter(200, 500));
  const closed = await noMenuOpen();
  if (!found) return verdict('changed', `${menu} opened without ${option}`);
  if (!closed) return verdict('changed', 'Escape no longer closes X’s menu');
  return verdict('ok', `${option} is where Xomoni expects it`);
}

/** Maps X's response to an outcome. Error codes per X's public error catalogue. */
export function classify(ev: NetEvent | null, op: string): ActionResult {
  if (!ev) return { outcome: 'failed', message: `X did not answer ${op} within 15s` };
  const resetAt = resetAtFrom(ev.headers);
  if (ev.status === 429) return { outcome: 'rate_limited', http: 429, resetAt, message: 'Rate limit reached' };
  for (const { code, message } of extractErrors(ev.json)) {
    const base = { http: ev.status, code, message: message || `Error ${code}`, resetAt };
    switch (code) {
      case 88:
        return { ...base, outcome: 'rate_limited' };
      case 185:
      case 344:
        return { ...base, outcome: 'daily_limit' };
      case 226:
        return { ...base, outcome: 'automation_flag' };
      case 64:
        return { ...base, outcome: 'suspended' };
      case 326:
        return { ...base, outcome: 'locked' };
      // Not permitted, write actions refused, credentials not allowed: X is limiting this account.
      case 87:
      case 220:
      case 261:
        return { ...base, outcome: 'restricted' };
      case 32:
      case 89:
      case 215:
      case 353:
        return { ...base, outcome: 'logged_out' };
      case 34:
      case 144:
        return { ...base, outcome: 'not_found' };
      case 139:
      case 327:
        return { ...base, outcome: 'already' };
    }
    // Unknown errors are failures even when a data object came back.
    return { ...base, outcome: ev.status === 403 ? 'restricted' : 'failed' };
  }
  // A write refused with 403 and no known code: treat it as a restriction, never as a retryable failure.
  if (ev.status === 403) return { outcome: 'restricted', http: 403, message: 'X refused the action (HTTP 403)' };
  if (ev.status >= 400 || ev.status === 0)
    return { outcome: 'failed', http: ev.status, message: `X answered HTTP ${ev.status}` };
  return ev.json?.data
    ? { outcome: 'done', http: ev.status }
    : { outcome: 'failed', http: ev.status, message: 'Unexpected response' };
}

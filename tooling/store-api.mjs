// Sends a GitHub release's zip to the browser stores (docs/RELEASING.md#stores, #303), with the Chrome Web Store
// API v2 and the Microsoft Edge Add-ons API v1.1. Kept apart from the command line in tooling/store.mjs, which
// .github/workflows/store.yml runs, so tooling/store-api.test.mjs can test it. Node built-ins only: every request
// goes through the `fetch` passed in. No message ever carries a credential, only a variable's name or what the
// store answered.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { versionOfTag } from './release-lib.mjs';

/** Google's token endpoint, where the Chrome Web Store refresh token buys a one-hour access token. */
export const CHROME_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** The Chrome Web Store API v2 (v1.1 stopped being supported on 2026-10-15). */
export const CHROME_API = 'https://chromewebstore.googleapis.com';
/** The Microsoft Edge Add-ons API; v1.1 is its `v1` paths with an API key and client id in the headers. */
export const EDGE_API = 'https://api.addons.microsoftedge.microsoft.com';

/**
 * The secrets each store reads from the environment, set only on the `stores` environment in GitHub. The workflow
 * test checks that `store.yml` passes exactly these from `secrets`, and the store test that RELEASING.md explains
 * where to get each one.
 */
export const STORE_SECRETS = {
  chrome: ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID', 'CWS_ITEM_ID'],
  edge: ['EDGE_CLIENT_ID', 'EDGE_API_KEY', 'EDGE_PRODUCT_ID'],
};

/** A failure the workflow prints as is. Its message never holds a credential. */
export class StoreError extends Error {
  name = 'StoreError';
}

/** The release asset a store gets for `version`: the versioned name, so a run can't pick up another release. */
export const zipName = (version) => `xomoni-extension-${version}.zip`;

const DEFAULTS = {
  fetch: (url, init) => globalThis.fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  log: () => {},
  mask: () => {},
  requestMs: 60_000,
  uploadMs: 300_000,
  pollMs: 5_000,
  waitMs: 600_000,
};
const withDefaults = (deps) => ({ ...DEFAULTS, ...deps });

const USAGE =
  'usage: node tooling/store.mjs upload|publish chrome|edge vX.Y.Z [--dir release] [--percentage 1-100, Chrome publish only]';

/**
 * Reads the command line of tooling/store.mjs: `upload|publish chrome|edge vX.Y.Z [--dir DIR] [--percentage N]`.
 * An empty `--percentage` means none, so the workflow can pass its optional input as is.
 */
export function parseStoreArgs(args) {
  const [action, store, tag, ...rest] = args;
  if (action !== 'upload' && action !== 'publish') throw new StoreError(USAGE);
  if (!Object.hasOwn(STORE_SECRETS, store ?? '')) throw new StoreError(USAGE);
  const version = versionOfTag(tag);
  if (!version) throw new StoreError(`the tag ${tag ?? '(none)'} is not v<major>.<minor>.<patch>`);
  const options = { dir: 'release', percentage: '' };
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : '';
    if (!Object.hasOwn(options, name) || rest[i + 1] === undefined) throw new StoreError(USAGE);
    options[name] = rest[i + 1];
  }
  let percentage = null;
  if (options.percentage !== '') {
    if (!/^(100|[1-9]\d?)$/.test(options.percentage))
      throw new StoreError('the percentage must be a whole number from 1 to 100');
    if (action !== 'publish' || store !== 'chrome')
      throw new StoreError('a percentage is for publishing on the Chrome Web Store only');
    percentage = Number(options.percentage);
  }
  return { action, store, tag, version, dir: options.dir, percentage };
}

/**
 * The secrets `store` needs, read from `env` and trimmed. Throws naming every missing one (never a value), and when
 * an id doesn't have its store's shape.
 */
export function storeCredentials(store, env) {
  const names = STORE_SECRETS[store];
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length)
    throw new StoreError(
      `not set: ${missing.join(', ')}. Add them as secrets of the "stores" environment (docs/RELEASING.md#stores).`,
    );
  const value = (name) => env[name].trim();
  if (store === 'chrome') {
    if (!/^[a-p]{32}$/.test(value('CWS_ITEM_ID')))
      throw new StoreError('CWS_ITEM_ID is not a Chrome extension id (32 letters from a to p)');
    if (!/^[\w.-]+$/.test(value('CWS_PUBLISHER_ID')))
      throw new StoreError('CWS_PUBLISHER_ID has characters a publisher id never has');
    return {
      clientId: value('CWS_CLIENT_ID'),
      clientSecret: value('CWS_CLIENT_SECRET'),
      refreshToken: value('CWS_REFRESH_TOKEN'),
      publisherId: value('CWS_PUBLISHER_ID'),
      itemId: value('CWS_ITEM_ID'),
    };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value('EDGE_PRODUCT_ID')))
    throw new StoreError('EDGE_PRODUCT_ID is not a Partner Center product id (a GUID)');
  return { clientId: value('EDGE_CLIENT_ID'), apiKey: value('EDGE_API_KEY'), productId: value('EDGE_PRODUCT_ID') };
}

/** One line of at most 300 characters, so a store's answer can't start a workflow command or flood the log. */
const clip = (text) => {
  const line = String(text).replace(/\s+/g, ' ').trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
};

/** What a store answered, for a log line: its own message and codes when it gives them, else the body's start. */
function said(res) {
  const body = res.json;
  const parts = res.ok ? [] : [`HTTP ${res.status}`];
  const message =
    body?.error?.message ??
    body?.error_description ??
    (typeof body?.error === 'string' ? body.error : undefined) ??
    body?.message;
  if (message) parts.push(String(message));
  if (body?.errorCode) parts.push(`(${String(body.errorCode)})`);
  if (Array.isArray(body?.errors) && body.errors.length)
    parts.push(body.errors.map((e) => (typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e)))).join('; '));
  if (!message && !body && res.text) parts.push(res.text);
  return clip(parts.join(' ') || 'no details');
}

/** `text` as a sentence: with a full stop, unless it already ends with one. */
const end = (text) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** A hint for an answer that refused the credentials. */
const authHint = (status) =>
  status === 401 || status === 403
    ? ' The store refused the credentials: check the secrets of the "stores" environment (docs/RELEASING.md#stores).'
    : '';

/**
 * Sends one request and reads its answer; a timeout or a network failure becomes a StoreError. The time limit is a
 * timer of its own, not `AbortSignal.timeout()`, whose timer doesn't keep Node running: while a request waits on
 * nothing else, Node 22 would end the run instead of timing it out.
 */
async function call(d, what, url, init, ms = d.requestMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`no answer within ${ms / 1000} s`, 'TimeoutError'));
  }, ms);
  try {
    const response = await d.fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: `said` shows the text.
    }
    return { status: response.status, ok: response.ok, headers: response.headers, text, json };
  } catch (error) {
    if (error instanceof StoreError) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
      throw new StoreError(`${what}: no answer within ${ms / 1000} s`);
    const code = error?.cause?.code ? ` (${String(error.cause.code)})` : '';
    throw new StoreError(`${what}: ${clip(error?.message ?? error)}${code}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks `check` until it returns something other than undefined, waiting `pollMs` between tries, and gives up
 * after `waitMs`: the store may still finish, so the message points to its dashboard.
 */
async function poll(d, what, check) {
  const deadline = d.now() + d.waitMs;
  for (;;) {
    const done = await check();
    if (done !== undefined) return done;
    if (d.now() >= deadline)
      throw new StoreError(
        `${what}: still in progress after ${Math.round(d.waitMs / 60_000)} min. Check the store's dashboard before running it again.`,
      );
    await d.sleep(d.pollMs);
  }
}

/** A store that is busy (rate limit, server error) is asked again while polling; anything else stands. */
const busy = (res) => res.status === 429 || res.status >= 500;

// ── Chrome Web Store API v2 ──────────────────────────────────────────────────────────────────────────────────

const chromeItem = ({ publisherId, itemId }) =>
  `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(itemId)}`;

/**
 * Trades the refresh token for an access token (it lasts an hour). Google answers `invalid_grant` when the refresh
 * token expired or was revoked, for example 7 days after it was made while the OAuth app was still "Testing".
 */
export async function chromeToken({ clientId, clientSecret, refreshToken }, deps = {}) {
  const d = withDefaults(deps);
  const res = await call(d, 'Chrome Web Store sign-in', CHROME_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });
  const token = res.json?.access_token;
  if (res.ok && typeof token === 'string' && token) return token;
  const hint =
    res.json?.error === 'invalid_grant'
      ? ' The refresh token expired or was revoked: make a new one (docs/RELEASING.md#stores).'
      : res.json?.error === 'invalid_client'
        ? ' The client id or secret is wrong.'
        : '';
  throw new StoreError(`Chrome Web Store sign-in refused: ${end(said(res))}${hint}`);
}

/** The item's status (`fetchStatus`), or undefined while the store is busy. */
async function chromeStatus(d, auth) {
  const res = await call(d, 'Chrome Web Store status', `${CHROME_API}/v2/${chromeItem(auth)}:fetchStatus`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (busy(res)) return undefined;
  if (!res.ok) throw new StoreError(`Chrome Web Store status refused: ${end(said(res))}${authHint(res.status)}`);
  return res.json ?? {};
}

/**
 * Uploads `zip` as the item's new package (its draft; nothing goes to review). When the store reads the version
 * at once, it must be `version`; a slow upload is followed with `fetchStatus` until it ends.
 */
export async function chromeUpload({ token, publisherId, itemId, zip, version }, deps = {}) {
  const d = withDefaults(deps);
  const auth = { token, publisherId, itemId };
  const res = await call(
    d,
    'Chrome Web Store upload',
    `${CHROME_API}/upload/v2/${chromeItem(auth)}:upload`,
    { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' }, body: zip },
    d.uploadMs,
  );
  if (!res.ok) throw new StoreError(`Chrome Web Store refused the upload: ${end(said(res))}${authHint(res.status)}`);
  let state = res.json?.uploadState;
  if (state === 'IN_PROGRESS' || state === 'UPLOAD_IN_PROGRESS') {
    d.log('Chrome Web Store: the package is being processed…');
    state = await poll(d, 'Chrome Web Store upload', async () => {
      const upload = (await chromeStatus(d, auth))?.lastAsyncUploadState;
      return upload == null || upload === 'IN_PROGRESS' || upload === 'UPLOAD_IN_PROGRESS' ? undefined : upload;
    });
  }
  if (state !== 'SUCCEEDED')
    throw new StoreError(`Chrome Web Store upload ended as ${String(state ?? 'unknown')}: ${said(res)}`);
  const crxVersion = res.json?.crxVersion ?? null;
  if (crxVersion && crxVersion !== version)
    throw new StoreError(
      `Chrome Web Store read version ${String(crxVersion)} in the zip, not ${version}. Don't publish this draft.`,
    );
  return { version: crxVersion };
}

/**
 * Submits the item's draft for review; it goes live once approved, with the visibility set in the dashboard
 * (unlisted or public). `percentage` (1–100) sets the share of users who get it, which the store allows only for
 * items with more than 10,000 weekly users. Then it reads which version went to review: when it isn't `version`,
 * the submission is cancelled and this throws, so a run for one tag never publishes another.
 */
export async function chromePublish({ token, publisherId, itemId, version, percentage = null }, deps = {}) {
  const d = withDefaults(deps);
  const auth = { token, publisherId, itemId };
  const body = { publishType: 'DEFAULT_PUBLISH', skipReview: false };
  if (percentage != null) body.deployInfos = [{ deployPercentage: percentage }];
  const res = await call(d, 'Chrome Web Store publish', `${CHROME_API}/v2/${chromeItem(auth)}:publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new StoreError(`Chrome Web Store refused to publish: ${end(said(res))}${authHint(res.status)}`);
  const state = res.json?.state ?? 'unknown';
  if (state === 'REJECTED' || state === 'CANCELLED')
    throw new StoreError(`Chrome Web Store answered ${state}: see the dashboard`);
  for (const warning of res.json?.warningInfo?.warnings ?? [])
    d.log(`Chrome Web Store warning: ${clip(`${warning.reason ?? ''} ${warning.description ?? ''}`)}`);

  const status = await chromeStatus(d, auth);
  const submitted = (status?.submittedItemRevisionStatus?.distributionChannels ?? [])
    .map((channel) => channel.crxVersion)
    .filter(Boolean);
  if (!submitted.length) {
    d.log('Chrome Web Store: could not read the submitted version; check it in the dashboard.');
    return { state, version: null };
  }
  if (submitted.includes(version)) return { state, version };
  const cancel = await call(d, 'Chrome Web Store cancel', `${CHROME_API}/v2/${chromeItem(auth)}:cancelSubmission`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const outcome = cancel.ok
    ? 'so the submission was cancelled'
    : `and cancelling it failed (${said(cancel)}): cancel it in the dashboard now`;
  throw new StoreError(
    `Chrome Web Store: the draft held ${submitted.join(', ')}, not ${version}, ${outcome}. Upload the right release first.`,
  );
}

// ── Microsoft Edge Add-ons API v1.1 ──────────────────────────────────────────────────────────────────────────

const edgeHeaders = ({ clientId, apiKey }) => ({ Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId });
const edgeProduct = ({ productId }) => `${EDGE_API}/v1/products/${encodeURIComponent(productId)}/submissions`;

/** The operation id in an Edge `Location` header, which holds the id itself or a URL ending with it; null if none. */
export function edgeOperationId(location) {
  const id = (location ?? '').trim().split('?')[0].replace(/\/+$/, '').split('/').pop();
  return id && /^[\w-]+$/.test(id) ? id : null;
}

/** Follows an Edge operation until it ends: resolves to the store's message, or throws with its error code. */
function edgeWait(d, what, url, auth) {
  return poll(d, what, async () => {
    const res = await call(d, `${what} status`, url, { headers: edgeHeaders(auth) });
    if (busy(res)) return undefined;
    if (!res.ok) throw new StoreError(`${what} status refused: ${end(said(res))}${authHint(res.status)}`);
    const status = res.json?.status;
    if (status === 'InProgress') return undefined;
    if (status === 'Succeeded') return clip(res.json.message ?? 'done');
    throw new StoreError(`${what} failed: ${said(res)}`);
  });
}

/** Sends one Edge request that starts an operation (202 with a `Location`), and follows it to its end. */
async function edgeOperation(d, what, url, init, auth, statusUrl, ms) {
  const res = await call(d, what, url, { ...init, headers: { ...edgeHeaders(auth), ...init.headers } }, ms);
  if (!res.ok) throw new StoreError(`${what} refused: ${end(said(res))}${authHint(res.status)}`);
  const operation = edgeOperationId(res.headers.get('location'));
  if (!operation) throw new StoreError(`${what}: the store accepted it but sent no operation to follow`);
  return edgeWait(d, what, `${statusUrl}/${encodeURIComponent(operation)}`, auth);
}

/** Uploads `zip` as the package of the product's draft submission (nothing goes to review), and waits for it. */
export async function edgeUpload({ clientId, apiKey, productId, zip }, deps = {}) {
  const d = withDefaults(deps);
  const auth = { clientId, apiKey, productId };
  const base = edgeProduct(auth);
  const message = await edgeOperation(
    d,
    'Edge Add-ons upload',
    `${base}/draft/package`,
    { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip },
    auth,
    `${base}/draft/package/operations`,
    d.uploadMs,
  );
  return { message };
}

/**
 * Submits the product's draft for certification, with `notes` for the testers; it goes live once approved, with
 * the visibility set in Partner Center. Edge's answer doesn't name the version, so RELEASING.md says to look at
 * the draft first.
 */
export async function edgePublish({ clientId, apiKey, productId, notes }, deps = {}) {
  const d = withDefaults(deps);
  const auth = { clientId, apiKey, productId };
  const base = edgeProduct(auth);
  const message = await edgeOperation(
    d,
    'Edge Add-ons publish',
    base,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) },
    auth,
    `${base}/operations`,
  );
  return { message };
}

// ── One run of tooling/store.mjs ─────────────────────────────────────────────────────────────────────────────

/** The zip for `version` in `dir`, read whole (a few megabytes). */
function readZip(dir, version) {
  const path = join(dir, zipName(version));
  if (!existsSync(path)) throw new StoreError(`no ${zipName(version)} in ${dir}: the workflow downloads it first`);
  return readFileSync(path);
}

/**
 * Runs one parsed command (see `parseStoreArgs`) with the store's secrets from `env`: `upload` makes the zip for
 * the tag, found in `dir`, the store's draft; `publish` submits that draft for review. Resolves to a line for the
 * log. Nothing is sent before the secrets and the zip are found, and the Chrome access token goes through
 * `deps.mask` before it is used, so the workflow can hide it.
 */
export async function runStore({ action, store, tag, version, dir, percentage }, env, deps = {}) {
  const d = withDefaults(deps);
  const credentials = storeCredentials(store, env);
  const zip = action === 'upload' ? readZip(dir, version) : null;
  if (store === 'chrome') {
    const token = await chromeToken(credentials, d);
    d.mask(token);
    const item = { token, publisherId: credentials.publisherId, itemId: credentials.itemId };
    if (zip) {
      const result = await chromeUpload({ ...item, zip, version }, d);
      return `Chrome Web Store: ${zipName(version)} is the draft now (version ${result.version ?? 'not reported yet'}). Check it in the dashboard, then run "publish".`;
    }
    const result = await chromePublish({ ...item, version, percentage }, d);
    const share = percentage == null ? '' : `, for ${percentage}% of users`;
    return `Chrome Web Store: ${result.version ?? 'the draft'} went to review (state ${String(result.state)}${share}).`;
  }
  if (zip) {
    const result = await edgeUpload({ ...credentials, zip }, d);
    return `Edge Add-ons: ${zipName(version)} is the draft now (${result.message}). Check it in Partner Center, then run "publish".`;
  }
  const repository = env.GITHUB_REPOSITORY || 'pirdehi/xomoni';
  const notes = `Xomoni ${version}. Release notes: https://github.com/${repository}/releases/tag/${tag}`;
  const result = await edgePublish({ ...credentials, notes }, d);
  return `Edge Add-ons: the draft went to certification (${result.message}).`;
}

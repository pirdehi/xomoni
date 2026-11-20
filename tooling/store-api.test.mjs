// Tests for tooling/store-api.mjs, run by `node --test 'tooling/*.test.mjs'` in `npm run verify`. Every store
// answer comes from a fake fetch, so nothing here reaches a store; the shapes follow the stores' API references.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CHROME_API,
  CHROME_TOKEN_URL,
  EDGE_API,
  STORE_SECRETS,
  StoreError,
  chromePublish,
  chromeToken,
  chromeUpload,
  edgeOperationId,
  edgePublish,
  edgeUpload,
  parseStoreArgs,
  runStore,
  storeCredentials,
  zipName,
} from './store-api.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ITEM = 'abcdefghijklmnopabcdefghijklmnop';
const PRODUCT = 'd34f98f5-f9b7-42b1-bebb-98707202b21d';
const CHROME_ENV = {
  CWS_CLIENT_ID: 'test-client.apps.example',
  CWS_CLIENT_SECRET: 'test-client-secret-value',
  CWS_REFRESH_TOKEN: 'test-refresh-token-value',
  CWS_PUBLISHER_ID: 'test-publisher',
  CWS_ITEM_ID: ITEM,
};
const EDGE_ENV = {
  EDGE_CLIENT_ID: 'test-edge-client',
  EDGE_API_KEY: 'test-edge-api-key-value',
  EDGE_PRODUCT_ID: PRODUCT,
};
const ACCESS = 'test-access-token-value';
const ZIP = Buffer.from('PK fake zip');
const ITEM_PATH = `publishers/test-publisher/items/${ITEM}`;
const EDGE_BASE = `${EDGE_API}/v1/products/${PRODUCT}/submissions`;

/**
 * A fetch that answers each request with the next of `answers` ({ status, json, text, headers }, an Error to throw,
 * or a function of the request), and records every request it was sent.
 */
function fakeFetch(...answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const next = answers.shift();
    assert.ok(next, `unexpected request: ${init.method ?? 'GET'} ${url}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url, init);
    const { status = 200, json, text = '', headers } = next;
    return new Response(json === undefined ? text : JSON.stringify(json), { status, headers });
  };
  return { fetch, calls, left: () => answers.length };
}

/** Test dependencies: the fake fetch and a clock that moves only when the code under test sleeps. */
function deps(fetch, extra = {}) {
  let now = 0;
  const logs = [];
  return {
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    log: (line) => logs.push(line),
    logs,
    pollMs: 5,
    waitMs: 20,
    requestMs: 1_000,
    uploadMs: 1_000,
    ...extra,
  };
}

/** The StoreError `promise` rejects with; fails the test when it resolves or throws anything else. */
async function storeError(promise) {
  await assert.rejects(promise, StoreError);
  return promise.catch((error) => error.message);
}

const chromeAuth = { token: ACCESS, publisherId: 'test-publisher', itemId: ITEM };
const edgeAuth = { clientId: 'test-edge-client', apiKey: 'test-edge-api-key-value', productId: PRODUCT };

describe('command line', () => {
  it('reads an action, a store and a tag, with the options', () => {
    assert.deepEqual(parseStoreArgs(['upload', 'chrome', 'v0.5.0']), {
      action: 'upload',
      store: 'chrome',
      tag: 'v0.5.0',
      version: '0.5.0',
      dir: 'release',
      percentage: null,
    });
    assert.equal(parseStoreArgs(['upload', 'edge', 'v1.2.3', '--dir', 'out']).dir, 'out');
    assert.equal(parseStoreArgs(['publish', 'chrome', 'v1.2.3', '--percentage', '25']).percentage, 25);
    assert.equal(parseStoreArgs(['publish', 'chrome', 'v1.2.3', '--percentage', '100']).percentage, 100);
    // The workflow passes its optional input as is: empty means none, for any store and action.
    assert.equal(
      parseStoreArgs(['upload', 'chrome', 'v1.2.3', '--dir', 'release', '--percentage', '']).percentage,
      null,
    );
    assert.equal(parseStoreArgs(['publish', 'edge', 'v1.2.3', '--percentage', '']).percentage, null);
  });

  it('refuses anything else', () => {
    const refused = (args, pattern) =>
      assert.throws(() => parseStoreArgs(args), { name: 'StoreError', message: pattern });
    refused([], /usage/);
    refused(['delete', 'chrome', 'v1.0.0'], /usage/);
    refused(['upload', 'firefox', 'v1.0.0'], /usage/);
    refused(['upload', 'constructor', 'v1.0.0'], /usage/);
    refused(['upload', 'chrome', '1.0.0'], /not v<major>/);
    refused(['upload', 'chrome'], /\(none\) is not v<major>/);
    refused(['upload', 'chrome', 'v1.0.0', '--dir'], /usage/);
    refused(['upload', 'chrome', 'v1.0.0', '--toString', 'x'], /usage/);
    refused(['upload', 'chrome', 'v1.0.0', 'release'], /usage/);
    for (const bad of ['0', '101', '5.5', '-1', '1e2', ' 5', 'all'])
      refused(['publish', 'chrome', 'v1.0.0', '--percentage', bad], /1 to 100/);
    refused(['upload', 'chrome', 'v1.0.0', '--percentage', '50'], /Chrome Web Store only/);
    refused(['publish', 'edge', 'v1.0.0', '--percentage', '50'], /Chrome Web Store only/);
  });
});

describe('store secrets', () => {
  it('reads and trims what each store needs', () => {
    assert.deepEqual(storeCredentials('chrome', { ...CHROME_ENV, CWS_ITEM_ID: ` ${ITEM}\n` }), {
      clientId: CHROME_ENV.CWS_CLIENT_ID,
      clientSecret: CHROME_ENV.CWS_CLIENT_SECRET,
      refreshToken: CHROME_ENV.CWS_REFRESH_TOKEN,
      publisherId: 'test-publisher',
      itemId: ITEM,
    });
    assert.deepEqual(storeCredentials('edge', EDGE_ENV), edgeAuth);
  });

  it('names every missing secret, never a value', () => {
    assert.throws(
      () => storeCredentials('chrome', { CWS_CLIENT_ID: 'x', CWS_CLIENT_SECRET: '  ', CWS_ITEM_ID: ITEM }),
      (error) => {
        assert.ok(error instanceof StoreError);
        assert.match(error.message, /CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID/);
        assert.match(error.message, /"stores" environment/);
        assert.doesNotMatch(error.message, /CWS_CLIENT_ID|CWS_ITEM_ID/);
        return true;
      },
    );
    assert.throws(() => storeCredentials('edge', {}), /EDGE_CLIENT_ID, EDGE_API_KEY, EDGE_PRODUCT_ID/);
  });

  it("refuses ids that don't have the store's shape, without echoing them", () => {
    for (const [env, pattern] of [
      [{ ...CHROME_ENV, CWS_ITEM_ID: 'ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP' }, /CWS_ITEM_ID is not/],
      [{ ...CHROME_ENV, CWS_ITEM_ID: `${ITEM}q` }, /CWS_ITEM_ID is not/],
      [{ ...CHROME_ENV, CWS_PUBLISHER_ID: 'pub/../items' }, /CWS_PUBLISHER_ID has/],
    ])
      assert.throws(
        () => storeCredentials('chrome', env),
        (error) => {
          assert.match(error.message, pattern);
          assert.doesNotMatch(error.message, /ABCDEF|\.\.\//);
          return true;
        },
      );
    assert.throws(() => storeCredentials('edge', { ...EDGE_ENV, EDGE_PRODUCT_ID: ITEM }), /not a Partner Center/);
  });
});

describe('Chrome Web Store sign-in', () => {
  it('trades the refresh token for an access token', async () => {
    const { fetch, calls } = fakeFetch({ json: { access_token: ACCESS, expires_in: 3599, token_type: 'Bearer' } });
    const credentials = storeCredentials('chrome', CHROME_ENV);
    assert.equal(await chromeToken(credentials, deps(fetch)), ACCESS);
    assert.equal(calls[0].url, CHROME_TOKEN_URL);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(calls[0].body)), {
      grant_type: 'refresh_token',
      client_id: CHROME_ENV.CWS_CLIENT_ID,
      client_secret: CHROME_ENV.CWS_CLIENT_SECRET,
      refresh_token: CHROME_ENV.CWS_REFRESH_TOKEN,
    });
  });

  it('says when the refresh token expired or the client is wrong, without the secrets', async () => {
    const credentials = storeCredentials('chrome', CHROME_ENV);
    const expired = fakeFetch({
      status: 400,
      json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
    });
    const message = await storeError(chromeToken(credentials, deps(expired.fetch)));
    assert.match(message, /HTTP 400 Token has been expired or revoked\..*make a new one/);
    for (const secret of Object.values(CHROME_ENV).slice(0, 3)) assert.ok(!message.includes(secret));

    const client = fakeFetch({ status: 401, json: { error: 'invalid_client', error_description: 'Unauthorized' } });
    assert.match(await storeError(chromeToken(credentials, deps(client.fetch))), /client id or secret is wrong/);

    const empty = fakeFetch({ json: { token_type: 'Bearer' } });
    assert.match(await storeError(chromeToken(credentials, deps(empty.fetch))), /sign-in refused/);
  });
});

describe('Chrome Web Store upload (API v2)', () => {
  it('uploads the zip to the item as its draft', async () => {
    const { fetch, calls } = fakeFetch({ json: { itemId: ITEM, crxVersion: '0.5.0', uploadState: 'SUCCEEDED' } });
    assert.deepEqual(await chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(fetch)), {
      version: '0.5.0',
    });
    assert.equal(calls[0].url, `${CHROME_API}/upload/v2/${ITEM_PATH}:upload`);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].headers, { Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/zip' });
    assert.equal(calls[0].body, ZIP);
  });

  it('follows a slow upload with fetchStatus until it ends', async () => {
    const status = (state) => ({ json: { itemId: ITEM, lastAsyncUploadState: state } });
    const { fetch, calls } = fakeFetch(
      { json: { itemId: ITEM, uploadState: 'IN_PROGRESS' } },
      status('IN_PROGRESS'),
      { status: 503, text: 'busy' },
      status('SUCCEEDED'),
    );
    const d = deps(fetch);
    assert.deepEqual(await chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, d), { version: null });
    assert.equal(calls[1].url, `${CHROME_API}/v2/${ITEM_PATH}:fetchStatus`);
    assert.equal(calls[1].method, 'GET');
    assert.match(d.logs[0], /being processed/);
  });

  it('fails when the store refuses or fails the package, or reads another version', async () => {
    const refused = fakeFetch({ status: 400, json: { error: { code: 400, message: 'Invalid manifest.' } } });
    assert.match(
      await storeError(chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(refused.fetch))),
      /refused the upload: HTTP 400 Invalid manifest\./,
    );

    const denied = fakeFetch({ status: 403, json: { error: { message: 'The caller does not have permission' } } });
    assert.match(
      await storeError(chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(denied.fetch))),
      /HTTP 403 .*refused the credentials/,
    );

    const failed = fakeFetch({ json: { itemId: ITEM, uploadState: 'FAILED' } });
    assert.match(
      await storeError(chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(failed.fetch))),
      /ended as FAILED/,
    );

    const later = fakeFetch({ json: { uploadState: 'IN_PROGRESS' } }, { json: { lastAsyncUploadState: 'FAILED' } });
    assert.match(
      await storeError(chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(later.fetch))),
      /ended as FAILED/,
    );

    const other = fakeFetch({ json: { crxVersion: '0.4.0', uploadState: 'SUCCEEDED' } });
    assert.match(
      await storeError(chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(other.fetch))),
      /read version 0\.4\.0 in the zip, not 0\.5\.0/,
    );
  });

  it('gives up waiting after waitMs, pointing to the dashboard', async () => {
    const { fetch, calls } = fakeFetch(
      { json: { uploadState: 'IN_PROGRESS' } },
      ...Array.from({ length: 5 }, () => ({ json: { lastAsyncUploadState: 'IN_PROGRESS' } })),
    );
    assert.match(
      await storeError(chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(fetch))),
      /still in progress after .* dashboard/,
    );
    assert.equal(calls.length, 6, 'asks at 0, 5, 10, 15 and 20 ms, then stops');
  });

  it('turns a store that never answers, or a broken network, into a StoreError', async () => {
    const hang = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    const slow = fakeFetch(hang);
    assert.match(
      await storeError(chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(slow.fetch, { uploadMs: 20 }))),
      /Chrome Web Store upload: no answer within 0\.02 s/,
    );

    const offline = fakeFetch(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    assert.match(
      await storeError(chromeToken(storeCredentials('chrome', CHROME_ENV), deps(offline.fetch))),
      /sign-in: fetch failed \(ENOTFOUND\)/,
    );
  });

  it('leaves no timer behind once a store answers or fails, so a run ends at once', async () => {
    const timers = () => process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout').length;
    const before = timers();
    const { fetch } = fakeFetch(
      { json: { access_token: ACCESS } },
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
    );
    // Short enough that a forgotten timer fails this file within seconds instead of holding it open.
    const d = deps(fetch, { requestMs: 2_000 });
    await chromeToken(storeCredentials('chrome', CHROME_ENV), d);
    await storeError(chromeToken(storeCredentials('chrome', CHROME_ENV), d));
    assert.equal(timers(), before);
  });

  it("keeps a store's answer on one short line, so it can't start a workflow command", async () => {
    const { fetch } = fakeFetch({ status: 500, text: `oops\n::error::injected\n${'x'.repeat(500)}` });
    const message = await storeError(chromeUpload({ ...chromeAuth, zip: ZIP, version: '0.5.0' }, deps(fetch)));
    assert.doesNotMatch(message, /\n/);
    assert.match(message, /HTTP 500 oops ::error::injected x+…/);
    assert.ok(message.length < 450);
  });
});

describe('Chrome Web Store publish (API v2)', () => {
  const submitted = (version) => ({
    json: {
      itemId: ITEM,
      submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: version }] },
    },
  });

  it("submits the draft for review with the dashboard's visibility, and checks its version", async () => {
    const { fetch, calls } = fakeFetch({ json: { itemId: ITEM, state: 'PENDING_REVIEW' } }, submitted('0.5.0'));
    assert.deepEqual(await chromePublish({ ...chromeAuth, version: '0.5.0' }, deps(fetch)), {
      state: 'PENDING_REVIEW',
      version: '0.5.0',
    });
    assert.equal(calls[0].url, `${CHROME_API}/v2/${ITEM_PATH}:publish`);
    assert.equal(calls[0].method, 'POST');
    // No visibility in the request: API v2 can't change it, and the item keeps the dashboard's (unlisted first).
    assert.deepEqual(JSON.parse(calls[0].body), { publishType: 'DEFAULT_PUBLISH', skipReview: false });
    assert.equal(calls[1].url, `${CHROME_API}/v2/${ITEM_PATH}:fetchStatus`);
  });

  it('asks for a staged rollout when given a percentage, and passes on warnings', async () => {
    const { fetch, calls } = fakeFetch(
      {
        json: {
          state: 'PENDING_REVIEW',
          warningInfo: { warnings: [{ reason: 'SOME_WARNING', description: 'Something to look at.' }] },
        },
      },
      submitted('0.5.0'),
    );
    const d = deps(fetch);
    await chromePublish({ ...chromeAuth, version: '0.5.0', percentage: 10 }, d);
    assert.deepEqual(JSON.parse(calls[0].body).deployInfos, [{ deployPercentage: 10 }]);
    assert.deepEqual(d.logs, ['Chrome Web Store warning: SOME_WARNING Something to look at.']);
  });

  it('cancels a submission that holds another version, and fails', async () => {
    const { fetch, calls } = fakeFetch({ json: { state: 'PENDING_REVIEW' } }, submitted('0.4.0'), { json: {} });
    assert.match(
      await storeError(chromePublish({ ...chromeAuth, version: '0.5.0' }, deps(fetch))),
      /held 0\.4\.0, not 0\.5\.0, so the submission was cancelled/,
    );
    assert.equal(calls[2].url, `${CHROME_API}/v2/${ITEM_PATH}:cancelSubmission`);
    assert.equal(calls[2].method, 'POST');

    const stuck = fakeFetch({ json: { state: 'PENDING_REVIEW' } }, submitted('0.4.0'), { status: 500, text: 'down' });
    assert.match(
      await storeError(chromePublish({ ...chromeAuth, version: '0.5.0' }, deps(stuck.fetch))),
      /cancelling it failed \(HTTP 500 down\): cancel it in the dashboard now/,
    );
  });

  it("says so when it can't read the submitted version", async () => {
    const { fetch } = fakeFetch({ json: { state: 'PENDING_REVIEW' } }, { status: 503, text: 'busy' });
    const d = deps(fetch);
    assert.deepEqual(await chromePublish({ ...chromeAuth, version: '0.5.0' }, d), {
      state: 'PENDING_REVIEW',
      version: null,
    });
    assert.match(d.logs[0], /could not read the submitted version/);
  });

  it('fails when the store refuses, and sends nothing more', async () => {
    const { fetch, left } = fakeFetch(
      {
        status: 400,
        json: { error: { message: 'Publish is not allowed: visibility changed in the dashboard.' } },
      },
      submitted('0.5.0'),
    );
    assert.match(
      await storeError(chromePublish({ ...chromeAuth, version: '0.5.0' }, deps(fetch))),
      /refused to publish: HTTP 400 Publish is not allowed/,
    );
    assert.equal(left(), 1);

    const rejected = fakeFetch({ json: { state: 'REJECTED' } });
    assert.match(
      await storeError(chromePublish({ ...chromeAuth, version: '0.5.0' }, deps(rejected.fetch))),
      /answered REJECTED/,
    );
  });
});

describe('Edge Add-ons (API v1.1)', () => {
  const operation = (status, extra = {}) => ({
    json: { id: 'op-1', createdTime: 'now', lastUpdatedTime: 'now', status, ...extra },
  });

  it('reads the operation id from a Location header', () => {
    assert.equal(edgeOperationId('op-1'), 'op-1');
    assert.equal(edgeOperationId(` ${EDGE_BASE}/draft/package/operations/op-2/ `), 'op-2');
    assert.equal(edgeOperationId('/v1/products/p/submissions/operations/op-3?x=1'), 'op-3');
    assert.equal(edgeOperationId(''), null);
    assert.equal(edgeOperationId(null), null);
    assert.equal(edgeOperationId('../../evil%2F'), null);
  });

  it('uploads the zip to the draft with the API key and client id, and waits for it', async () => {
    const { fetch, calls } = fakeFetch(
      { status: 202, headers: { Location: 'op-1' } },
      operation('InProgress'),
      { status: 429, text: 'slow down' },
      operation('Succeeded', { message: 'Successfully updated package to xomoni-extension-0.5.0.zip' }),
    );
    assert.deepEqual(await edgeUpload({ ...edgeAuth, zip: ZIP }, deps(fetch)), {
      message: 'Successfully updated package to xomoni-extension-0.5.0.zip',
    });
    assert.equal(calls[0].url, `${EDGE_BASE}/draft/package`);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].headers, {
      Authorization: 'ApiKey test-edge-api-key-value',
      'X-ClientID': 'test-edge-client',
      'Content-Type': 'application/zip',
    });
    assert.equal(calls[0].body, ZIP);
    assert.equal(calls[1].url, `${EDGE_BASE}/draft/package/operations/op-1`);
    assert.deepEqual(calls[1].headers, {
      Authorization: 'ApiKey test-edge-api-key-value',
      'X-ClientID': 'test-edge-client',
    });
  });

  it('fails with the store’s error code and errors when the upload fails', async () => {
    const { fetch } = fakeFetch(
      { status: 202, headers: { Location: 'op-1' } },
      operation('Failed', { message: 'Invalid package.', errorCode: 'InvalidPackage', errors: ['manifest.json: bad'] }),
    );
    assert.match(
      await storeError(edgeUpload({ ...edgeAuth, zip: ZIP }, deps(fetch))),
      /upload failed: Invalid package\. \(InvalidPackage\) manifest\.json: bad/,
    );
  });

  it('fails when the credentials are refused, or no operation comes back', async () => {
    const denied = fakeFetch({ status: 401, text: '' });
    const message = await storeError(edgeUpload({ ...edgeAuth, zip: ZIP }, deps(denied.fetch)));
    assert.match(message, /upload refused: HTTP 401\. The store refused the credentials/);
    assert.ok(!message.includes(edgeAuth.apiKey));

    const lost = fakeFetch({ status: 202 });
    assert.match(await storeError(edgeUpload({ ...edgeAuth, zip: ZIP }, deps(lost.fetch))), /no operation to follow/);

    const gone = fakeFetch(
      { status: 202, headers: { Location: 'op-1' } },
      { status: 404, json: { message: 'Not found' } },
    );
    assert.match(await storeError(edgeUpload({ ...edgeAuth, zip: ZIP }, deps(gone.fetch))), /status refused: HTTP 404/);
  });

  it('gives up waiting after waitMs', async () => {
    const { fetch } = fakeFetch(
      { status: 202, headers: { Location: 'op-1' } },
      ...Array.from({ length: 5 }, () => operation('InProgress')),
    );
    assert.match(await storeError(edgeUpload({ ...edgeAuth, zip: ZIP }, deps(fetch))), /still in progress/);
  });

  it('submits the draft with notes for the testers, and waits for it', async () => {
    const { fetch, calls } = fakeFetch(
      { status: 202, headers: { Location: 'op-9' } },
      operation('Succeeded', { message: 'Successfully created submission with ID 123' }),
    );
    assert.deepEqual(await edgePublish({ ...edgeAuth, notes: 'Xomoni 0.5.0' }, deps(fetch)), {
      message: 'Successfully created submission with ID 123',
    });
    assert.equal(calls[0].url, EDGE_BASE);
    assert.deepEqual(JSON.parse(calls[0].body), { notes: 'Xomoni 0.5.0' });
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
    assert.equal(calls[1].url, `${EDGE_BASE}/operations/op-9`);
  });

  it('fails when there is nothing new to publish, or a submission is under review', async () => {
    for (const errorCode of ['NoModulesUpdated', 'InProgressSubmission']) {
      const { fetch } = fakeFetch(
        { status: 202, headers: { Location: 'op-9' } },
        operation('Failed', { message: "Can't publish extension.", errorCode }),
      );
      assert.match(
        await storeError(edgePublish({ ...edgeAuth, notes: '' }, deps(fetch))),
        new RegExp(`publish failed: Can't publish extension\\. \\(${errorCode}\\)`),
      );
    }
  });
});

describe('one run (tooling/store.mjs)', () => {
  const withZip = (version, test) => async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xomoni-store-'));
    try {
      writeFileSync(join(dir, zipName(version)), ZIP);
      await test(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it(
    'uploads the tag’s zip to Chrome, hiding the access token first',
    withZip('0.5.0', async (dir) => {
      const { fetch, calls } = fakeFetch(
        { json: { access_token: ACCESS } },
        { json: { crxVersion: '0.5.0', uploadState: 'SUCCEEDED' } },
      );
      const masked = [];
      const command = parseStoreArgs(['upload', 'chrome', 'v0.5.0', '--dir', dir]);
      const line = await runStore(command, CHROME_ENV, deps(fetch, { mask: (value) => masked.push(value) }));
      assert.deepEqual(masked, [ACCESS]);
      assert.match(line, /xomoni-extension-0\.5\.0\.zip is the draft now \(version 0\.5\.0\).*"publish"/);
      assert.deepEqual(calls[1].body, ZIP);
    }),
  );

  it(
    'uploads the tag’s zip to Edge',
    withZip('0.5.0', async (dir) => {
      const { fetch, calls } = fakeFetch(
        { status: 202, headers: { Location: 'op-1' } },
        { json: { status: 'Succeeded', message: 'Successfully updated package' } },
      );
      const line = await runStore(parseStoreArgs(['upload', 'edge', 'v0.5.0', '--dir', dir]), EDGE_ENV, deps(fetch));
      assert.match(line, /Edge Add-ons: xomoni-extension-0\.5\.0\.zip is the draft now/);
      assert.deepEqual(calls[0].body, ZIP);
    }),
  );

  it(
    'never sends another release’s zip',
    withZip('0.4.0', async (dir) => {
      const { fetch, calls } = fakeFetch();
      const command = parseStoreArgs(['upload', 'chrome', 'v0.5.0', '--dir', dir]);
      assert.match(await storeError(runStore(command, CHROME_ENV, deps(fetch))), /no xomoni-extension-0\.5\.0\.zip/);
      assert.equal(calls.length, 0, 'not even the sign-in');
    }),
  );

  it('publishes on both stores, linking the release notes for Edge testers', async () => {
    const chrome = fakeFetch(
      { json: { access_token: ACCESS } },
      { json: { state: 'PENDING_REVIEW' } },
      { json: { submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: '0.5.0' }] } } },
    );
    const command = parseStoreArgs(['publish', 'chrome', 'v0.5.0', '--percentage', '20']);
    assert.match(
      await runStore(command, CHROME_ENV, deps(chrome.fetch)),
      /0\.5\.0 went to review \(state PENDING_REVIEW, for 20% of users\)/,
    );

    const edge = fakeFetch(
      { status: 202, headers: { Location: 'op-9' } },
      { json: { status: 'Succeeded', message: 'Successfully created submission' } },
    );
    const env = { ...EDGE_ENV, GITHUB_REPOSITORY: 'someone/xomoni' };
    assert.match(
      await runStore(parseStoreArgs(['publish', 'edge', 'v0.5.0']), env, deps(edge.fetch)),
      /went to certification/,
    );
    assert.deepEqual(JSON.parse(edge.calls[0].body), {
      notes: 'Xomoni 0.5.0. Release notes: https://github.com/someone/xomoni/releases/tag/v0.5.0',
    });
  });

  it('sends nothing without its secrets', async () => {
    const { fetch, calls } = fakeFetch();
    const command = parseStoreArgs(['publish', 'chrome', 'v0.5.0']);
    assert.match(await storeError(runStore(command, EDGE_ENV, deps(fetch))), /not set: CWS_CLIENT_ID/);
    assert.equal(calls.length, 0);
  });
});

describe('no store key in the code (#303)', () => {
  it('keeps every store secret documented for the maintainer', () => {
    const releasing = readFileSync(join(ROOT, 'docs/RELEASING.md'), 'utf8');
    for (const name of Object.values(STORE_SECRETS).flat())
      assert.ok(releasing.includes(`\`${name}\``), `docs/RELEASING.md doesn't explain ${name}`);
  });

  it('has no Google or Microsoft credential in any tracked file', () => {
    // Google OAuth client secrets, refresh and access tokens, and service-account private keys.
    // The key header is put together here, so this file doesn't match it.
    const privateKey = new RegExp(['-----BEGIN', 'PRIVATE KEY-----'].join(' '));
    const shapes = [/GOCSPX-[\w-]{20,}/, /\b1\/\/0[\w-]{30,}/, /\bya29\.[\w-]{30,}/, privateKey];
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0');
    const found = [];
    for (const file of files.filter((name) => name && !/\.(png|jpe?g|gif|webp|ico|woff2?|zip|mp4|webm)$/i.test(name))) {
      let text;
      try {
        text = readFileSync(join(ROOT, file), 'utf8');
      } catch {
        continue; // Deleted in the working tree.
      }
      for (const shape of shapes) if (shape.test(text)) found.push(`${file} (${shape.source.slice(0, 12)}…)`);
    }
    assert.deepEqual(found, []);
  });
});

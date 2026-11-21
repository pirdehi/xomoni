// A stand-in for Xomoni with a fixed id, for xomoni.com's end-to-end tests (#302, e2e/fixed-id.spec.ts). Chrome loads
// it unpacked; the `key` in its manifest gives it the id the site is told to look for (NEXT_PUBLIC_XOMONI_TEST_EXTENSION_ID).
// It answers the site's messages as Xomoni's service worker does (`cloud/website.ts`): a hello, a sign-in that trades
// the one-time code with `pair_device` on the local Supabase stack, and a sign-out that ends the token. The test reads
// what it received through `globalThis.xomoniTest`. Its `config.json` (the stack's address and publishable key) is
// written by the test next to this file.

const runtime = globalThis.chrome.runtime;

/** What the test reads: the state the site sees, and every message received, in order. */
const xomoniTest = {
  state: { connection: null, signedOutAt: null, leftAt: 0 },
  received: [],
};
globalThis.xomoniTest = xomoniTest;

/** Calls one of Xomoni's database functions as the extension does: no session, the publishable key only. */
async function rpc(fn, body) {
  const config = await (await fetch(runtime.getURL('config.json'))).json();
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function answer(message) {
  const { state } = xomoniTest;
  switch (message?.type) {
    case 'xomoni-hello': {
      const { connection } = state;
      return {
        ok: true,
        state: {
          version: '0.5.0',
          connection: connection && {
            deviceId: connection.deviceId,
            account: connection.account,
            connectedAt: connection.connectedAt,
          },
          signedOutAt: state.signedOutAt,
          leftAt: state.leftAt,
        },
      };
    }
    case 'xomoni-sign-in': {
      if (state.connection && state.connection.deviceId !== message.replace)
        return { ok: false, reason: 'already_connected' };
      const paired = await rpc('pair_device', { code: message.code, name: 'Chrome on macOS', version: '0.5.0' });
      if (paired.status !== 200) return { ok: false, reason: 'bad_code' };
      const [{ device_id: deviceId, token, account }] = paired.json;
      state.connection = { deviceId, token, account, connectedAt: Date.now() };
      state.signedOutAt = null;
      await rpc('device_report', { token, version: '0.5.0', jobs: [] });
      return { ok: true, account, deviceId };
    }
    case 'xomoni-sign-out': {
      if (!state.connection) return { ok: true, signedOut: false };
      await rpc('unpair_device', { token: state.connection.token });
      state.connection = null;
      state.signedOutAt = Date.now();
      state.leftAt = state.signedOutAt;
      return { ok: true, signedOut: true };
    }
    default:
      return { ok: false, reason: 'invalid' };
  }
}

runtime.onMessageExternal.addListener((message, sender, reply) => {
  // Like Xomoni, it hears only the site's own top frame (here the local site, on any port).
  if (!sender.origin?.startsWith('http://localhost:') || sender.frameId !== 0) return false;
  xomoniTest.received.push(message);
  void answer(message).then(reply);
  return true;
});

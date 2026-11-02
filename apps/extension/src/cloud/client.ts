// Calls to the three functions a device may use (ADR-0018): pair with a code, report status, disconnect.
// Plain `fetch` to PostgREST with the publishable key and no session, from the dashboard page.
import { asArray, asObject, asString } from '../shared/json';
import { CLOUD_KEY, CLOUD_URL } from './config';
import type { JobReport } from './summary';

/** Why a call to the cloud failed, as far as the extension acts on it. */
export type CloudErrorReason = 'bad_code' | 'device_limit' | 'unknown_device' | 'unreachable' | 'refused';

/** A failed call: `reason` for the code, `message` safe to show to the person. */
export class CloudError extends Error {
  constructor(
    readonly reason: CloudErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

/** Whether the database's hint names a failure the extension handles on its own. */
const isKnownHint = (hint: string | undefined): hint is 'bad_code' | 'device_limit' | 'unknown_device' =>
  hint === 'bad_code' || hint === 'device_limit' || hint === 'unknown_device';

async function rpc(fn: string, body: Record<string, unknown>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${CLOUD_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: CLOUD_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CloudError('unreachable', 'Couldn’t reach xomoni.com. Check the connection, then try again.');
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return json;
  const error = asObject(json);
  const hint = asString(error?.hint);
  const reason: CloudErrorReason = isKnownHint(hint) ? hint : 'refused';
  throw new CloudError(reason, asString(error?.message) ?? `xomoni.com answered HTTP ${response.status}.`);
}

/** Trades a pairing code from the website for this browser's device id and token. */
export async function pairDevice(code: string, name: string, version: string) {
  const rows: unknown = await rpc('pair_device', { code, name, version });
  const row = asObject(asArray(rows)[0]);
  const deviceId = asString(row?.device_id);
  const token = asString(row?.token);
  if (!deviceId || !token) throw new CloudError('refused', 'xomoni.com did not return a device. Try a new code.');
  return { deviceId, token };
}

/** Says the extension is still there and reports its jobs' status (up to 50). */
export async function reportStatus(token: string, version: string, jobs: readonly JobReport[]): Promise<void> {
  await rpc('device_report', { token, version, jobs });
}

/** Disconnects this browser; its jobs leave the website too. */
export async function unpairDevice(token: string): Promise<void> {
  await rpc('unpair_device', { token });
}

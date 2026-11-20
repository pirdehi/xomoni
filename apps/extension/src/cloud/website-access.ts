// Who xomoni.com may act or read for in this browser (ADR-0027, ADR-0028): only a page whose own account names the
// device this extension is connected as, and only while it is signed in to Xomoni.
import type { ActionRefusal } from '@xomoni/bridge';
import { getSignedOut } from '../shared/session';
import { getConnection } from './connection';

/** Why this extension won't act or read for a page that named `deviceId`, or null when it will. */
export async function accessRefusal(deviceId: string): Promise<ActionRefusal | null> {
  const connection = await getConnection();
  if (!connection) return 'not_connected';
  if (await getSignedOut()) return 'signed_out';
  return connection.deviceId.toLowerCase() === deviceId.toLowerCase() ? null : 'other_account';
}

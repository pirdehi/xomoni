// This browser's link to a xomoni.com account (ADR-0018), kept in chrome.storage.local: apart from the X data in
// IndexedDB, never synced to other browsers, and cleared on disconnect.
import { asNumber, asObject, asString } from '../shared/json';

const KEY = 'cloud';

/** A connected browser: its device on xomoni.com, the token that reports for it, and how far it reported. */
export interface CloudConnection {
  deviceId: string;
  token: string;
  /** The name the person gave this browser, as the dashboard shows it. */
  deviceName: string;
  /** Epoch ms. */
  connectedAt: number;
  /** The newest job update already reported (epoch ms); later updates go in the next report. */
  reportedUpTo: number;
}

/** The stored connection, or null when this browser isn't connected (or the stored value is unusable). */
export async function getConnection(): Promise<CloudConnection | null> {
  const stored = asObject((await chrome.storage.local.get(KEY))[KEY]);
  const deviceId = asString(stored?.deviceId);
  const token = asString(stored?.token);
  if (!deviceId || !token) return null;
  return {
    deviceId,
    token,
    deviceName: asString(stored?.deviceName) ?? 'This browser',
    connectedAt: asNumber(stored?.connectedAt) ?? 0,
    reportedUpTo: asNumber(stored?.reportedUpTo) ?? 0,
  };
}

/** Stores the connection. */
export function saveConnection(connection: CloudConnection): Promise<void> {
  return chrome.storage.local.set({ [KEY]: connection });
}

/** Forgets the connection: the token is gone, so nothing more is reported. */
export function clearConnection(): Promise<void> {
  return chrome.storage.local.remove(KEY);
}

/** Calls `onChange` whenever the stored connection changes (connect, disconnect, a report); returns `unsubscribe`. */
export function watchConnection(onChange: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && KEY in changes) onChange();
  };
  const events = chrome.storage.onChanged;
  events.addListener(listener);
  return () => events.removeListener(listener);
}

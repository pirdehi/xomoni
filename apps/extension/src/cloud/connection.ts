// This browser's link to a xomoni.com account (ADR-0018). It is kept in the extension's IndexedDB (`kv`, key
// `cloud`), where content scripts can't reach it: they run under x.com's origin, while `chrome.storage.local`
// is open to them by default (#151). Never synced to other browsers; cleared on disconnect. Versions before
// #151 kept it in `chrome.storage.local`; the first read moves it.
import { liveQuery } from 'dexie';
import { db, kvSet } from '../shared/db';
import { asNumber, asObject, asString } from '../shared/json';

const KEY = 'cloud';
/** Where versions before #151 kept the connection, in `chrome.storage.local`. */
const LEGACY_KEY = 'cloud';

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

/** `stored` as a connection, or null when it lacks a device id or token. */
function parse(stored: unknown): CloudConnection | null {
  const value = asObject(stored);
  const deviceId = asString(value?.deviceId);
  const token = asString(value?.token);
  if (!deviceId || !token) return null;
  return {
    deviceId,
    token,
    deviceName: asString(value?.deviceName) ?? 'This browser',
    connectedAt: asNumber(value?.connectedAt) ?? 0,
    reportedUpTo: asNumber(value?.reportedUpTo) ?? 0,
  };
}

/** Moves a connection an earlier version left in `chrome.storage.local` into IndexedDB, and returns it. */
async function moveLegacy(): Promise<CloudConnection | null> {
  const stored = await chrome.storage.local.get(LEGACY_KEY);
  if (!(LEGACY_KEY in stored)) return null;
  const legacy = parse(stored[LEGACY_KEY]);
  if (legacy) await kvSet(KEY, legacy);
  await chrome.storage.local.remove(LEGACY_KEY);
  return legacy;
}

/** The stored connection, or null when this browser isn't connected (or the stored value is unusable). */
export async function getConnection(): Promise<CloudConnection | null> {
  return parse((await db.kv.get(KEY))?.value) ?? moveLegacy();
}

/** Stores the connection. */
export function saveConnection(connection: CloudConnection): Promise<void> {
  return kvSet(KEY, connection);
}

/** Forgets the connection, here and wherever an earlier version kept it: the token is gone, so nothing more is reported. */
export async function clearConnection(): Promise<void> {
  await db.kv.delete(KEY);
  await chrome.storage.local.remove(LEGACY_KEY);
}

/**
 * Calls `onChange` once at the start and again whenever the stored connection changes (connect, disconnect, a
 * report); returns `unsubscribe`.
 */
export function watchConnection(onChange: () => void): () => void {
  const subscription = liveQuery(() => db.kv.get(KEY)).subscribe({ next: () => onChange(), error: () => undefined });
  return () => subscription.unsubscribe();
}

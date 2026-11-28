// The plan of the xomoni.com account this browser is connected to (ADR-0042, #423): what `device_report` last said.
// It is kept in the extension's IndexedDB (`kv`), where content scripts can't reach it: they run under x.com's origin.
// - The plan itself under `entitlement:<device id>`: one device's plan is never used for another, such as a browser
//   connected again to another account. Disconnecting or signing out deletes it.
// - Whether sales are open under `billingLive`, which isn't about any account, so a disconnect keeps it: once sales are
//   open, a browser that isn't connected counts as Free rather than as a preview.
// It is heard only from xomoni.com's answer to the heartbeat: no message from a page, the website or x.com sets it. An
// answer the extension can't read changes nothing. Paid views ask `@xomoni/entitlements` about it, which counts the
// plan for 7 days after it was heard (`GRACE_DAYS`) and as Free after that; falling back to Free deletes nothing.
import { type Entitlement, entitlementFromAnswer } from '@xomoni/entitlements';
import { liveQuery } from 'dexie';
import { db, kvGet, kvSet } from '../shared/db';
import { asObject } from '../shared/json';
import { CONNECTION_KEY, getConnection, parseConnection } from './connection';

/** The prefix of the `kv` keys a plan is kept under, one per device. */
export const PLAN_KEY_PREFIX = 'entitlement:';

/** The `kv` key of the plan heard for device `deviceId`. */
export const planKey = (deviceId: string) => `${PLAN_KEY_PREFIX}${deviceId}`;

/** The `kv` key of whether sales were open at the last answer (`billing_live`). */
export const LIVE_KEY = 'billingLive';

/** What one answer of `device_report` said about the account's plan, and whether sales were open then. */
export interface HeardPlan {
  /** The plan, with when it was heard (`checkedAt`, by this computer's clock). */
  entitlement: Entitlement;
  /** Whether sales are open (`billing_live`). Until then every paid feature is a preview. */
  live: boolean;
}

/** What a paid view needs: the plan of the browser connected now (null: none), and whether sales are open. */
export interface PlanState {
  entitlement: Entitlement | null;
  live: boolean;
}

/**
 * The plan in an answer of `device_report`, heard at `checkedAt`: its `entitlement` as `@xomoni/entitlements` reads it,
 * and `billing_live`. Null when either is missing or not exactly that shape, such as from a server older than plans:
 * no answer, rather than Free, so what was heard before stays.
 */
export function planFromReport(answer: unknown, checkedAt: number): HeardPlan | null {
  const report = asObject(answer);
  const entitlement = entitlementFromAnswer(report?.entitlement, checkedAt);
  const live = report?.billing_live;
  if (!entitlement || typeof live !== 'boolean') return null;
  return { entitlement, live };
}

/** The fields a kept plan has, no more and no fewer. */
const KEPT_FIELDS = 'checkedAt,status,tier,validUntil';

/** A kept plan read back as strictly as an answer: anything else, a broken or edited value, is no plan. */
function parse(stored: unknown): Entitlement | null {
  const value = asObject(stored);
  if (!value || Object.keys(value).sort().join() !== KEPT_FIELDS || typeof value.checkedAt !== 'number') return null;
  const { validUntil } = value;
  const answer = {
    tier: value.tier,
    status: value.status,
    valid_until:
      typeof validUntil === 'number' && Number.isFinite(validUntil) ? new Date(validUntil).toISOString() : validUntil,
  };
  return entitlementFromAnswer(answer, value.checkedAt);
}

/** Keeps what xomoni.com just said for device `deviceId`: its plan, in place of the one before, and whether sales are open. */
export async function rememberPlan(deviceId: string, plan: HeardPlan): Promise<void> {
  await db.transaction('rw', db.kv, async () => {
    await kvSet(planKey(deviceId), plan.entitlement);
    await kvSet(LIVE_KEY, plan.live);
  });
}

/**
 * The plan last heard for the browser connected now, or null: not connected, not yet confirmed (#149), or nothing heard
 * yet for this device.
 */
export async function currentEntitlement(): Promise<Entitlement | null> {
  const connection = await getConnection();
  if (!connection?.confirmed) return null;
  return parse(await kvGet<unknown>(planKey(connection.deviceId), null));
}

/**
 * Whether sales were open at the last answer heard, by any connection of this browser. False until one is heard: before
 * the launch every paid feature is a preview, and a browser that never connected can't tell the launch apart.
 */
export async function salesOpen(): Promise<boolean> {
  return (await kvGet<unknown>(LIVE_KEY, false)) === true;
}

/** The plan of the browser connected now and whether sales are open, as `hasPlan` takes them. */
export async function currentPlanState(): Promise<PlanState> {
  // All three reads start before the first await, so a live query follows each of them (#459): reading the plan only
  // after the connection came back left it unwatched on a busy page, and a plan bought then didn't open the gate.
  const [connectionRow, planRows, liveRow] = await Promise.all([
    db.kv.get(CONNECTION_KEY),
    db.kv.where('key').startsWith(PLAN_KEY_PREFIX).toArray(),
    db.kv.get(LIVE_KEY),
  ]);
  const connection = parseConnection(connectionRow?.value);
  const own = connection?.confirmed ? planRows.find((row) => row.key === planKey(connection.deviceId)) : undefined;
  return { entitlement: own ? parse(own.value) : null, live: liveRow?.value === true };
}

/**
 * Forgets every plan heard, for any device: on disconnecting, signing out, connecting anew, and when xomoni.com no
 * longer knows this browser. Whether sales are open stays. Nothing the plan opened is deleted.
 */
export async function forgetPlans(): Promise<void> {
  const keys = await db.kv.where('key').startsWith(PLAN_KEY_PREFIX).primaryKeys();
  await db.kv.bulkDelete(keys);
}

/**
 * Calls `onChange` with the plan state at once and whenever the plan, the sales switch or the connection changes;
 * returns `unsubscribe`. For the *Your plan* card and every `PlanGate`. A read that fails counts as no plan.
 */
export function watchPlanState(onChange: (state: PlanState) => void): () => void {
  const subscription = liveQuery(currentPlanState).subscribe({
    next: onChange,
    error: () => onChange({ entitlement: null, live: false }),
  });
  return () => subscription.unsubscribe();
}

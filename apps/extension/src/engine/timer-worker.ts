// Timers in a dedicated worker are not throttled when the dashboard tab is in the background, so pacing stays accurate
// (PLAYBOOK F5).
//
// Who may post here: only the page that started this worker (`timers.ts`), through the worker's own port. A dedicated
// worker has no other way in, and its messages carry no origin to compare (`event.origin` is '') and no source
// (`event.source` is null). So instead of an origin check (CodeQL's js/missing-origin-check, #341), a message is taken
// only when it has no source, as from that port: a message posted by a window always has one, which could only happen
// if this script ever ran on a page instead of in a worker. And it must be shaped exactly like a request from
// `timers.ts`; anything else is ignored.
import { asObject } from '../shared/json';

/** What `timers.ts` asks: start timer `id` for `ms` milliseconds, or cancel it. */
type TimerRequest = { id: number; ms: number } | { id: number; cancel: true };

/**
 * `data` as a timer request, or null when it is anything else: an object with a positive whole `id` and either a
 * numeric `ms` or `cancel: true`, and no other field. `ms` is any number, as `setTimeout` takes it (`timers.ts` never
 * sends a negative one).
 */
function timerRequest(data: unknown): TimerRequest | null {
  const message = asObject(data);
  if (!message) return null;
  const { id, ms, cancel } = message;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return null;
  const fields = Object.keys(message).sort().join();
  if (fields === 'id,ms' && typeof ms === 'number') return { id, ms };
  if (fields === 'cancel,id' && cancel === true) return { id, cancel: true };
  return null;
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();

self.onmessage = (event: MessageEvent<unknown>) => {
  if (event.source !== null) return;
  const request = timerRequest(event.data);
  if (!request) return;
  const { id } = request;
  if ('cancel' in request) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    return;
  }
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      self.postMessage(id);
    }, request.ms),
  );
};

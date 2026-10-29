// Timers in a dedicated worker are not throttled when the dashboard tab is in
// the background, so pacing stays accurate.
const timers = new Map<number, ReturnType<typeof setTimeout>>();

self.onmessage = (event: MessageEvent<{ id: number; ms?: number; cancel?: boolean }>) => {
  const { id, ms, cancel } = event.data;
  if (cancel) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    return;
  }
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      self.postMessage(id);
    }, ms),
  );
};

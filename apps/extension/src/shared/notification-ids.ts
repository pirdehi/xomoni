// The ids of Xomoni's two desktop notifications, shared by the engine (which shows them through its notifier
// port), the service worker (which handles their clicks) and the Chrome adapter in notify.ts.

/** "X needs you" — clicking it brings up the worker window. */
export const ATTENTION_ID = 'xomoni-attention';
/** A job ended — clicking it opens the dashboard. */
export const FINISHED_ID = 'xomoni-finished';

// Composition root for the engine in the dashboard page (#11): the Chrome adapters behind the engine's ports, and
// the one runner the dashboard uses. Nothing else in the engine imports `worker-tab.ts` or `../shared/notify.ts`
// (rule ext-engine-core-uses-ports).
import { clearNotification, notify } from '../shared/notify';
import type { EnginePorts } from './ports';
import { Runner } from './runner';
import { workerTab } from './worker-tab';

/** The engine's ports in a real browser: the worker tab and Chrome's notifications. */
export const chromePorts: EnginePorts = {
  xTab: workerTab,
  notifier: { notify, clear: clearNotification },
};

/** The runner of this dashboard tab, wired to Chrome. */
export const runner = new Runner(chromePorts);

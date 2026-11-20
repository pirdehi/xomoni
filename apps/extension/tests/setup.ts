// Runs before every test file (vite.config.ts `test.setupFiles`): DOM matchers such as `toBeInTheDocument`,
// and unmounting whatever a component test rendered, so tests never see each other's DOM.
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { afterEach } from 'vitest';

// `findBy…` and `waitFor` wait up to 5 s: the full suite runs many files in parallel, and a page that renders
// hundreds of rows can take more than the default second under that load.
configure({ asyncUtilTimeout: 5000 });

// Fluent UI's styles (Griffel) are not inserted into the test DOM: tests assert behavior through roles, ARIA and
// `data-*` attributes, never computed CSS, and parsing thousands of generated rules in happy-dom made component tests
// about a third slower, enough to push them past their waits on a busy machine (ADR-0019).
if (typeof CSSStyleSheet !== 'undefined') CSSStyleSheet.prototype.insertRule = () => 0;

// happy-dom's Web Animations are partial: cancelling one rejects its `finished` promise with nothing to catch it,
// which Fluent UI's motion does whenever a dialog or tooltip closes. Without `animate`, Fluent skips its
// animations, as it does in browsers without the API (ADR-0019).
if (typeof Element !== 'undefined') Reflect.deleteProperty(Element.prototype, 'animate');

// Each test file gets its own Web Locks (#271). Node's `navigator.locks` is shared by the whole process, so a runner in
// one file holding `xomoni-runner` made another file's sign-out wait for it, up to 30 s on a busy machine. These are
// exclusive locks with `ifAvailable` and waiting in order, which is all the extension asks of them.
class FileLocks {
  private readonly held = new Set<string>();
  private readonly waiting = new Map<string, (() => void)[]>();

  async request<T>(
    name: string,
    ...args: [(lock: Lock | null) => Promise<T>] | [LockOptions, (lock: Lock | null) => Promise<T>]
  ): Promise<T> {
    const [options, callback] = args.length === 1 ? [{} as LockOptions, args[0]] : args;
    if (this.held.has(name)) {
      if (options.ifAvailable) return callback(null);
      // Handed over by the holder's release below, still marked held.
      await new Promise<void>((resolve) => this.waiting.set(name, [...(this.waiting.get(name) ?? []), resolve]));
    } else this.held.add(name);
    try {
      return await callback({ name, mode: options.mode ?? 'exclusive' });
    } finally {
      const next = this.waiting.get(name)?.shift();
      if (next) next();
      else this.held.delete(name);
    }
  }

  query(): Promise<LockManagerSnapshot> {
    return Promise.resolve({
      held: [...this.held].map((name) => ({ name, mode: 'exclusive' as const })),
      pending: [...this.waiting].flatMap(([name, queue]) => queue.map(() => ({ name, mode: 'exclusive' as const }))),
    });
  }
}
if (typeof navigator !== 'undefined')
  Object.defineProperty(navigator, 'locks', { value: new FileLocks(), configurable: true });

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});

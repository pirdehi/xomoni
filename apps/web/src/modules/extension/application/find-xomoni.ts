import type { ExtensionState } from '@xomoni/bridge';
import { extensionCandidates } from '../domain/link';
import type { BrowserMemory, ExtensionChannel } from './ports';

/** Where Xomoni answered in this browser, if anywhere. */
export type FindOutcome =
  /** Nothing to ask, or only fixed ids, none of which answered: Xomoni likely isn't installed here. */
  | { kind: 'none' }
  /** The id a page of Xomoni named didn't answer, nor did any fixed id: turned off, removed or too old. */
  | { kind: 'unreachable' }
  /** The best id that answered, with how Xomoni stands there. */
  | { kind: 'found'; extensionId: string; state: ExtensionState };

/** What `findXomoni` asks. */
export interface FindDeps {
  channel: Pick<ExtensionChannel, 'hello'>;
  memory: Pick<BrowserMemory, 'extensionId'>;
  /** The fixed ids to ask besides the one a page named, best first (`fixedExtensionIds`, #302). */
  fixedIds: readonly string[];
}

/**
 * Asks every candidate at once and resolves with the first in order that answers (anything but null), as soon as each
 * one before it has answered null; null when none answers. An ask that fails counts as no answer. So a faster but
 * worse candidate never wins over a better one, and a slow candidate holds up only those after it.
 */
export function bestAnswer<C, T>(
  candidates: readonly C[],
  ask: (candidate: C) => Promise<T | null>,
): Promise<{ candidate: C; answer: T } | null> {
  return new Promise((resolve) => {
    const slots = candidates.map((candidate) => ({ candidate, done: false, answer: null as T | null }));
    const settle = () => {
      for (const slot of slots) {
        if (!slot.done) return;
        if (slot.answer !== null) {
          resolve({ candidate: slot.candidate, answer: slot.answer });
          return;
        }
      }
      resolve(null);
    };
    for (const slot of slots) {
      void Promise.resolve()
        .then(() => ask(slot.candidate))
        .catch(() => null)
        .then((answer) => {
          slot.answer = answer;
          slot.done = true;
          settle();
        });
    }
    settle();
  });
}

/**
 * Finds Xomoni in this browser (#302, ADR-0025): says hello to the id a page of Xomoni named (`#ext=`) and to each
 * fixed id at once, and takes the best that answers, in that order: the named id, then the Chrome Web Store's, then
 * Edge Add-ons'. Asking an id that no extension has costs nothing: Chrome answers at once that nobody is there. Only a
 * hello is sent, which changes nothing in the extension.
 */
export async function findXomoni(deps: FindDeps): Promise<FindOutcome> {
  const remembered = deps.memory.extensionId();
  const best = await bestAnswer(extensionCandidates(remembered, deps.fixedIds), (id) => deps.channel.hello(id));
  if (best) return { kind: 'found', extensionId: best.candidate, state: best.answer };
  return remembered ? { kind: 'unreachable' } : { kind: 'none' };
}

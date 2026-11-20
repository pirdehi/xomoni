// Getting started (#244): the three steps that make Xomoni and xomoni.com work together, each ticked from what this
// page can see by itself: whether Xomoni answers in this browser, whether someone is signed in here, and whether
// Xomoni is signed in with them. Pure.

/** Where a step stands: done, still to do, or not known yet. */
export type StepState = 'done' | 'todo' | 'checking';

/** One step, in the order they are taken. */
export interface Step {
  id: 'installed' | 'account' | 'connected';
  label: string;
  state: StepState;
}

/** How the extension stands with the site, as far as the steps go (`ExtensionLinkState`). */
export type LinkStatus = 'unknown' | 'none' | 'unreachable' | 'signed-in' | 'signed-out';

/**
 * The steps for this browser. `signedIn` is whether someone is signed in on xomoni.com here (null while read);
 * `link` how Xomoni answered (`unknown` before it did).
 */
export function gettingStarted(link: LinkStatus, signedIn: boolean | null): Step[] {
  const installed: StepState =
    link === 'unknown' ? 'checking' : link === 'signed-in' || link === 'signed-out' ? 'done' : 'todo';
  return [
    { id: 'installed', label: 'Install Xomoni in this browser', state: installed },
    {
      id: 'account',
      label: 'Sign in to xomoni.com, or create a free account',
      state: signedIn === null ? 'checking' : signedIn ? 'done' : 'todo',
    },
    {
      id: 'connected',
      label: 'Xomoni signs in with you, in this browser',
      state: link === 'signed-in' ? 'done' : link === 'unknown' ? 'checking' : 'todo',
    },
  ];
}

/** The first step still to do, or null when every step is done (or still being checked). */
export function nextStep(steps: readonly Step[]): Step | null {
  return steps.find((step) => step.state === 'todo') ?? null;
}

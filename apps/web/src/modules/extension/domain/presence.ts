// Whether this page can reach Xomoni to act (ADR-0027, #251), and if not, why: the one dialog says which. Pure.
import type { ActionRefusal, JobAction, XomoniPage } from '@xomoni/bridge';

/** How the extension stands with the site after the last sync, as far as acting goes. */
export type LinkView =
  { status: 'unknown' | 'none' | 'unreachable' | 'signed-out' } | { status: 'signed-in'; deviceId: string };

/**
 * Whether Xomoni can act from this page:
 * - `checking`: the first sync hasn't answered yet;
 * - `here`: Xomoni in this browser is signed in to this account, as `deviceId`;
 * - `not-installed`: no Xomoni answers in this browser (never seen, removed or turned off);
 * - `phone`: a phone or tablet, where Xomoni doesn't run;
 * - `signed-out`: Xomoni is here but not signed in;
 * - `other-account`: Xomoni is here, signed in to another xomoni.com account.
 */
export type XomoniPresence =
  | { kind: 'checking' }
  | { kind: 'here'; deviceId: string }
  | { kind: 'not-installed' }
  | { kind: 'phone' }
  | { kind: 'signed-out' }
  | { kind: 'other-account' };

/**
 * Where Xomoni stands for this page. `accountDevices` are the signed-in account's own devices, so a device id the
 * extension reports counts only when it is one of them. A phone wins over everything: Xomoni never runs there.
 */
export function xomoniPresence(link: LinkView, accountDevices: readonly string[], phone: boolean): XomoniPresence {
  if (phone) return { kind: 'phone' };
  switch (link.status) {
    case 'unknown':
      return { kind: 'checking' };
    case 'none':
    case 'unreachable':
      return { kind: 'not-installed' };
    case 'signed-out':
      return { kind: 'signed-out' };
    case 'signed-in': {
      const id = link.deviceId.toLowerCase();
      return accountDevices.some((d) => d.toLowerCase() === id)
        ? { kind: 'here', deviceId: link.deviceId }
        : { kind: 'other-account' };
    }
  }
}

/** Whether the browser is a phone or tablet, from its user agent and, where Chrome gives it, its mobile hint. */
export function isPhoneBrowser(userAgent: string, mobileHint?: boolean): boolean {
  if (mobileHint === true) return true;
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(userAgent);
}

/** Something the page asks of Xomoni: an action on a job, or opening one of its pages. */
export type XomoniRequest =
  | { kind: 'job'; action: JobAction; deviceId: string; jobId: string }
  | { kind: 'open'; page: XomoniPage; deviceId: string };

/** States in which a job has ended: nothing to pause, cancel or resume. */
const ENDED = new Set(['completed', 'cancelled']);
/** States in which a job is running in its browser. */
const RUNNING = new Set(['running', 'waiting']);

/** What the website may ask of a job in `state`, in the order its buttons show. */
export function jobActionsFor(state: string): JobAction[] {
  if (ENDED.has(state)) return [];
  return RUNNING.has(state) ? ['pause', 'cancel'] : ['resume', 'cancel'];
}

/** What a page says after Xomoni answered, in plain words. */
export function answerMessage(
  answer: { ok: true; outcome: 'stopping' | 'cancelled' | 'asked' | 'opened' } | { ok: false; reason: ActionRefusal },
  action: JobAction | 'open',
): string {
  if (answer.ok) {
    switch (answer.outcome) {
      case 'stopping':
        return action === 'pause'
          ? 'Pausing: the job stops after the action in progress.'
          : 'Cancelling: the job stops after the action in progress.';
      case 'cancelled':
        return 'The job is cancelled.';
      case 'asked':
        return 'Xomoni opened on this computer. Choose Resume there to continue: nothing runs until you do.';
      case 'opened':
        return 'Xomoni opened on this computer.';
    }
  }
  switch (answer.reason) {
    case 'not_connected':
    case 'signed_out':
    case 'other_account':
      return 'Xomoni in this browser isn’t signed in to this account.';
    case 'no_job':
      return 'Xomoni in this browser doesn’t have this job any more.';
    case 'not_running':
      return 'The job isn’t running, so there is nothing to pause.';
    case 'finished':
      return 'The job has already ended.';
    case 'invalid':
    case 'refused':
      return 'Xomoni refused this. Update Xomoni and try again.';
    case 'no_answer':
      return 'Xomoni didn’t answer. Open it on this computer and try again.';
  }
}

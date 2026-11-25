// The email when X warns an account (#407, ADR-0047): the person's choice as the website shows it, and what each state
// says. Pure.

/** Whether the account gets the alert, and whether xomoni.com can send one at all (the Resend key is set up). */
export interface HealthAlertStatus {
  /** The stored choice; false until the person turns it on. */
  enabled: boolean;
  /** Whether xomoni.com can send it: false while the Resend key isn't in Vault, and then nothing is sent. */
  canSend: boolean;
}

/** The risk level from which an alert is sent: Retreat (ADR-0013). Caution, one rate limit, never sends. */
export const ALERT_FROM_LEVEL = 2;

/** The least time between two alerts to the same person, in hours. */
export const ALERT_EVERY_HOURS = 6;

/** What the choice is, as the Settings card shows it: off, on, on or off while sending isn't set up, or unknown. */
export type HealthAlertState = 'reading' | 'off' | 'on' | 'not-set-up' | 'error';

/** The card's state from what was read: null while reading, `error` when it couldn't be read. */
export function healthAlertState(status: HealthAlertStatus | 'error' | null): HealthAlertState {
  if (status === null) return 'reading';
  if (status === 'error') return 'error';
  if (!status.canSend) return 'not-set-up';
  return status.enabled ? 'on' : 'off';
}

/** What the card says under the switch in each state. */
export function healthAlertNote(state: HealthAlertState): string {
  switch (state) {
    case 'reading':
      return 'Reading your choice…';
    case 'error':
      return 'Couldn’t read your choice. Reload the page to try again.';
    case 'not-set-up':
      return 'Sending isn’t set up on xomoni.com yet, so nothing is sent until it is. Your choice is kept.';
    case 'on':
      return `On. When X warns one of your X accounts and Xomoni stops there, you get one email, at most every ${ALERT_EVERY_HOURS} hours. Each email has a link to stop it.`;
    case 'off':
      return 'Off. Turn it on to get one email when X warns one of your X accounts and Xomoni stops there.';
  }
}

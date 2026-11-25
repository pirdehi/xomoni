import { describe, expect, it } from 'vitest';
import { ALERT_EVERY_HOURS, ALERT_FROM_LEVEL, healthAlertNote, healthAlertState } from './health-alert';

describe('the health alert’s states (#407, ADR-0047)', () => {
  it('reads, then shows off or on, and says when it couldn’t be read', () => {
    expect(healthAlertState(null)).toBe('reading');
    expect(healthAlertState('error')).toBe('error');
    expect(healthAlertState({ enabled: false, canSend: true })).toBe('off');
    expect(healthAlertState({ enabled: true, canSend: true })).toBe('on');
  });

  it('says sending isn’t set up, on or off, while xomoni.com can’t send: the choice is kept', () => {
    expect(healthAlertState({ enabled: true, canSend: false })).toBe('not-set-up');
    expect(healthAlertState({ enabled: false, canSend: false })).toBe('not-set-up');
    expect(healthAlertNote('not-set-up')).toBe(
      'Sending isn’t set up on xomoni.com yet, so nothing is sent until it is. Your choice is kept.',
    );
  });

  it('says what each state means, with the six hours between emails and a way to stop each', () => {
    expect(healthAlertNote('on')).toContain(`at most every ${ALERT_EVERY_HOURS} hours`);
    expect(healthAlertNote('on')).toContain('Each email has a link to stop it.');
    expect(healthAlertNote('off')).toMatch(/^Off\. Turn it on/);
    expect(healthAlertNote('error')).toBe('Couldn’t read your choice. Reload the page to try again.');
    expect(healthAlertNote('reading')).toBe('Reading your choice…');
  });

  it('starts at Retreat, as the database does: Caution never sends', () => {
    expect(ALERT_FROM_LEVEL).toBe(2);
    expect(ALERT_EVERY_HOURS).toBe(6);
  });
});

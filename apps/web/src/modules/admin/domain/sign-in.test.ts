import { describe, expect, it } from 'vitest';
import { CONSOLE_REFUSED, CONSOLE_SIGN_IN_MESSAGES } from './sign-in';

describe('the console sign-in’s words (#516)', () => {
  it('give wrong details and a stranger one answer, which names neither', () => {
    expect(CONSOLE_SIGN_IN_MESSAGES.refused).toBe(CONSOLE_REFUSED);
    expect(CONSOLE_REFUSED).toBe('These details don’t open the console.');
    for (const message of Object.values(CONSOLE_SIGN_IN_MESSAGES)) {
      expect(message).not.toMatch(/super-admin|not found|no account|exist/i);
    }
  });
});

import { describe, expect, it } from 'vitest';
// xomoni.com's landing page states the default pace. It is read as text (Vite's `?raw`): the apps don't import each other.
import content from '../../web/src/modules/landing/ui/content.ts?raw';
import { PRESETS } from '../src/shared/settings';

describe('the pace xomoni.com promises (#239)', () => {
  it('is the Careful preset for deletes: its delays and its hourly and daily caps', () => {
    const { minDelay, maxDelay, hourlyCap, dailyCap } = PRESETS.careful.delete;

    expect(content).toContain(`'${minDelay}–${maxDelay} s'`);
    expect(content).toContain(`'${hourlyCap} / hour'`);
    expect(content).toContain(`and ${dailyCap.toLocaleString('en-US')} a day, at most, by default`);
  });
});

describe('what xomoni.com’s privacy policy says Xomoni keeps (ADR-0030)', () => {
  it('names the replies Xomoni keeps with the limits it keeps them to', async () => {
    const { INCOMING_KEEP_DAYS, INCOMING_MAX } = await import('../src/shared/incoming');
    const { default: privacy } = await import('../../web/src/app/privacy/page.tsx?raw');

    expect(privacy).toContain(
      `at most the last ${INCOMING_KEEP_DAYS} days and ${INCOMING_MAX.toLocaleString('en-US')} replies per X account`,
    );
  });
});

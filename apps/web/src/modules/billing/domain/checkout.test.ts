import { describe, expect, it } from 'vitest';
import { BILLING_ERROR_MESSAGES, POLAR_PAGE_ORIGINS, isPolarPage, readPurchase } from './checkout';

describe('readPurchase (#421)', () => {
  it('reads Plus and Pro, monthly or yearly, and the pass', () => {
    expect(readPurchase({ plan: 'plus', interval: 'month' })).toEqual({ plan: 'plus', interval: 'month' });
    expect(readPurchase({ plan: 'pro', interval: 'year' })).toEqual({ plan: 'pro', interval: 'year' });
    expect(readPurchase({ plan: 'pass' })).toEqual({ plan: 'pass' });
  });

  it('leaves out React’s own fields of a Server Action’s form', () => {
    expect(
      readPurchase({ plan: 'plus', interval: 'year', $ACTION_REF_1: '', '$ACTION_1:0': '{}', $ACTION_KEY: 'k' }),
    ).toEqual({
      plan: 'plus',
      interval: 'year',
    });
    expect(readPurchase({ plan: 'pass', $ACTION_ID_abc: '' })).toEqual({ plan: 'pass' });
  });

  it('refuses an unknown plan, a tampered interval, a missing one, and any extra field', () => {
    for (const fields of [
      {},
      { plan: 'free' },
      { plan: 'team', interval: 'month' },
      { plan: 'plus' },
      { plan: 'plus', interval: 'week' },
      { plan: 'pro', interval: 'year', price: '0' },
      { plan: 'pass', interval: 'month' },
      { plan: 'pass', discount_id: 'disc_x' },
      { plan: ['plus'], interval: 'month' },
    ])
      expect(readPurchase(fields), JSON.stringify(fields)).toBeNull();
  });
});

describe('isPolarPage (#421)', () => {
  it('takes Polar’s own origins, over https, named exactly', () => {
    expect(POLAR_PAGE_ORIGINS).toEqual(['https://polar.sh', 'https://buy.polar.sh', 'https://sandbox.polar.sh']);
    for (const url of [
      'https://buy.polar.sh/polar_c_1',
      'https://polar.sh/xomoni/portal?t=1',
      'https://sandbox.polar.sh/c',
    ])
      expect(isPolarPage(url, 'https://api.polar.sh')).toBe(true);
  });

  it('refuses any other page: another host, http, a look-alike, a page of the API itself, not a URL', () => {
    for (const url of [
      'https://evil.example/polar.sh',
      'http://polar.sh/x',
      'https://polar.sh.evil.example/x',
      'https://api.polar.sh/v1/checkouts/',
      'https://xomoni.com/account',
      'javascript:alert(1)',
      'not a url',
    ])
      expect(isPolarPage(url, 'https://api.polar.sh'), url).toBe(false);
  });

  it('takes the tests’ fake Polar on this computer, and only when the server’s Polar is that fake', () => {
    expect(isPolarPage('http://127.0.0.1:4010/checkout/chk_1', 'http://127.0.0.1:4010')).toBe(true);
    expect(isPolarPage('http://127.0.0.1:4010/checkout/chk_1', 'https://api.polar.sh')).toBe(false);
    expect(isPolarPage('http://127.0.0.1:9999/checkout/chk_1', 'http://127.0.0.1:4010')).toBe(false);
    expect(isPolarPage('http://localhost:4010/x', 'http://localhost:4010')).toBe(true);
    expect(isPolarPage('https://buy.polar.sh/x', 'not a url')).toBe(false);
  });

  it('has a message for every code, in the person’s words', () => {
    for (const message of Object.values(BILLING_ERROR_MESSAGES)) expect(message).toMatch(/^[A-Z].+\.$/);
  });
});

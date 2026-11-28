import { describe, expect, it } from 'vitest';
import { CONSOLE_PATHS, consoleNext, userPath } from './routes';

describe('console routes (#516)', () => {
  it('keeps every page under /product, the document at /product/document', () => {
    for (const path of Object.values(CONSOLE_PATHS)) expect(path.startsWith('/product')).toBe(true);
    expect(CONSOLE_PATHS.document).toBe('/product/document');
    expect(CONSOLE_PATHS.signIn).toBe('/product/login');
  });

  it('encodes an account id into its page', () => {
    expect(userPath('6f1c0a5e-1111-4222-8333-944455556666')).toBe(
      '/product/users/6f1c0a5e-1111-4222-8333-944455556666',
    );
    expect(userPath('a/../b?c')).toBe('/product/users/a%2F..%2Fb%3Fc');
  });

  it('follows next only to a console page other than the sign-in itself', () => {
    expect(consoleNext('/product/users?q=ada')).toBe('/product/users?q=ada');
    expect(consoleNext('/product')).toBe('/product');
    expect(consoleNext('/product/document?v=2')).toBe('/product/document?v=2');
    for (const elsewhere of [
      '/dashboard',
      '/products',
      '/product/login',
      '/product/login?next=/x',
      null,
      undefined,
      '',
    ]) {
      expect(consoleNext(elsewhere)).toBe('/product');
    }
  });
});

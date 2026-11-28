import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseDigest } from './parse';

// The schema's place (#430, ADR-0014): parse.ts holds it, and only the server reads it. The pages' browser code must
// never carry zod, whose `new Function` probe the site's Content-Security-Policy blocks and reports.

describe('the digest schema under the site CSP', () => {
  it('runs without eval', () => {
    expect(parseDigest({}).ok).toBe(false);
    expect(z.config().jitless).toBe(true);
  });

  it('is never imported by the pages’ components, nor zod by the words they use', () => {
    const ui = new URL('../ui/', import.meta.url);
    for (const name of readdirSync(ui).filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))) {
      const text = readFileSync(new URL(name, ui), 'utf8');
      for (const line of text.split('\n').filter((l) => /from '\.\.\/domain\/parse'/.test(l)))
        expect(line, name).toMatch(/^import type /);
      expect(text, name).not.toMatch(/from 'zod'/);
    }
    expect(readFileSync(new URL('./digest.ts', import.meta.url), 'utf8')).not.toMatch(/from 'zod'|from '\.\/parse'/);
  });
});

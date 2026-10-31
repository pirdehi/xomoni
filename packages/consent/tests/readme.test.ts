import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONSENT_SECTIONS, consentMarkdown } from '../src/index';

const README = new URL('../../../README.md', import.meta.url);

describe('consent text', () => {
  it('is the same in the README as in the extension and on xomoni.com', () => {
    const readme = readFileSync(README, 'utf8');
    const block = readme.match(/<!-- consent:start -->\n([\s\S]*?)\n<!-- consent:end -->/);
    expect(
      block,
      'README.md needs a consent block between <!-- consent:start --> and <!-- consent:end -->',
    ).not.toBeNull();
    expect(block![1].trim()).toBe(consentMarkdown());
  });

  it('covers X’s rule, the remaining risk, permanence, the archive and what Xomoni never does', () => {
    const text = consentMarkdown();
    for (const words of ['non-API automation', 'can’t make the risk zero', 'permanent', 'archive', 'never does']) {
      expect(text).toContain(words);
    }
    expect(CONSENT_SECTIONS.find((s) => s.link)?.link?.href).toBe(
      'https://help.x.com/en/rules-and-policies/x-automation',
    );
  });
});

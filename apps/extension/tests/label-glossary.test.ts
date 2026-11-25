import { describe, expect, it } from 'vitest';
import { LABEL_GLOSSARY, glossaryEntry } from '../src/shared/vault/label-glossary';

/** ADR-0045, point 3: words no text of Reach may use about a post or an account. */
const BANNED = /shadow\s*-?\s*ban|\bbann(ed|ing)\b|\bbans?\b|penali[sz]|suppress|throttl/i;

describe('the label glossary (#428, ADR-0045)', () => {
  it('gives each entry a meaning, an effect, an https source and the day it was checked', () => {
    expect(LABEL_GLOSSARY.length).toBeGreaterThan(0);
    for (const entry of LABEL_GLOSSARY) {
      expect(entry.name, entry.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(entry.meaning.trim(), entry.name).not.toBe('');
      expect(entry.effect.trim(), entry.name).not.toBe('');
      expect(new URL(entry.source).protocol, entry.name).toBe('https:');
      expect(entry.sourceName.trim(), entry.name).not.toBe('');
      expect(entry.checkedOn, entry.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const checked = Date.parse(`${entry.checkedOn}T00:00:00Z`);
      expect(Number.isFinite(checked), entry.name).toBe(true);
      expect(new Date(checked).toISOString().slice(0, 10), entry.name).toBe(entry.checkedOn);
      // Checked after X shipped the report (August 2026), and not in the future.
      expect(checked, entry.name).toBeGreaterThanOrEqual(Date.UTC(2026, 7, 1));
      expect(checked, entry.name).toBeLessThanOrEqual(Date.now());
    }
  });

  it('names each label once', () => {
    const names = LABEL_GLOSSARY.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('never says a post or an account is banned, penalized, suppressed or throttled', () => {
    for (const entry of LABEL_GLOSSARY) {
      for (const words of [entry.meaning, entry.effect, entry.sourceName]) expect(words).not.toMatch(BANNED);
    }
  });

  it('finds a known label whatever its case or spaces, and nothing for an unknown one', () => {
    expect(glossaryEntry('SPAM_HIGH_RECALL')?.effect).toBe(
      "The post isn't recommended to people who don't follow you.",
    );
    expect(glossaryEntry(' spam_high_recall ')?.name).toBe('SPAM_HIGH_RECALL');
    expect(glossaryEntry('SYNTHETIC_UNKNOWN_LABEL')).toBeNull();
    expect(glossaryEntry('')).toBeNull();
    // A name from an object's prototype is not a label.
    expect(glossaryEntry('constructor')).toBeNull();
    expect(glossaryEntry('__proto__')).toBeNull();
  });
});

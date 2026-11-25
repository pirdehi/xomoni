import { describe, expect, it } from 'vitest';
import * as bridge from '../src/index';
import {
  REACH_BANNED_WORDS,
  REACH_VERDICTS,
  REACH_VERDICT_WORDS,
  type ReachVerdict,
  usesBannedReachWord,
} from '../src/reach';

describe('reach diagnosis’s shared words (ADR-0045)', () => {
  it('has five verdicts, each with its words, and nothing else', () => {
    expect([...REACH_VERDICTS].sort()).toEqual(
      ['clear-higher', 'clear-lower', 'maybe', 'no-difference', 'not-enough-data'].sort(),
    );
    expect(Object.keys(REACH_VERDICT_WORDS).sort()).toEqual([...REACH_VERDICTS].sort());
    const words: Record<ReachVerdict, string> = {
      'clear-lower': 'Clearly lower',
      'clear-higher': 'Clearly higher',
      maybe: 'Maybe',
      'no-difference': 'No difference',
      'not-enough-data': 'Not enough data',
    };
    expect(REACH_VERDICT_WORDS).toEqual(words);
  });

  it('is what both apps import from @xomoni/bridge', () => {
    expect(bridge.REACH_VERDICT_WORDS).toBe(REACH_VERDICT_WORDS);
    expect(bridge.REACH_VERDICTS).toBe(REACH_VERDICTS);
    expect(bridge.usesBannedReachWord).toBe(usesBannedReachWord);
  });

  it('finds every form of the banned words, in any case', () => {
    for (const text of [
      'Your post was shadowbanned',
      'a shadow-ban',
      'Shadow ban check',
      'SHADOWBAN',
      'shadow_banned',
      'X banned this post',
      'a ban on links',
      'Bans',
      'banning',
      'penalized',
      'penalised',
      'a penalty',
      'suppressed reach',
      'suppression',
      'throttled',
      'throttling',
    ]) {
      expect(usesBannedReachWord(text), text).toBe(true);
    }
    expect(REACH_BANNED_WORDS.flags).not.toContain('g');
  });

  it('leaves ordinary words alone, and a web address a source’s link names', () => {
    for (const text of [
      'banner',
      'urban',
      'abandoned',
      'Banana',
      'Clearly lower',
      'Not enough data',
      'Source: https://roboin.io/article/en/2026/09/04/checking-xs-official-shadowban-checker-under-the-hood/',
      'http://example.com/banned',
    ]) {
      expect(usesBannedReachWord(text), text).toBe(false);
    }
    expect(usesBannedReachWord('https://example.com/a banned')).toBe(true);
  });

  it('uses none of them in its own words', () => {
    for (const words of Object.values(REACH_VERDICT_WORDS)) expect(usesBannedReachWord(words)).toBe(false);
  });
});

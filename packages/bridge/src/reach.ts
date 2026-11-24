// Reach diagnosis's words that both apps show (ADR-0045): the five verdicts of a comparison, and the words no text of
// Reach may use. One source, so the extension's Reach page and Reach on xomoni.com can't drift.

/** A comparison's verdict: one of five fixed words, never another (ADR-0045, point 2). */
export type ReachVerdict = 'clear-lower' | 'clear-higher' | 'maybe' | 'no-difference' | 'not-enough-data';

/** Every verdict, from the most certain to the least. */
export const REACH_VERDICTS: readonly ReachVerdict[] = [
  'clear-lower',
  'clear-higher',
  'no-difference',
  'maybe',
  'not-enough-data',
];

/** What each verdict says to the person, in the extension and on xomoni.com alike. */
export const REACH_VERDICT_WORDS: Readonly<Record<ReachVerdict, string>> = {
  'clear-lower': 'Clearly lower',
  'clear-higher': 'Clearly higher',
  maybe: 'Maybe',
  'no-difference': 'No difference',
  'not-enough-data': 'Not enough data',
};

/**
 * Words no verdict, heading, notification or text of Reach may use about a post or an account (ADR-0045, point 3):
 * shadowbanned, banned, penalized (or a penalty), suppressed, throttled, in any form. A test searches every string of Reach, in the
 * extension and on the website, with it. Addresses are left out before the search: a source's link may name them.
 */
export const REACH_BANNED_WORDS = /shadow[\s_-]*ban|\bbann(?:ed|ing)\b|\bbans?\b|penali[sz]|penalt|suppress|throttl/i;

/** Whether `text`, without its web addresses, uses a word `REACH_BANNED_WORDS` forbids. */
export function usesBannedReachWord(text: string): boolean {
  return REACH_BANNED_WORDS.test(text.replace(/\bhttps?:\/\/\S+/gi, ' '));
}

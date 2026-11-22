// A post's text as X shows it (#370). X sends `full_text`, in its GraphQL answers and in the archive, HTML-escaped:
// "R&D <3" arrives as "R&amp;D &lt;3", while X's page shows it decoded. Xomoni decodes it once, where it reads it, and
// matches keep words against both forms, so a copy stored before that still keeps what the person asked to keep.
// Pure, without IndexedDB, so the content script can import it.

/**
 * The named entities X's escaping produces, and the two quotes an HTML escaper may add. A `Map`, so a name such as
 * `constructor` finds nothing, never what an object inherits.
 */
const NAMED: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** One entity: a name from `NAMED`, or a decimal or hexadecimal character reference such as `&#39;` or `&#x27;`. */
const ENTITY = /&(?:([a-z]+)|#(\d{1,7})|#[xX]([\dA-Fa-f]{1,6}));/g;

/** The character a numeric reference names, or null for a code point that isn't a character. */
function fromCodePoint(code: number): string | null {
  if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
  return String.fromCodePoint(code);
}

/**
 * `text` with X's HTML entities decoded, as X's page shows it: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` and numeric
 * references such as `&#39;`. One pass, so a post that reads "&lt;" on X, sent as `&amp;lt;`, stays "&lt;". Anything
 * else, such as "AT&T" or an unknown `&nbsp;`, is left as it is. The result is text, never markup: it is shown as text,
 * and escaped again wherever Xomoni writes HTML (`backup.ts`).
 */
export function decodeXText(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    ENTITY,
    (entity, name: string | undefined, decimal: string | undefined, hex: string | undefined) => {
      if (name !== undefined) return NAMED.get(name) ?? entity;
      const code = decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? '', 16);
      return fromCodePoint(code) ?? entity;
    },
  );
}

/**
 * The first of the keep `words` that `text` contains, ignoring case, or undefined when it has none. The text is looked
 * at as it is and decoded (`decodeXText`): a copy stored before Xomoni decoded X's text, an older Xomoni's move file, or
 * the page's own text all match the same words. A keep word only spares, so looking at both forms can keep more, never
 * remove more. The preview, the job (`filter.ts`) and the content script's last check before a delete use this one rule.
 * Empty words are ignored.
 */
export function keepWordIn(text: string, words: readonly string[]): string | undefined {
  if (!words.length) return undefined;
  const raw = text.toLowerCase();
  const decoded = decodeXText(text).toLowerCase();
  return words.find((word) => {
    const k = word.toLowerCase();
    return k !== '' && (raw.includes(k) || decoded.includes(k));
  });
}

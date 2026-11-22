import { describe, expect, it } from 'vitest';
import { decodeXText, keepWordIn } from '../src/shared/x-text';

describe('X’s escaped post text, decoded as X’s page shows it (#370)', () => {
  it('decodes the entities X escapes &, < and > with, and the quotes an escaper may add', () => {
    expect(decodeXText('R&amp;D &lt;3 &gt; me')).toBe('R&D <3 > me');
    expect(decodeXText('&quot;fish&quot; &#39;n&#39; &apos;chips&apos;')).toBe("\"fish\" 'n' 'chips'");
    expect(decodeXText('&#x27;hex&#X27; &#60;3 &#x1F600;')).toBe("'hex' <3 😀");
  });

  it('decodes in one pass, so text that reads “&lt;” on X stays “&lt;”', () => {
    expect(decodeXText('&amp;lt;b&amp;gt; &amp;amp;')).toBe('&lt;b&gt; &amp;');
  });

  it('leaves anything that isn’t one of those entities as it is', () => {
    for (const text of ['AT&T', 'a & b', 'R&D;', '&nbsp;', '&AMP;', '&#;', '&#x;', '&amp', 'no entity', '']) {
      expect(decodeXText(text)).toBe(text);
    }
    // A name an object inherits is no entity either.
    expect(decodeXText('&constructor; &proto; &tostring;')).toBe('&constructor; &proto; &tostring;');
    // A number that isn't a character: zero, a surrogate half, past Unicode's last code point.
    for (const text of ['&#0;', '&#xD800;', '&#x110000;', '&#9999999;']) expect(decodeXText(text)).toBe(text);
  });

  it('gives text, never markup: decoded tags are characters to show as text', () => {
    expect(decodeXText('&lt;img src=x onerror=alert(1)&gt;')).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('keep words, matched against the text as stored and as X shows it (#370)', () => {
  it('finds a word with &, < or > in X’s escaped text and in the decoded text, whatever its case', () => {
    for (const text of ['R&amp;D notes &lt;3', 'R&D notes <3']) {
      expect(keepWordIn(text, ['r&d'])).toBe('r&d');
      expect(keepWordIn(text, ['<3'])).toBe('<3');
      expect(keepWordIn(text, ['NOTES <3'])).toBe('NOTES <3');
    }
  });

  it('gives the first word the text has, and nothing when it has none', () => {
    expect(keepWordIn('Fish &amp; chips', ['salad', 'fish & chips', 'chips'])).toBe('fish & chips');
    expect(keepWordIn('Fish &amp; chips', ['salad', 'r&d'])).toBeUndefined();
    expect(keepWordIn('Fish &amp; chips', [])).toBeUndefined();
  });

  it('ignores an empty word, which would otherwise keep every post', () => {
    expect(keepWordIn('anything', [''])).toBeUndefined();
    expect(keepWordIn('anything', ['', 'any'])).toBe('any');
  });

  it('only keeps more: the escaped form’s own letters still match, as they did before', () => {
    // "amp" is in what X sent; keeping on it spares the post, never removes one.
    expect(keepWordIn('R&amp;D', ['amp'])).toBe('amp');
  });
});

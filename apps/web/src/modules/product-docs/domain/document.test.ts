import { describe, expect, it } from 'vitest';
import {
  checkDocument,
  LINK_SCRIPT,
  MANAGE_LINK,
  MANAGE_PATH,
  MAX_DOCUMENT_BYTES,
  MAX_TITLE_LENGTH,
  prepareDocumentHtml,
} from './document';

const page = '<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>';

describe('checkDocument', () => {
  it('accepts an HTML page with a title', () => {
    expect(checkDocument({ title: 'Brand engine', html: page })).toBeNull();
  });

  it('accepts a page that only has a body tag', () => {
    expect(checkDocument({ title: 'x', html: '<body class="a">hi</body>' })).toBeNull();
  });

  it('refuses an empty or blank title, and one that is too long', () => {
    expect(checkDocument({ title: '', html: page })).toBe('bad-title');
    expect(checkDocument({ title: '   ', html: page })).toBe('bad-title');
    expect(checkDocument({ title: 'x'.repeat(MAX_TITLE_LENGTH + 1), html: page })).toBe('bad-title');
    expect(checkDocument({ title: 'x'.repeat(MAX_TITLE_LENGTH), html: page })).toBeNull();
  });

  it('refuses an empty page', () => {
    expect(checkDocument({ title: 'x', html: '  \n ' })).toBe('empty');
  });

  it('refuses a page over the size limit, counted in bytes, not characters', () => {
    const persian = 'س'; // two bytes in UTF-8
    const body = persian.repeat(Math.ceil(MAX_DOCUMENT_BYTES / 2) + 10);
    expect(body.length).toBeLessThan(MAX_DOCUMENT_BYTES);
    expect(checkDocument({ title: 'x', html: `<body>${body}</body>` })).toBe('too-large');
  });

  it('refuses text that is not an HTML page', () => {
    expect(checkDocument({ title: 'x', html: '# Markdown title' })).toBe('not-html');
    expect(checkDocument({ title: 'x', html: '<bodyguard>' })).toBe('not-html');
  });
});

describe('prepareDocumentHtml', () => {
  it('puts the versions link and the link script just before the last </body>', () => {
    const out = prepareDocumentHtml(page);
    expect(out).toContain(`${MANAGE_LINK}\n${LINK_SCRIPT}\n</body>`);
    expect(out.indexOf(LINK_SCRIPT)).toBeGreaterThan(out.indexOf('<p>hi</p>'));
    expect(MANAGE_LINK).toContain(`href="${MANAGE_PATH}"`);
  });

  it('opens only links to other sites in a new tab, so links inside the document keep working', () => {
    expect(LINK_SCRIPT).toContain('/^https?:/i');
    expect(LINK_SCRIPT).toContain('noopener noreferrer');
  });

  it('uses the last </body> when the text mentions another one earlier', () => {
    const html = '<!doctype html><body><code>&lt;/body&gt; </body></code></body>';
    const out = prepareDocumentHtml(html);
    expect(out.endsWith(`${LINK_SCRIPT}\n</body>`)).toBe(true);
    expect(out.match(/Versions<\/a>/g)).toHaveLength(1);
  });

  it('adds a doctype only when the page has none', () => {
    expect(prepareDocumentHtml(page).match(/<!doctype html>/gi)).toHaveLength(1);
    expect(prepareDocumentHtml('<body>x</body>').startsWith('<!doctype html>\n')).toBe(true);
  });

  it('appends the script when there is no </body>', () => {
    expect(prepareDocumentHtml('<html><body>x').endsWith(`${LINK_SCRIPT}\n`)).toBe(true);
  });
});

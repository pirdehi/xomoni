import { describe, expect, it } from 'vitest';
import manifestJson from '../public/manifest.json';
import { parseCsp, widerAccess } from '../src/update/manifest-access';

/** Xomoni's own manifest, as the version running has it. */
const running = (): Record<string, unknown> => structuredClone(manifestJson);

/** The running manifest with `change` applied: a field set, or removed when `undefined`. */
function next(change: Record<string, unknown>): Record<string, unknown> {
  const manifest = running();
  for (const [field, value] of Object.entries(change)) {
    if (value === undefined) Reflect.deleteProperty(manifest, field);
    else manifest[field] = value;
  }
  return manifest;
}

const CSP = manifestJson.content_security_policy.extension_pages;

describe('what a one-click update may not gain (#305)', () => {
  it('lets the same manifest through, and one that asks for less', () => {
    expect(widerAccess(running(), running())).toEqual([]);
    expect(widerAccess(running(), next({ permissions: ['storage'], optional_host_permissions: [] }))).toEqual([]);
    expect(widerAccess(running(), next({ externally_connectable: undefined }))).toEqual([]);
    // A stricter policy: fewer sources for connect-src.
    expect(
      widerAccess(running(), next({ content_security_policy: { extension_pages: `${CSP}; connect-src 'self'` } })),
    ).toEqual([]);
    // Fields nobody compares, such as the version and the description, change freely.
    expect(widerAccess(running(), next({ version: '9.9.9', description: 'new words' }))).toEqual([]);
  });

  it.each([
    ['permissions', { permissions: [...manifestJson.permissions, 'tabs'] }, 'permissions: tabs'],
    ['optional_permissions', { optional_permissions: ['history'] }, 'optional_permissions: history'],
    ['host_permissions', { host_permissions: ['<all_urls>'] }, 'host_permissions: <all_urls>'],
    [
      'optional_host_permissions',
      { optional_host_permissions: [...manifestJson.optional_host_permissions, 'https://*/*'] },
      'optional_host_permissions: https://*/*',
    ],
    [
      'content script matches',
      {
        content_scripts: [
          ...manifestJson.content_scripts,
          { matches: ['https://mail.google.com/*'], js: ['content.js'] },
        ],
      },
      'content_scripts matches: https://mail.google.com/*',
    ],
    [
      'externally_connectable pages',
      { externally_connectable: { matches: ['https://xomoni.com/*', 'https://evil.example/*'] } },
      'externally_connectable: page https://evil.example/*',
    ],
    [
      'externally_connectable extensions',
      { externally_connectable: { matches: ['https://xomoni.com/*'], ids: ['*'] } },
      'externally_connectable: extension *',
    ],
    [
      'web_accessible_resources',
      { web_accessible_resources: [{ resources: ['dashboard.html'], matches: ['https://x.com/*'] }] },
      'web_accessible_resources: dashboard.html for https://x.com/*',
    ],
    [
      'a connect-src host',
      {
        content_security_policy: {
          extension_pages: CSP.replace("connect-src 'self'", "connect-src 'self' https://evil.example"),
        },
      },
      'content_security_policy extension_pages connect-src: https://evil.example',
    ],
    [
      'a script-src source',
      {
        content_security_policy: {
          extension_pages: CSP.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'"),
        },
      },
      "content_security_policy extension_pages script-src: 'wasm-unsafe-eval'",
    ],
    [
      'a directive left out, now covered only by default-src',
      { content_security_policy: { extension_pages: CSP.replace("form-action 'none';", '') } },
      'content_security_policy extension_pages form-action: no longer restricted',
    ],
    [
      'the whole policy',
      { content_security_policy: undefined },
      'content_security_policy extension_pages: no policy any more',
    ],
    ['incognito', { incognito: 'spanning' }, 'incognito: spanning'],
  ])('refuses more %s', (_, change, expected) => {
    expect(widerAccess(running(), next(change))).toContain(expected);
  });

  it('counts a directive that falls back to a looser default-src', () => {
    const old = { content_security_policy: { extension_pages: "default-src 'self'; img-src 'self'" } };
    const loose = { content_security_policy: { extension_pages: "default-src 'self' https:; img-src 'self'" } };
    const wider = widerAccess(old, loose);
    expect(wider).toContain('content_security_policy extension_pages default-src: https:');
    expect(wider).toContain('content_security_policy extension_pages connect-src: https:');
    expect(wider).not.toContain('content_security_policy extension_pages img-src: https:');
  });

  it('counts a sandbox policy, and Manifest V2’s plain string, like any other', () => {
    expect(
      widerAccess(
        { content_security_policy: { sandbox: "sandbox allow-scripts; script-src 'self'" } },
        { content_security_policy: { sandbox: "sandbox allow-scripts allow-popups; script-src 'self'" } },
      ),
    ).toEqual(['content_security_policy sandbox sandbox: allow-popups']);
    // Directives that fall back to script-src (worker-src, script-src-elem…) widen with it.
    const v2 = widerAccess(
      { content_security_policy: "script-src 'self'" },
      { content_security_policy: 'script-src *' },
    );
    expect(v2).toContain('content_security_policy extension_pages script-src: *');
    expect(v2).toContain('content_security_policy extension_pages worker-src: *');
  });

  it('counts a resource opened to an extension, or by a dynamic URL, and Manifest V2’s plain list', () => {
    const old = { web_accessible_resources: [{ resources: ['a.png'], matches: ['https://x.com/*'] }] };
    expect(widerAccess(old, { web_accessible_resources: [{ resources: ['a.png'], extension_ids: ['abc'] }] })).toEqual([
      'web_accessible_resources: a.png for extension abc',
    ]);
    expect(
      widerAccess(old, {
        web_accessible_resources: [{ resources: ['a.png'], matches: ['https://x.com/*'], use_dynamic_url: true }],
      }),
    ).toEqual(['web_accessible_resources: a.png for a dynamic URL']);
    expect(widerAccess({}, { web_accessible_resources: ['a.png'] })).toEqual([
      'web_accessible_resources: "a.png" for every page',
    ]);
  });

  it('counts the TLS channel id, and an externally_connectable that isn’t an object', () => {
    const old = { externally_connectable: { matches: ['https://xomoni.com/*'] } };
    expect(
      widerAccess(old, { externally_connectable: { matches: ['https://xomoni.com/*'], accepts_tls_channel_id: true } }),
    ).toEqual(['externally_connectable: the TLS channel id']);
    expect(widerAccess(old, { externally_connectable: true })).toEqual(['externally_connectable: anything (true)']);
  });

  it('compares entries that aren’t strings by their JSON, so they can’t slip through', () => {
    expect(widerAccess({ permissions: ['storage'] }, { permissions: ['storage', { name: 'tabs' }] })).toEqual([
      'permissions: {"name":"tabs"}',
    ]);
  });

  it('reads a policy’s directives, the first of each, in lower case', () => {
    expect(parseCsp("Default-Src 'self';  img-src a b ; img-src c;")).toEqual(
      new Map([
        ['default-src', ["'self'"]],
        ['img-src', ['a', 'b']],
      ]),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REPORT_BYTES, MAX_REPORTS, cspViolations, handleCspReport, readLimited } from './csp-report';

/** A report as Chrome's Reporting API sends it (`application/reports+json`). */
function reportingApi(body: Record<string, unknown>, type = 'csp-violation') {
  return { type, age: 10, url: 'https://xomoni.com/login', user_agent: 'Chrome', body };
}

/** A report as `report-uri` sends it (`application/csp-report`). */
const legacy = (body: Record<string, unknown>) => ({ 'csp-report': body });

/** A POST of `body` to the report endpoint. */
function post(body: BodyInit | null, type = 'application/reports+json', headers: Record<string, string> = {}) {
  return new Request('https://xomoni.com/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': type, ...headers },
    body,
  });
}

/** A body streamed in chunks, with no Content-Length, as a client that lies about size might send. */
function streamed(bytes: number, chunk = 4096): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunk, bytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('cspViolations (#147)', () => {
  it('reads the Reporting API format and keeps only csp-violation entries', () => {
    const violations = cspViolations([
      reportingApi({
        documentURL: 'https://xomoni.com/reset-password?code=secret#x',
        blockedURL: 'https://evil.example/x.js?token=abc',
        effectiveDirective: 'script-src-elem',
        disposition: 'enforce',
        sample: '',
      }),
      reportingApi({ documentURL: 'https://xomoni.com/' }, 'deprecation'),
      'junk',
      reportingApi('not an object' as unknown as Record<string, unknown>),
    ]);
    expect(violations).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'https://evil.example/x.js',
        page: 'https://xomoni.com/reset-password',
        disposition: 'enforce',
        sample: '',
      },
    ]);
  });

  it('reads the older report-uri format', () => {
    expect(
      cspViolations(
        legacy({
          'document-uri': 'https://xomoni.com/login?next=/account',
          'violated-directive': 'require-trusted-types-for',
          'blocked-uri': 'trusted-types-sink',
          disposition: 'enforce',
          'script-sample': 'Element innerHTML|<img src=x onerror=alert(1)>',
        }),
      ),
    ).toEqual([
      {
        directive: 'require-trusted-types-for',
        blocked: 'trusted-types-sink',
        page: 'https://xomoni.com/login',
        disposition: 'enforce',
        sample: 'Element innerHTML|<img src=x onerror=alert(1)>',
      },
    ]);
  });

  it('prefers the effective directive, and keeps keywords such as inline and eval as they are', () => {
    const [violation] = cspViolations(
      legacy({ 'effective-directive': 'script-src-elem', 'violated-directive': 'script-src', 'blocked-uri': 'inline' }),
    );
    expect(violation).toMatchObject({ directive: 'script-src-elem', blocked: 'inline' });
  });

  it('cuts every field short and drops values that aren’t strings', () => {
    const [violation] = cspViolations(
      legacy({ 'document-uri': 42, 'blocked-uri': 'x'.repeat(5000), 'script-sample': { evil: true } }),
    );
    expect(violation!.page).toBe('');
    expect(violation!.sample).toBe('');
    expect(violation!.blocked).toHaveLength(200);
  });

  it('keeps no query from a URL it can’t parse', () => {
    const [violation] = cspViolations(legacy({ 'document-uri': 'https://[bad/reset?code=secret' }));
    expect(violation!.page).toBe('https://[bad/reset');
  });

  it(`logs at most ${MAX_REPORTS} reports from one request`, () => {
    const many = Array.from({ length: 500 }, () => reportingApi({ effectiveDirective: 'img-src' }));
    expect(cspViolations(many)).toHaveLength(MAX_REPORTS);
  });

  it.each([null, 7, 'text', {}, { 'csp-report': 'x' }, { 'csp-report': [] }])('finds nothing in %j', (payload) => {
    expect(cspViolations(payload)).toEqual([]);
  });
});

describe('readLimited', () => {
  it('reads a body within the limit', async () => {
    expect(await readLimited(post('hello'), 10)).toBe('hello');
    expect(await readLimited(new Request('https://xomoni.com/', { method: 'POST' }), 10)).toBe('');
  });

  it('refuses a body whose declared length is over the limit without reading it', async () => {
    const request = post('x', 'application/json', { 'content-length': String(MAX_REPORT_BYTES + 1) });
    expect(await readLimited(request, MAX_REPORT_BYTES)).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });

  it('stops reading a streamed body that grows over the limit', async () => {
    const request = new Request('https://xomoni.com/', {
      method: 'POST',
      body: streamed(10 * MAX_REPORT_BYTES),
      duplex: 'half',
    } as RequestInit);
    expect(await readLimited(request, MAX_REPORT_BYTES)).toBeNull();
  });

  it('decodes text split across chunks', async () => {
    const bytes = new TextEncoder().encode('سلام');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 3));
        controller.enqueue(bytes.slice(3));
        controller.close();
      },
    });
    const request = new Request('https://xomoni.com/', { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(await readLimited(request, 100)).toBe('سلام');
  });
});

describe('POST /api/csp-report (#147)', () => {
  it('logs each violation without its query and answers 204', async () => {
    const response = await handleCspReport(
      post(
        JSON.stringify([
          reportingApi({
            documentURL: 'https://xomoni.com/reset-password?code=secret',
            effectiveDirective: 'require-trusted-types-for',
            blockedURL: 'trusted-types-sink',
            disposition: 'enforce',
          }),
        ]),
      ),
    );
    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledTimes(1);
    const [label, logged] = vi.mocked(console.warn).mock.calls[0]!;
    expect(label).toBe('csp violation');
    expect(logged).toContain('require-trusted-types-for');
    expect(logged).not.toContain('secret');
  });

  it('accepts the older format and its content type, with parameters', async () => {
    const body = JSON.stringify(legacy({ 'effective-directive': 'img-src', 'blocked-uri': 'https://x.example/a.png' }));
    expect((await handleCspReport(post(body, 'application/csp-report; charset=utf-8'))).status).toBe(204);
    expect((await handleCspReport(post(body, 'Application/JSON'))).status).toBe(204);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('refuses a body over the limit with 413 and logs nothing', async () => {
    const huge = JSON.stringify([reportingApi({ sample: 'x'.repeat(MAX_REPORT_BYTES) })]);
    expect((await handleCspReport(post(huge))).status).toBe(413);
    const lying = new Request('https://xomoni.com/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/reports+json' },
      body: streamed(MAX_REPORT_BYTES * 4),
      duplex: 'half',
    } as RequestInit);
    expect((await handleCspReport(lying)).status).toBe(413);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('refuses another content type with 415', async () => {
    expect((await handleCspReport(post('{}', 'text/plain'))).status).toBe(415);
    expect((await handleCspReport(post('{}', ''))).status).toBe(415);
  });

  it('refuses malformed JSON with 400', async () => {
    expect((await handleCspReport(post('{not json'))).status).toBe(400);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('answers 204 to valid JSON that holds no violation, and logs nothing', async () => {
    expect((await handleCspReport(post('[]'))).status).toBe(204);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  RELEASE_ASSETS,
  RELEASE_DOWNLOADS,
  RELEASE_HOSTS,
  downloadAccess,
  downloadFile,
  releaseUrls,
} from '../src/update/download';
import { UpdateFailure } from '../src/update/problems';

/** A fetch answering `response`, as if it came from `url` after GitHub's redirect. */
const answering = (response: Response, url = `${RELEASE_ASSETS}/github-production-release-asset/1`) => {
  Object.defineProperty(response, 'url', { value: url });
  return vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(response));
};

async function failure(promise: Promise<unknown>): Promise<UpdateFailure> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof UpdateFailure) return err;
    throw err;
  }
  throw new Error('no failure');
}

describe('where a release comes from (#305)', () => {
  it('is this repository’s GitHub release of that version: the versioned zip and its signature', () => {
    expect(releaseUrls('0.5.0')).toEqual({
      zip: 'https://github.com/pirdehi/xomoni/releases/download/v0.5.0/xomoni-extension-0.5.0.zip',
      signature: 'https://github.com/pirdehi/xomoni/releases/download/v0.5.0/xomoni-extension-0.5.0.zip.sig',
    });
    expect(releaseUrls('0.5.0').zip.startsWith(RELEASE_DOWNLOADS)).toBe(true);
  });

  it('asks for GitHub only on the person’s click, and only once', async () => {
    const api = { contains: vi.fn(() => Promise.resolve(false)), request: vi.fn(() => Promise.resolve(true)) };
    expect(await downloadAccess(api)).toBe(true);
    expect(api.request).toHaveBeenCalledWith({ origins: [...RELEASE_HOSTS] });

    const granted = { contains: vi.fn(() => Promise.resolve(true)), request: vi.fn(() => Promise.resolve(true)) };
    expect(await downloadAccess(granted)).toBe(true);
    expect(granted.request).not.toHaveBeenCalled();
  });

  it('downloads nothing when the person says no, or Chrome won’t ask', async () => {
    expect(
      await downloadAccess({ contains: () => Promise.resolve(false), request: () => Promise.resolve(false) }),
    ).toBe(false);
    const noGesture = {
      contains: () => Promise.resolve(false),
      request: () => Promise.reject(new Error('This function must be called during a user gesture')),
    };
    expect(await downloadAccess(noGesture)).toBe(false);
  });
});

describe('downloading a release file (#305)', () => {
  it('reads the file into memory, sending no cookie and no referrer', async () => {
    const fetcher = answering(new Response(new Uint8Array([1, 2, 3])));
    expect(await downloadFile(releaseUrls('0.5.0').zip, 10, fetcher)).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetcher).toHaveBeenCalledWith(
      releaseUrls('0.5.0').zip,
      expect.objectContaining({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }),
    );
    expect(await downloadFile('x', 10, answering(new Response(null), `${RELEASE_DOWNLOADS}v0.5.0/x`))).toEqual(
      new Uint8Array(),
    );
  });

  it('answers null for a file the release doesn’t have', async () => {
    expect(await downloadFile('x', 10, answering(new Response(null, { status: 404 })))).toBeNull();
  });

  it('fails on another status, another host, no network, or a timeout', async () => {
    expect((await failure(downloadFile('x', 10, answering(new Response(null, { status: 500 }))))).detail).toBe(
      'GitHub answered 500',
    );
    const elsewhere = answering(new Response(new Uint8Array([1])), 'https://evil.example/zip');
    expect((await failure(downloadFile('x', 10, elsewhere))).detail).toBe('came from https://evil.example/zip');
    const offline = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect((await failure(downloadFile('x', 10, offline))).problem).toBe('download-failed');

    const hanging = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    expect((await failure(downloadFile('x', 10, hanging, 5))).problem).toBe('download-failed');
  });

  it('stops a file larger than the limit, by its header or by what arrives', async () => {
    const declared = new Response(new Uint8Array(4), { headers: { 'content-length': '1000' } });
    expect((await failure(downloadFile('x', 10, answering(declared)))).detail).toBe('larger than 10 bytes');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) controller.enqueue(new Uint8Array(4));
        controller.close();
      },
    });
    expect((await failure(downloadFile('x', 10, answering(new Response(stream))))).detail).toBe('larger than 10 bytes');
  });
});

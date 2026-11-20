// Downloading a release (#305, ADR-0033): its zip and the zip's signature, from this repository's GitHub releases and
// nowhere else. GitHub answers a release download with a redirect to its asset host, and neither sends CORS headers,
// so the dashboard needs host access to both. That access is optional in the manifest: asked for on the person's
// click, the first time, and never on install. The manifest's CSP lets extension pages reach these two places only
// (`connect-src`), and `tests/manifest.test.ts` keeps it so. No cookie is sent, and nothing about the person.
import { UpdateFailure } from './problems';

/** Where this repository's release files are, by tag: `…/download/v0.5.0/xomoni-extension-0.5.0.zip`. */
export const RELEASE_DOWNLOADS = 'https://github.com/pirdehi/xomoni/releases/download/';

/** Where GitHub serves release files from, after the redirect. */
export const RELEASE_ASSETS = 'https://release-assets.githubusercontent.com';

/** The optional host access a download needs, as `optional_host_permissions` in the manifest names it. */
export const RELEASE_HOSTS = ['https://github.com/*', 'https://release-assets.githubusercontent.com/*'] as const;

/** The largest zip downloaded; Xomoni's is under 1 MB. */
export const MAX_ZIP_BYTES = 32 * 1024 * 1024;

/** The largest signature file read; an Ed25519 signature is 64 bytes. */
export const MAX_SIGNATURE_BYTES = 1024;

/** How long a download may take before it is given up, in ms. */
export const DOWNLOAD_TIMEOUT_MS = 120_000;

/** The zip of `version` and its signature, as the release workflow attaches them (docs/RELEASING.md). */
export function releaseUrls(version: string): { zip: string; signature: string } {
  const zip = `${RELEASE_DOWNLOADS}v${version}/xomoni-extension-${version}.zip`;
  return { zip, signature: `${zip}.sig` };
}

/** The part of `chrome.permissions` a download uses; a stand-in in tests. */
export interface PermissionsApi {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
}

/**
 * Whether the dashboard may download from GitHub, asking the person (Chrome's own prompt, on their click) when it
 * may not yet. A prompt Chrome won't show (no click) counts as no.
 */
export async function downloadAccess(api: PermissionsApi): Promise<boolean> {
  const origins = [...RELEASE_HOSTS];
  try {
    return (await api.contains({ origins })) || (await api.request({ origins }));
  } catch {
    return false;
  }
}

/** Whether a response came from one of the two release hosts (an empty URL is a response made in memory). */
function fromReleaseHosts(url: string): boolean {
  return !url || url.startsWith(RELEASE_DOWNLOADS) || url.startsWith(`${RELEASE_ASSETS}/`);
}

/**
 * Downloads `url` into memory, at most `limit` bytes, giving up after `timeoutMs`. Answers null for a 404 (the
 * file isn't in the release) and throws `UpdateFailure('download-failed')` for anything else that isn't the file:
 * no network, another status, a response from another host, or more bytes than `limit`.
 */
export async function downloadFile(
  url: string,
  limit: number,
  fetcher: typeof fetch = fetch,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new UpdateFailure('download-failed', `GitHub answered ${response.status}`);
    if (!fromReleaseHosts(response.url)) throw new UpdateFailure('download-failed', `came from ${response.url}`);
    if (Number(response.headers.get('content-length') ?? 0) > limit) {
      throw new UpdateFailure('download-failed', `larger than ${limit} bytes`);
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) {
          await reader.cancel().catch(() => undefined);
          throw new UpdateFailure('download-failed', `larger than ${limit} bytes`);
        }
        chunks.push(value);
      }
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  } catch (err) {
    if (err instanceof UpdateFailure) throw err;
    throw new UpdateFailure('download-failed', String(err));
  } finally {
    clearTimeout(timer);
  }
}

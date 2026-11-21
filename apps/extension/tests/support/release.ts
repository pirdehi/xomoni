import { releaseUrls } from '../../src/update/download';
import { type ZipSpec, buildZip } from './zip';

/** What a throwaway key pair gives a test: the public key as the extension trusts keys, and a signer. */
export interface ThrowawayKeys {
  /** Base64 of the 32 raw bytes, as in `release-keys.json`. */
  publicKey: string;
  /** Ed25519 over `data`'s bytes, as the release workflow signs a zip (OpenSSL's `pkeyutl -rawin`). */
  sign(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * A throwaway Ed25519 key pair, made with Web Crypto for one test and never kept. `tooling/workflows.test.mjs` checks
 * that what OpenSSL signs in the release workflow passes this same check.
 */
export async function throwawayKeys(): Promise<ThrowawayKeys> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    publicKey: btoa(String.fromCharCode(...raw)),
    sign: async (data) => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, data)),
  };
}

/** The manifest of a test release of `version`, with `extra` fields (a `key`, another version…). */
export function releaseManifest(version: string, extra: Record<string, unknown> = {}) {
  return {
    manifest_version: 3,
    name: 'Xomoni — X Account Manager',
    version,
    background: { service_worker: 'sw.js', type: 'module' },
    content_scripts: [{ matches: ['https://x.com/*'], js: ['content.js'] }],
    ...extra,
  };
}

/** The files of a test release of `version`: the manifest last, as zip lists it, and a new hashed asset. */
export function releaseFiles(version: string, manifest: Record<string, unknown> = releaseManifest(version)): ZipSpec[] {
  return [
    { path: 'assets/dashboard-NEW123.js', data: `console.log('dashboard ${version}')` },
    { path: 'content.js', data: `// content ${version}` },
    { path: 'dashboard.html', data: '<script src="assets/dashboard-NEW123.js"></script>' },
    { path: 'icons/icon16.png', data: new Uint8Array([137, 80, 78, 71]), method: 0 },
    { path: 'sw.js', data: `// sw ${version}` },
    { path: 'manifest.json', data: JSON.stringify(manifest) },
  ];
}

/** A release zip of these files, as bytes. */
export function releaseZip(files: ZipSpec[]): Promise<Uint8Array<ArrayBuffer>> {
  return buildZip(files);
}

/** What the fake GitHub answers for one URL: bytes (200), a status, or a network failure. */
export type Served = Uint8Array<ArrayBuffer> | number | 'offline';

/**
 * A `fetch` that answers like GitHub's release downloads: the zip and its signature of `version` (as `served`
 * says), 404 for anything else, each response from the release-assets host as after GitHub's redirect. `calls`
 * lists the URLs asked for.
 */
export function fakeGitHub(version: string, served: { zip?: Served; signature?: Served }) {
  const urls = releaseUrls(version);
  const calls: string[] = [];
  const fetcher = (input: string): Promise<Response> => {
    const url = input;
    calls.push(url);
    const answer = url === urls.zip ? served.zip : url === urls.signature ? served.signature : 404;
    if (answer === 'offline' || answer === undefined) return Promise.reject(new TypeError('Failed to fetch'));
    const response = typeof answer === 'number' ? new Response(null, { status: answer }) : new Response(answer);
    Object.defineProperty(response, 'url', {
      value: `https://release-assets.githubusercontent.com/github-production-release-asset/1/${calls.length}`,
    });
    return Promise.resolve(response);
  };
  return { fetch: fetcher as unknown as typeof fetch, calls };
}

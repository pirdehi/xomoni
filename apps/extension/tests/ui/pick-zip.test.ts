import { describe, expect, it, vi } from 'vitest';
import { pickZipInDownloads } from '../../src/ui/pick-zip';

const zip = new File(['PK'], 'twitter-2026-11-08-abc.zip');

describe('pickZipInDownloads (#184)', () => {
  it('opens the system picker in Downloads, for ZIP files only, and returns the file chosen', async () => {
    const showOpenFilePicker = vi.fn(() => Promise.resolve([{ getFile: () => Promise.resolve(zip) }]));
    await expect(pickZipInDownloads({ showOpenFilePicker } as never)).resolves.toBe(zip);
    expect(showOpenFilePicker).toHaveBeenCalledWith({
      id: 'x-archive',
      startIn: 'downloads',
      excludeAcceptAllOption: true,
      types: [{ description: 'X archive (ZIP)', accept: { 'application/zip': ['.zip'] } }],
    });
  });

  it('returns null when the person closes the picker', async () => {
    const closed = () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    await expect(pickZipInDownloads({ showOpenFilePicker: closed })).resolves.toBeNull();
    await expect(pickZipInDownloads({ showOpenFilePicker: () => Promise.resolve([]) })).resolves.toBeNull();
  });

  it('leaves it to a plain file input where the picker is missing or refused', async () => {
    await expect(pickZipInDownloads({})).resolves.toBeUndefined();
    const refused = () => Promise.reject(new DOMException('Not allowed', 'SecurityError'));
    await expect(pickZipInDownloads({ showOpenFilePicker: refused })).resolves.toBeUndefined();
  });
});

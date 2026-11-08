/** The File System Access picker, which TypeScript's DOM library doesn't describe yet. */
type OpenFilePicker = (options: {
  id?: string;
  startIn?: 'downloads';
  excludeAcceptAllOption?: boolean;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle[]>;

/** Where the picker lives: `window` in the dashboard, a stand-in in tests. */
export interface PickerHost {
  showOpenFilePicker?: OpenFilePicker;
}

/**
 * Asks the person for the ZIP X sent them, opening the system picker in their Downloads folder, where Chrome saved
 * it (#184). Returns the file; `null` when they closed the picker; `undefined` when this browser has no such picker
 * or won't open it here, so the caller falls back to a plain file input.
 */
export async function pickZipInDownloads(
  host: PickerHost = window as unknown as PickerHost,
): Promise<File | null | undefined> {
  const picker = host.showOpenFilePicker;
  if (typeof picker !== 'function') return undefined;
  try {
    const [handle] = await picker.call(host, {
      id: 'x-archive',
      startIn: 'downloads',
      excludeAcceptAllOption: true,
      types: [{ description: 'X archive (ZIP)', accept: { 'application/zip': ['.zip'] } }],
    });
    return handle ? await handle.getFile() : null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    return undefined;
  }
}

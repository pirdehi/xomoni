import { vi } from 'vitest';
import { ARCHIVE_FOLDER } from '../../src/shared/x-archive';
import type { FolderHandle } from '../../src/ui/downloads-folder';

/** A folder with these files (and one subfolder), as the browser lists it; the Xomoni folder in Downloads by default. */
export function folderWith(
  files: File[],
  permission: PermissionState = 'granted',
  name = ARCHIVE_FOLDER,
): FolderHandle & {
  requestPermission: ReturnType<typeof vi.fn>;
} {
  let state = permission;
  return {
    name,
    async *values() {
      yield { kind: 'directory', name: 'twitter-2026-01-01-folder.zip' };
      for (const file of files) yield { kind: 'file', name: file.name, getFile: () => Promise.resolve(file) };
    },
    queryPermission: () => Promise.resolve(state),
    requestPermission: vi.fn(() => {
      state = 'granted';
      return Promise.resolve(state);
    }),
  };
}

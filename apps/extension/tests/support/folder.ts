import { vi } from 'vitest';
import type { FolderHandle } from '../../src/ui/downloads-folder';

/** A folder with these files (and one subfolder), as the browser lists it. */
export function folderWith(
  files: File[],
  permission: PermissionState = 'granted',
): FolderHandle & {
  requestPermission: ReturnType<typeof vi.fn>;
} {
  let state = permission;
  return {
    name: 'Downloads',
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

import type { OwnFile, OwnFolder, OwnFolderStore, OwnWritable } from '../../src/update/own-folder';

/** What can go wrong in the fake folder, to test the update's failure paths. */
export interface FolderFaults {
  /** Paths whose write fails on `close()`, as when Chrome's checks refuse a file or the disk is full. */
  failWrite?: Set<string>;
  /** Paths whose write fails every time after the first failure, so putting them back fails too. */
  failAlways?: Set<string>;
  /** Paths whose read fails. */
  failRead?: Set<string>;
  /** The permission `queryPermission` answers, and what `requestPermission` turns it into. */
  permission?: PermissionState;
  grantOnRequest?: boolean;
}

const notFound = () => new DOMException('A requested file or directory could not be found.', 'NotFoundError');
const bytes = (data: string | Uint8Array) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);

/**
 * A folder in memory that behaves like a File System Access directory handle: files by `/`-separated path, folders
 * made on demand, writes that land only on `close()`, `NotFoundError` for what isn't there. `files` is the folder's
 * content, for assertions; `writes` the order files were written in.
 */
export function memoryFolder(
  name: string,
  initial: Record<string, string | Uint8Array> = {},
  faults: FolderFaults = {},
): OwnFolder & {
  files: Map<string, Uint8Array>;
  writes: string[];
  requests: number;
} {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([path, data]) => [path, bytes(data)]));
  const dirs = new Set<string>();
  for (const path of files.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  const writes: string[] = [];
  let permission = faults.permission ?? 'granted';
  const failed = new Set<string>();

  const join = (prefix: string, part: string) => (prefix ? `${prefix}/${part}` : part);
  const checkName = (part: string) => {
    if (!part || part === '.' || part === '..' || part.includes('/') || part.includes('\\'))
      throw new TypeError(`Name is not allowed: ${part}`);
  };

  const file = (path: string): OwnFile => ({
    kind: 'file',
    name: path.split('/').at(-1)!,
    getFile: () => {
      if (faults.failRead?.has(path)) return Promise.reject(new DOMException('Read failed', 'NotReadableError'));
      const data = files.get(path);
      return data ? Promise.resolve(new Blob([data.slice()])) : Promise.reject(notFound());
    },
    createWritable: () => {
      let pending: Uint8Array | null = null;
      const writable: OwnWritable = {
        write: (data) => {
          pending = data.slice();
          return Promise.resolve();
        },
        close: () => {
          const fails =
            (faults.failWrite?.has(path) && !failed.has(path)) || (faults.failAlways?.has(path) && failed.has(path));
          if (fails) {
            failed.add(path);
            return Promise.reject(new DOMException(`Couldn’t write ${path}`, 'InvalidStateError'));
          }
          files.set(path, pending ?? new Uint8Array());
          writes.push(path);
          return Promise.resolve();
        },
        abort: () => Promise.resolve(),
      };
      return Promise.resolve(writable);
    },
  });

  const folder = (prefix: string, folderName: string): OwnFolder => ({
    kind: 'directory',
    name: folderName,
    getDirectoryHandle: (part, options) => {
      checkName(part);
      const path = join(prefix, part);
      if (files.has(path)) return Promise.reject(new DOMException('Not a folder', 'TypeMismatchError'));
      if (!dirs.has(path)) {
        if (!options?.create) return Promise.reject(notFound());
        dirs.add(path);
      }
      return Promise.resolve(folder(path, part));
    },
    getFileHandle: (part, options) => {
      checkName(part);
      const path = join(prefix, part);
      if (dirs.has(path)) return Promise.reject(new DOMException('Not a file', 'TypeMismatchError'));
      if (!files.has(path)) {
        if (!options?.create) return Promise.reject(notFound());
        // Chrome makes the file, empty, as soon as its handle is asked for with `create`.
        files.set(path, new Uint8Array());
      }
      return Promise.resolve(file(path));
    },
    removeEntry: (part) => {
      const path = join(prefix, part);
      if (!files.delete(path)) return Promise.reject(notFound());
      return Promise.resolve();
    },
    async *values() {
      const children = new Set<string>();
      for (const path of [...files.keys(), ...dirs]) {
        if (prefix && !path.startsWith(`${prefix}/`)) continue;
        const rest = prefix ? path.slice(prefix.length + 1) : path;
        children.add(rest.split('/')[0]!);
      }
      for (const child of children) {
        const path = join(prefix, child);
        yield dirs.has(path) ? folder(path, child) : file(path);
      }
    },
    queryPermission: () => Promise.resolve(permission),
    requestPermission: () => {
      root.requests++;
      if (permission === 'prompt' && faults.grantOnRequest !== false) permission = 'granted';
      return Promise.resolve(permission);
    },
  });

  const root = Object.assign(folder('', name), { files, writes, requests: 0 });
  return root;
}

/** The text of a file in a memory folder. */
export const textOf = (folder: { files: Map<string, Uint8Array> }, path: string) =>
  new TextDecoder().decode(folder.files.get(path));

/** A folder store in memory: IndexedDB can't keep a stand-in handle, which has functions. */
export function memoryStore(folder: OwnFolder | null = null): OwnFolderStore & { folder: OwnFolder | null } {
  const store = {
    folder,
    get: () => Promise.resolve(store.folder),
    set: (next: OwnFolder | null) => {
      store.folder = next;
      return Promise.resolve();
    },
  };
  return store;
}

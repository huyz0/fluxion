// Bytes the autosave keeps outside the journal (FR-FIL-007, FR-FIL-004, ADR-0024): a `BlobStore` is a tiny file system of byte strings under
// slash-separated paths. The studio backs it with OPFS (atomic writes, big values) and, for asset bytes only, with the `assets` object store where
// OPFS is absent; tests use the memory store. Snapshots and asset bytes (snapshots.ts, asset-bytes.ts) are written against this port alone.

/**
 * Byte strings under paths like `assets/<sha256>` or `versions/<doc>/<name>`.
 *
 * @public
 */
export interface BlobStore {
  /** Write `bytes` at `path`, replacing what was there; a rejection leaves the old bytes. */
  put(path: string, bytes: Uint8Array): Promise<void>;
  /** The bytes at `path`, or undefined. */
  get(path: string): Promise<Uint8Array | undefined>;
  /** The names (not paths) directly under `dir`, in no particular order. */
  list(dir: string): Promise<readonly string[]>;
  /** Remove `path`; removing what is not there is not an error. */
  remove(path: string): Promise<void>;
}

/** A path is non-empty segments of letters, digits and `-_.` (never `.` or `..` alone), so no adapter ever sees a name it could misread. */
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._-]+$/;

/** The segments of `path`; throws on one an adapter could mistake for something else. */
export function segments(path: string): string[] {
  const parts = path.split('/');
  for (const p of parts) if (!SEGMENT.test(p)) throw new RangeError(`not a storable path: ${path}`);
  return parts;
}

/**
 * A store in memory, for tests and as the last resort.
 *
 * @public
 */
export function memoryBlobs(): BlobStore {
  const files = new Map<string, Uint8Array>();
  return {
    put(path, bytes) {
      segments(path);
      files.set(path, bytes.slice());
      return Promise.resolve();
    },
    get(path) {
      segments(path);
      const held = files.get(path);
      return Promise.resolve(held?.slice());
    },
    list(dir) {
      segments(dir);
      const prefix = `${dir}/`;
      const names = new Set<string>();
      for (const key of files.keys()) if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0] ?? '');
      return Promise.resolve([...names]);
    },
    remove(path) {
      segments(path);
      files.delete(path);
      return Promise.resolve();
    },
  };
}

type Writable = { write(data: Uint8Array): Promise<void>; close(): Promise<void> };
type FileHandle = FileSystemFileHandle & { createWritable?: () => Promise<Writable> };

async function directory(root: FileSystemDirectoryHandle, parts: readonly string[], create: boolean): Promise<FileSystemDirectoryHandle | undefined> {
  let at = root;
  for (const p of parts) {
    try {
      at = await at.getDirectoryHandle(p, { create });
    } catch (e) {
      if (!create && e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return undefined;
      throw e;
    }
  }
  return at;
}

/**
 * The store on an OPFS directory. `createWritable` writes to a swap file and replaces the target when closed, so a write that dies midway leaves
 * the old bytes. A browser without it rejects each `put`, and the caller falls back.
 *
 * @public
 */
export function opfsBlobs(root: FileSystemDirectoryHandle): BlobStore {
  return {
    async put(path, bytes) {
      const parts = segments(path);
      const name = parts.pop() ?? '';
      const dir = await directory(root, parts, true);
      if (dir === undefined || typeof (FileSystemFileHandle.prototype as FileHandle).createWritable !== 'function')
        throw new DOMException('this browser cannot write files in OPFS', 'NotSupportedError');
      const handle = (await dir.getFileHandle(name, { create: true })) as FileHandle;
      const out = await (handle.createWritable as () => Promise<Writable>).call(handle);
      try {
        await out.write(bytes);
      } finally {
        await out.close();
      }
    },
    async get(path) {
      const parts = segments(path);
      const name = parts.pop() ?? '';
      const dir = await directory(root, parts, false);
      if (dir === undefined) return undefined;
      try {
        return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
      } catch (e) {
        if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return undefined;
        throw e;
      }
    },
    async list(path) {
      const dir = await directory(root, segments(path), false);
      if (dir === undefined) return [];
      const names: string[] = [];
      for await (const key of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(key);
      return names;
    },
    async remove(path) {
      const parts = segments(path);
      const name = parts.pop() ?? '';
      const dir = await directory(root, parts, false);
      try {
        await dir?.removeEntry(name);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
      }
    },
  };
}

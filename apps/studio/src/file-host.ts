// The browser side of files (FR-FIL-006, NFR-REL-001, M10.17): picking a file to open, writing a save, saving as a new file. Where the File System
// Access API exists (Chromium) a save is written through `createWritable`, which keeps the old file until the new bytes are complete (atomic);
// elsewhere a file is picked with an `<input>` and a save is a download. The decisions about what may be written over what are in file-session.ts.

/** The part of a file handle the studio uses. */
type Handle = {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
};

/** The File System Access entry points of a window, where it has them. */
type FsWindow = Window & {
  showOpenFilePicker?: (options: unknown) => Promise<Handle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<Handle>;
};

/**
 * A file the person picked.
 *
 * @public
 */
export type PickedFile = {
  /** Its name. */
  readonly name: string;
  /** Its bytes. */
  readonly bytes: Uint8Array;
  /** A handle to write it back through, where the browser allows. */
  readonly handle?: unknown;
};

/**
 * Where a save went.
 *
 * @public
 */
export type SavedTo = {
  /** The name it was saved under. */
  readonly name: string;
  /** A handle for the next save, when the browser gave one (a download has none). */
  readonly handle?: unknown;
};

/**
 * What the studio needs of the browser to open and save files.
 *
 * @public
 */
export interface FileHost {
  /** Ask the person for a file; undefined when they cancel. */
  openFile(): Promise<PickedFile | undefined>;
  /** Write `bytes` through `handle`, replacing the file only once the new bytes are all written. */
  writeOver(handle: unknown, bytes: Uint8Array): Promise<void>;
  /** Save `bytes` as a new file the person names (a download where there is no picker); undefined when they cancel. */
  saveAs(suggestedName: string, bytes: Uint8Array): Promise<SavedTo | undefined>;
  /** Whether a save can write over a file it already wrote (a handle exists), or only download again. */
  readonly canOverwrite: boolean;
}

const TYPES = [{ description: 'Fluxion files', accept: { 'application/vnd.fluxion+zip': ['.flux'], 'text/html': ['.html'], 'application/json': ['.json'] } }];

/** The bytes of `file`. */
const bytesOf = async (file: File): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer());

/** A file chosen through an `<input type=file>`; undefined when the dialog is cancelled. Settles in every case: a read that fails rejects. */
function pickWithInput(win: Window): Promise<PickedFile | undefined> {
  return new Promise((resolve, reject) => {
    const input = win.document.createElement('input');
    input.type = 'file';
    input.accept = '.flux,.html,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      try {
        resolve(file === undefined ? undefined : { name: file.name, bytes: await bytesOf(file) });
      } catch (e) {
        reject(e);
      }
    });
    input.addEventListener('cancel', () => resolve(undefined));
    // a browser without the `cancel` event gives the window its focus back when the dialog closes: with no file chosen a moment later, it was cancelled
    win.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if ((input.files?.length ?? 0) === 0) resolve(undefined);
        }, 1000);
      },
      { once: true },
    );
    input.click();
  });
}

/** `bytes` as a download named `name`. */
function download(win: Window, name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/vnd.fluxion+zip' }));
  const link = win.document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // the download has started by the next task; the URL is not needed after
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The file host of a browser window: the File System Access API where there is one, `<input>` and downloads where not.
 *
 * @public
 */
export function browserFileHost(win: Window = window): FileHost {
  const fs = win as FsWindow;
  const picker = fs.showOpenFilePicker !== undefined && fs.showSaveFilePicker !== undefined;
  return {
    canOverwrite: picker,
    async openFile() {
      if (!picker) return pickWithInput(win);
      try {
        const [handle] = (await fs.showOpenFilePicker?.({ types: TYPES })) ?? [];
        if (handle === undefined) return undefined;
        const file = await handle.getFile();
        return { name: file.name, bytes: await bytesOf(file), handle };
      } catch (e) {
        // the person closing the picker is not a failure
        if (e instanceof DOMException && e.name === 'AbortError') return undefined;
        throw e;
      }
    },
    async writeOver(handle, bytes) {
      const writable = await (handle as Handle).createWritable();
      try {
        await writable.write(new Blob([bytes.slice().buffer]));
        await writable.close();
      } catch (e) {
        await writable.abort().catch(() => undefined);
        throw e;
      }
    },
    async saveAs(suggestedName, bytes) {
      if (!picker) {
        download(win, suggestedName, bytes);
        return { name: suggestedName };
      }
      try {
        const handle = await fs.showSaveFilePicker?.({ suggestedName, types: [TYPES[0]] });
        if (handle === undefined) return undefined;
        await this.writeOver(handle, bytes);
        return { name: handle.name, handle };
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return undefined;
        throw e;
      }
    },
  };
}

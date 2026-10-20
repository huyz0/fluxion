import type { Page } from '@playwright/test';

export type Picker = { readonly name: string; readonly b64: string };

/**
 * Give the page a File System Access API that works in memory (any engine: the studio only looks for the two functions): the open picker
 * offers `file`, the save picker hands out a new handle, and every file written through a handle is kept for the test to read. With `file`
 * undefined the API is removed, which is what Firefox and Safari have: a file is picked with an input and a save is a download.
 */
export async function pickers(page: Page, file: Picker | undefined): Promise<void> {
  await page.addInitScript((f) => {
    const w = window as unknown as { __writes: { name: string; blob: Blob }[]; showOpenFilePicker?: unknown; showSaveFilePicker?: unknown };
    w.__writes = [];
    if (f === undefined) {
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined, configurable: true });
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      return;
    }
    const handle = (name: string, bytes: Uint8Array) => ({
      name,
      getFile: async () => new File([bytes.slice().buffer], name),
      createWritable: async () => {
        const chunks: Blob[] = [];
        return {
          write: async (blob: Blob) => void chunks.push(blob),
          close: async () => void w.__writes.push({ name, blob: new Blob(chunks) }),
          abort: async () => undefined,
        };
      },
    });
    // decoded once as the page loads, not on each pick: a real picker hands over the bytes, and a perf spec times from the click
    const text = atob(f.b64);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    w.showOpenFilePicker = async () => [handle(f.name, bytes)];
    w.showSaveFilePicker = async (options: { suggestedName: string }) => handle(options.suggestedName, new Uint8Array());
  }, file);
}

/** What was written through handles, by file name. */
export async function writes(page: Page): Promise<{ name: string; bytes: Uint8Array }[]> {
  const found = await page.evaluate(async () => {
    const all = (window as unknown as { __writes: { name: string; blob: Blob }[] }).__writes;
    return Promise.all(
      all.map(async (w) => {
        const buffer = new Uint8Array(await w.blob.arrayBuffer());
        let binary = '';
        for (const b of buffer) binary += String.fromCharCode(b);
        return { name: w.name, b64: btoa(binary) };
      }),
    );
  });
  return found.map((w) => ({ name: w.name, bytes: Uint8Array.from(Buffer.from(w.b64, 'base64')) }));
}

export const asPicker = (name: string, bytes: Uint8Array | string): Picker => ({ name, b64: Buffer.from(bytes).toString('base64') });

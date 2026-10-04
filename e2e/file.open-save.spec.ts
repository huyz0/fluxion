import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor.js';
import { fluxFileOf, newerMajorJson, titleOf } from './pages/flux-files.js';
import { expect, test } from './test.js';

type Picker = { readonly name: string; readonly b64: string };

/**
 * Give the page a File System Access API that works in memory (any engine: the studio only looks for the two functions): the open picker
 * offers `file`, the save picker hands out a new handle, and every file written through a handle is kept for the test to read. With `file`
 * undefined the API is removed, which is what Firefox and Safari have: a file is picked with an input and a save is a download.
 */
async function pickers(page: Page, file: Picker | undefined): Promise<void> {
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
    w.showOpenFilePicker = async () => [
      handle(
        f.name,
        Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)),
      ),
    ];
    w.showSaveFilePicker = async (options: { suggestedName: string }) => handle(options.suggestedName, new Uint8Array());
  }, file);
}

/** What was written through handles, by file name. */
async function writes(page: Page): Promise<{ name: string; bytes: Uint8Array }[]> {
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

const asPicker = (name: string, bytes: Uint8Array | string): Picker => ({ name, b64: Buffer.from(bytes).toString('base64') });
const detailsDialog = (page: Page) => page.getByRole('dialog', { name: 'Document details' });

/** Set the title of the open document through the details dialog (a real edit, one undo step). */
async function retitle(page: Page, editor: EditorPage, title: string): Promise<void> {
  await editor.root.getByRole('button', { name: 'Document details', exact: true }).click();
  const form = detailsDialog(page);
  await form.getByLabel('Title').fill(title);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
}

// dialogs with text fields and file pickers: desktop input
test.describe('opening and saving files', { tag: '@desktop' }, () => {
  test('FR-FIL-006: a .flux opens from the picker, an edit is saved over the same file through its handle, and the saved file has the edit', async ({
    page,
  }) => {
    await pickers(page, asPicker('minimal.flux', await fluxFileOf('minimal')));
    const editor = new EditorPage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await expect(page).toHaveURL(/\/edit\/file-\d+$/);
    await editor.screens.first().waitFor();
    await retitle(page, editor, 'Edited in the studio');
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
    const [written, ...rest] = await writes(page);
    // one write, through the opened file's own handle, complete and loadable
    expect(rest).toHaveLength(0);
    expect(written?.name).toBe('minimal.flux');
    expect(await titleOf(written?.bytes ?? new Uint8Array())).toBe('Edited in the studio');
    // Ctrl/Cmd+S is Save too
    await retitle(page, editor, 'Edited twice');
    await page.keyboard.press('ControlOrMeta+s');
    await expect.poll(async () => (await writes(page)).length).toBe(2);
    expect(await titleOf((await writes(page))[1]?.bytes ?? new Uint8Array())).toBe('Edited twice');
  });

  test('NFR-PORT-003: a file of a newer major version opens read-only, says so, and Save never writes over it: it asks for a copy', async ({ page }) => {
    await pickers(page, asPicker('future.flux.json', newerMajorJson('minimal')));
    const editor = new EditorPage(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await editor.screens.first().waitFor();
    const bar = page.getByRole('group', { name: 'File' });
    await expect(bar.getByRole('status')).toContainText('newer version');
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(bar.getByRole('status')).toContainText('Saved future.flux.');
    const done = await writes(page);
    // the only file written is the copy; nothing was written to future.flux.json
    expect(done.map((w) => w.name)).toEqual(['future.flux']);
    expect(await titleOf(done[0]?.bytes ?? new Uint8Array())).toBe('Minimal');
    // a second Save goes on to the copy, not to the original
    await bar.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await writes(page)).map((w) => w.name)).toEqual(['future.flux', 'future.flux']);
  });

  test('FR-FIL-006: without the File System Access API a file is picked with an input and a save is a download', async ({ page }) => {
    await pickers(page, undefined);
    const editor = new EditorPage(page);
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await (await chooser).setFiles({ name: 'plain.flux', mimeType: 'application/octet-stream', buffer: Buffer.from(await fluxFileOf('minimal')) });
    await editor.screens.first().waitFor();
    await retitle(page, editor, 'Downloaded edit');
    const download = page.waitForEvent('download');
    await page.getByRole('group', { name: 'File' }).getByRole('button', { name: 'Save', exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('plain.flux');
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(await titleOf(Uint8Array.from(Buffer.concat(chunks)))).toBe('Downloaded edit');
  });

  test('FR-FIL-006: a file dropped on the page opens', async ({ page }) => {
    await pickers(page, undefined);
    const editor = new EditorPage(page);
    await page.goto('/');
    const bytes = Array.from(await fluxFileOf('minimal'));
    await page.evaluate(async (data) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(data)], 'dropped.flux'));
      for (const type of ['dragover', 'drop'])
        window.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: transfer }));
    }, bytes);
    await expect(page).toHaveURL(/\/edit\/file-\d+$/);
    await editor.screens.first().waitFor();
  });

  test('NFR-REL-001: a file that is not a Fluxion file says so, from the picker and from a drop, and nothing opens', async ({ page }) => {
    await pickers(page, asPicker('notes.txt', 'just some words'));
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'notes.txt cannot be opened' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    // a drop of the same: the message is a banner, since a drop can land anywhere
    await page.evaluate(async () => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['more words'], 'dropped.txt'));
      for (const type of ['dragover', 'drop'])
        window.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer: transfer }));
    });
    await expect(page.getByRole('alert')).toContainText('dropped.txt cannot be opened');
    await expect(page).toHaveURL(/\/$/);
  });

  test('NFR-REL-001: a picker that fails is a message, not a dead button', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showOpenFilePicker', {
        value: async () => Promise.reject(new DOMException('not allowed here', 'SecurityError')),
        configurable: true,
      });
      Object.defineProperty(window, 'showSaveFilePicker', { value: async () => Promise.reject(new DOMException('no', 'SecurityError')), configurable: true });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a file…' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'The file could not be opened: not allowed here' })).toBeVisible();
  });
});

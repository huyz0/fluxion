import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FontPicker, type FontSources } from './font-picker.js';
import { newDocument } from './new-document.js';

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const CATALOG = [
  { family: 'Fx Alpha', category: 'serif' },
  { family: 'Fx Beta', category: 'sans-serif' },
];

function setup(over: Partial<FontSources> = {}) {
  const core = createCore(newDocument(seededRandom(5)));
  const element = core.store.members('byType', 'element')[0];
  const selection = element === undefined ? [] : [element];
  const sources: FontSources = {
    bundled: ['Fx Bundled'],
    catalog: async () => CATALOG,
    addGoogle: async (family) => ({ ok: true, family }),
    upload: async (file) => (file.bytes.length === 0 ? { ok: false, message: `${file.name} is not a font` } : { ok: true, family: 'Fx Uploaded' }),
    ...over,
  };
  const onClose = vi.fn();
  return { core, selection, sources, onClose };
}

const text = () => host.textContent ?? '';
const click = async (label: string) => {
  const target = [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label);
  if (target === undefined) throw new Error(`no button ${label}`);
  await act(async () => target.click());
};

describe('<FontPicker> (FR-THM-008)', () => {
  it('FR-THM-008: the bundled tab lists families with a preview, and Use applies one to the selection', async () => {
    const { core, selection, sources, onClose } = setup();
    // no element yet: the family is ready, nothing is applied
    await act(async () => root.render(<FontPicker store={core.store} execute={core.execute} selection={[]} sources={sources} onClose={onClose} />));
    expect(text()).toContain('Fx Bundled: Hamburgefonstiv');
    await click('Use Fx Bundled');
    expect(text()).toContain('select an element to use it');
    // a screen is not an element
    expect(selection).toEqual([]);
    await act(async () =>
      root.render(
        <FontPicker store={core.store} execute={core.execute} selection={core.store.members('byType', 'screen')} sources={sources} onClose={onClose} />,
      ),
    );
    await click('Use Fx Bundled');
    expect(text()).toContain('select an element to use it');
  });

  it('FR-THM-008: the Google tab loads the catalog, narrows it by search, and adding a family applies it', async () => {
    const builder = documentBuilder({ seed: 6 });
    const element = builder.rect(builder.screen());
    const b = createCore(builder.build());
    const { sources, onClose } = setup();
    await act(async () => root.render(<FontPicker store={b.store} execute={b.execute} selection={[element]} sources={sources} onClose={onClose} />));
    await click('Google');
    await act(async () => {});
    expect(text()).toContain('Fx Alpha');
    expect(text()).toContain('Fx Beta');
    const search = host.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'beta');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(text()).not.toContain('Fx Alpha');
    await click('Add Fx Beta');
    await vi.waitFor(() => expect(text()).toContain('Fx Beta applied to the selection'));
    expect((b.store.get(element) as unknown as { style: { font: { family: string } } }).style.font.family).toBe('Fx Beta');
  });

  it('FR-THM-008: a host without Google has no Google tab; an upload that fails says why; Esc and Close close the dialog', async () => {
    const { core, selection, onClose } = setup();
    const sources: FontSources = { bundled: [], upload: async (f) => ({ ok: false, message: `${f.name} is not a font` }) };
    await act(async () => root.render(<FontPicker store={core.store} execute={core.execute} selection={selection} sources={sources} onClose={onClose} />));
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Document', 'Bundled', 'Upload']);
    expect(text()).toContain('No bundled fonts.');
    await click('Document');
    expect(text()).toContain('holds no fonts of its own');
    await click('Upload');
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([1, 2, 3])], 'photo.woff2'));
    await act(async () => {
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await vi.waitFor(() => expect(text()).toContain('photo.woff2 is not a font'));
    await click('Close');
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      host.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('FR-THM-008: the Document tab lists the families the document holds, and a failed catalog leaves an empty list', async () => {
    const { core, selection, sources, onClose } = setup({ catalog: async () => Promise.reject(new Error('offline')) });
    core.execute('asset.create', {
      asset: {
        id: 'FontAssetAlpha001',
        type: 'asset',
        hash: 'a'.repeat(64),
        mime: 'font/woff2',
        size: 1,
        name: 'a.woff2',
        font: { family: 'Fx Held', weight: 400, style: 'normal', source: 'upload', license: 'unknown' },
      },
    });
    await act(async () => root.render(<FontPicker store={core.store} execute={core.execute} selection={selection} sources={sources} onClose={onClose} />));
    await click('Document');
    expect(text()).toContain('Fx Held: Hamburgefonstiv');
    await click('Google');
    await act(async () => {});
    expect(text()).not.toContain('Loading the catalog');
    expect(host.querySelectorAll('.fx-chrome-fontrow')).toHaveLength(0);
  });

  it('FR-THM-008: while one family is added the others cannot be; a rejected add says so and frees the list; a failed catalog says so', async () => {
    const builder = documentBuilder({ seed: 9 });
    const element = builder.rect(builder.screen());
    const core = createCore(builder.build());
    let release: (outcome: { ok: true; family: string }) => void = () => {};
    const { sources, onClose } = setup({
      addGoogle: (family) =>
        family === 'Fx Alpha'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.reject(new Error('boom')),
    });
    await act(async () => root.render(<FontPicker store={core.store} execute={core.execute} selection={[element]} sources={sources} onClose={onClose} />));
    await click('Google');
    await vi.waitFor(() => expect(text()).toContain('Fx Beta'));
    await click('Add Fx Alpha');
    expect((host.querySelector('button[aria-label="Add Fx Beta"]') as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain('Adding Fx Alpha…');
    await act(async () => release({ ok: true, family: 'Fx Alpha' }));
    await vi.waitFor(() => expect(text()).toContain('Fx Alpha applied to the selection'));
    expect((host.querySelector('button[aria-label="Add Fx Beta"]') as HTMLButtonElement).disabled).toBe(false);
    await click('Add Fx Beta');
    await vi.waitFor(() => expect(text()).toContain('Fx Beta could not be added'));
    expect((host.querySelector('button[aria-label="Add Fx Beta"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('FR-THM-008: a failed catalog says so; a file over 5 MB is not read; the same file can be chosen again', async () => {
    const { core, selection, onClose } = setup();
    let reads = 0;
    const sources: FontSources = {
      bundled: [],
      catalog: () => Promise.reject(new Error('offline')),
      addGoogle: async (family) => ({ ok: true, family }),
      upload: async () => {
        reads++;
        return { ok: false, message: 'refused' };
      },
    };
    await act(async () => root.render(<FontPicker store={core.store} execute={core.execute} selection={selection} sources={sources} onClose={onClose} />));
    await click('Google');
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded'));
    await click('Upload');
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const choose = async (file: File) => {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      await act(async () => {
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await choose(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.woff2'));
    await vi.waitFor(() => expect(text()).toContain('huge.woff2 is larger than 5 MB'));
    expect(reads).toBe(0);
    // the input was emptied, so the same file chosen again fires another change
    expect(input.value).toBe('');
    await choose(new File([new Uint8Array([1, 2, 3])], 'small.woff2'));
    await vi.waitFor(() => expect(text()).toContain('refused'));
    expect(reads).toBe(1);
  });
});

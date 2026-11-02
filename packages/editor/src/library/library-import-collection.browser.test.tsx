// FR-LIB-005 FR-LIB-006 NFR-LIC-003: the library's import dialog over one Iconify collection or draw.io library (M18.210) with a fake
// importer: an Iconify collection declares nothing, a draw.io library declares its pack and one credit (no credits file), a
// collection's left-out entries are listed by name, its colors are not offered, and the panel's entries pick one file each.

import { createRegistry, type ShapeDef } from '@fluxion/core';
import type { ImportedPack } from '@fluxion/format';
import { err, ok, type TokenRef } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionLibraryConversion, CollectionLibraryInput } from './import-collection.js';
import { LibraryImportDialog } from './library-import-dialog.js';
import type { LibraryImporter } from './library-importer.js';
import { LibraryPanel } from './library-panel.js';

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

/** A fake importer whose collection conversions and registration resolve when the test says. */
function fake() {
  const pending: { resolve: (value: unknown) => void }[] = [];
  const later = <T,>() => new Promise<T>((resolve) => pending.push({ resolve: resolve as (value: unknown) => void }));
  const convert = vi.fn(() => later<Awaited<ReturnType<LibraryImporter['convert']>>>());
  const convertCollection = vi.fn((_input: CollectionLibraryInput, _declared: unknown) =>
    later<Awaited<ReturnType<NonNullable<LibraryImporter['convertCollection']>>>>(),
  );
  const register = vi.fn((_pack: ImportedPack) => later<Awaited<ReturnType<LibraryImporter['register']>>>());
  const importer: LibraryImporter = { convert, convertCollection, register, colorTokens: ['{color.accent}'] as TokenRef[] };
  const settle = (value: unknown) => act(async () => pending.shift()?.resolve(value));
  return { importer, convert, convertCollection, register, settle };
}

const field = (label: string) =>
  [...host.querySelectorAll('label')].find((l) => l.firstChild?.textContent === label)?.querySelector('input, select') as HTMLInputElement | HTMLSelectElement;
/** Set a field the way a person does. */
async function set(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name) as HTMLButtonElement;
const click = (name: string) => act(async () => button(name).click());
const text = () => host.querySelector('[role="dialog"]')?.textContent ?? '';
const refusals = () => [...host.querySelectorAll('[role="alert"] li')].map((li) => [li.getAttribute('data-path'), li.textContent]);

async function declareOwnWork() {
  await set(field('License'), 'MIT');
  await set(field('Attribution'), 'Me');
  await set(field('Author'), 'Me');
}

/** A converted collection of `count` definitions, told apart by `tag`, with `omitted` entries. */
const collection = (tag: string, omitted: { path: string; message: string }[], count = 3): CollectionLibraryConversion =>
  ({
    pack: { tag, source: { definitions: Array.from({ length: count }, (_, i) => ({ id: `lucide:${i}` })) } },
    omitted,
  }) as unknown as CollectionLibraryConversion;
const pickedFile = (name: string, bytes = 3) => ({ name, size: bytes, bytes: async () => new Uint8Array(bytes) });

describe('<LibraryImportDialog> collections (FR-LIB-005, FR-LIB-006)', () => {
  it('FR-LIB-005 NFR-LIC-003: an Iconify collection declares nothing; it converts, lists the left-out icons and registers the converted pack', async () => {
    const f = fake();
    const iconify: CollectionLibraryInput = { kind: 'iconify', item: pickedFile('lucide.json') };
    await act(async () => root.render(<LibraryImportDialog importer={f.importer} input={iconify} onClose={vi.fn()} />));
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Import Iconify collection');
    expect(text()).toContain('lucide.json');
    expect(host.querySelector('fieldset')).toBeNull();
    await click('Convert');
    expect(f.convertCollection).toHaveBeenCalledWith(iconify, undefined);
    expect(f.convert).not.toHaveBeenCalled();
    await f.settle(ok(collection('lucide', [{ path: 'broken', message: 'is not painted' }])));
    expect(text()).toContain('3 shapes are ready');
    expect(text()).toContain('1 entry is left out');
    expect([...host.querySelectorAll('.fx-chrome-import-omitted li')].map((li) => li.textContent)).toEqual(['broken: is not painted']);
    // no color mapping is offered for a collection
    expect(host.querySelector('select')).toBeNull();
    await click('Import');
    expect((f.register.mock.calls[0]?.[0] as unknown as { tag: string } | undefined)?.tag).toBe('lucide');
    expect(f.convertCollection).toHaveBeenCalledTimes(1);
    await f.settle(ok(undefined));
    expect(text()).toContain('Imported 3 shapes');
  });

  it('FR-LIB-005 NFR-LIC-003: a collection refused for its licence shows why, and nothing registers', async () => {
    const f = fake();
    await act(async () =>
      root.render(<LibraryImportDialog importer={f.importer} input={{ kind: 'iconify', item: pickedFile('closed.json') }} onClose={vi.fn()} />),
    );
    await click('Convert');
    await f.settle(err([{ path: '', message: 'collection closed declares no license; it cannot be saved portably' }]));
    expect(refusals()).toEqual([['', 'collection closed declares no license; it cannot be saved portably']]);
    expect(button('Import').disabled).toBe(true);
    expect(f.register).not.toHaveBeenCalled();
  });

  it('FR-LIB-006 NFR-LIC-003: a draw.io library declares its pack and one credit; an incomplete one is refused before converting', async () => {
    const f = fake();
    const drawio: CollectionLibraryInput = { kind: 'drawio', item: pickedFile('Network Shapes.xml') };
    await act(async () => root.render(<LibraryImportDialog importer={f.importer} input={drawio} onClose={vi.fn()} />));
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Import draw.io library');
    expect((field('Namespace') as HTMLInputElement).value).toBe('network-shapes');
    // a credits file names member paths, which a library has none of
    expect([...(field('Rights') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['original', 'upstream']);
    await click('Convert');
    expect(refusals().map(([, m]) => m)).toEqual(['Choose the license of the library.', 'Give the attribution.', "Give the author's name."]);
    expect(f.convertCollection).not.toHaveBeenCalled();
    await declareOwnWork();
    await click('Convert');
    expect(f.convertCollection).toHaveBeenCalledWith(drawio, {
      namespace: 'network-shapes',
      version: '1.0.0',
      name: 'network-shapes',
      rights: { kind: 'original', license: 'MIT', attribution: 'Me', author: 'Me' },
    });
    await f.settle(ok(collection('network', [])));
    expect(text()).toContain('3 shapes are ready');
    expect(host.querySelector('.fx-chrome-import-omitted')).toBeNull();
  });

  it('FR-LIB-005: a host without convertCollection refuses a collection before converting', async () => {
    const f = fake();
    const { convertCollection: _, ...svgOnly } = f.importer;
    await act(async () =>
      root.render(<LibraryImportDialog importer={svgOnly} input={{ kind: 'iconify', item: pickedFile('lucide.json') }} onClose={vi.fn()} />),
    );
    await click('Convert');
    expect(refusals()).toEqual([['', 'This host cannot import a collection.']]);
  });
});

describe('<LibraryPanel importer> collections (FR-LIB-005, FR-LIB-006)', () => {
  it('FR-LIB-005 FR-LIB-006: Import Iconify… and Import draw.io… show only with convertCollection, each picking one file', async () => {
    const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
    const f = fake();
    const { convertCollection: _, ...svgOnly } = f.importer;
    await act(async () => root.render(<LibraryPanel shapeDefs={shapeDefs} importer={svgOnly} />));
    expect([button('Import Iconify…'), button('Import draw.io…')]).toEqual([undefined, undefined]);
    await act(async () => root.render(<LibraryPanel shapeDefs={shapeDefs} importer={f.importer} />));
    const pickerOf = (kind: string) => host.querySelector(`button[data-import="${kind}"]`)?.nextElementSibling as HTMLInputElement;
    expect([pickerOf('iconify').multiple, pickerOf('iconify').accept]).toEqual([false, '.json,application/json']);
    expect([pickerOf('drawio').multiple, pickerOf('drawio').accept]).toEqual([false, '.xml,.drawio,application/xml,text/xml']);
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<mxlibrary>[]</mxlibrary>'], 'shapes.drawio', { type: 'application/xml' }));
    await act(async () => {
      pickerOf('drawio').files = transfer.files;
      pickerOf('drawio').dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Import draw.io library');
    expect((field('Namespace') as HTMLInputElement).value).toBe('shapes');
    await declareOwnWork();
    await click('Convert');
    const [picked] = f.convertCollection.mock.calls[0] ?? [];
    expect([picked?.kind, picked?.item.name, picked?.item.size]).toEqual(['drawio', 'shapes.drawio', 25]);
  });
});

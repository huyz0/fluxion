// FR-LIB-004 NFR-LIC-003: the library's Import SVG dialog (M18.176) with a fake importer, through every state: idle, a declaration
// refused before converting, converting, refused by member path, converted with colors and token selects, importing (re-converted
// only when a color is mapped) and imported, the final pack alone registered.

import { createRegistry, type ShapeDef } from '@fluxion/core';
import type { ImportedPack } from '@fluxion/format';
import { err, ok, type TokenRef } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SvgLibraryConversion } from './import-svg.js';
import type { SvgLibraryInput } from './import-svg-input.js';
import { LibraryImportDialog } from './library-import-dialog.js';
import type { LibraryImporter, LibraryImportRequest } from './library-importer.js';
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

const input: SvgLibraryInput = { kind: 'zip', items: [{ name: 'My Icons.zip', size: 3, bytes: async () => new Uint8Array(3) }] };
/** A converted pack of `count` definitions with `colors`, told apart by `tag`. */
const conversion = (tag: string, colors: string[], count = 2): SvgLibraryConversion =>
  ({
    pack: { tag, source: { definitions: Array.from({ length: count }, (_, i) => ({ id: `my-icons:${i}` })) } },
    colors,
    colorsOmitted: 0,
  }) as unknown as SvgLibraryConversion;

/** A fake importer whose conversions and registration resolve when the test says. */
function fake() {
  const pending: { resolve: (value: unknown) => void }[] = [];
  const later = <T,>() => new Promise<T>((resolve) => pending.push({ resolve: resolve as (value: unknown) => void }));
  const convert = vi.fn((_input: SvgLibraryInput, _request: LibraryImportRequest) => later<Awaited<ReturnType<LibraryImporter['convert']>>>());
  const register = vi.fn((_pack: ImportedPack) => later<Awaited<ReturnType<LibraryImporter['register']>>>());
  const importer: LibraryImporter = { convert, register, colorTokens: ['{color.accent}', '{color.text}'] as TokenRef[] };
  const settle = (value: unknown) => act(async () => pending.shift()?.resolve(value));
  return { importer, convert, register, settle };
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

describe('<LibraryImportDialog> (FR-LIB-004)', () => {
  it('NFR-LIC-003: idle with the namespace from the name and version 1.0.0; a declaration missing its license is refused before converting', async () => {
    const f = fake();
    await act(async () => root.render(<LibraryImportDialog importer={f.importer} input={input} onClose={vi.fn()} />));
    expect([(field('Namespace') as HTMLInputElement).value, (field('Version') as HTMLInputElement).value, (field('Name') as HTMLInputElement).value]).toEqual([
      'my-icons',
      '1.0.0',
      'my-icons',
    ]);
    // no license is chosen for the person
    expect((field('License') as HTMLSelectElement).value).toBe('');
    expect(button('Import').disabled).toBe(true);
    await set(field('Attribution'), 'Me');
    await set(field('Author'), 'Me');
    await click('Convert');
    expect(refusals()).toEqual([['', 'Choose the license of the SVGs.']]);
    expect(f.convert).not.toHaveBeenCalled();
    // an upstream source needs its SHA-256 typed
    await set(field('Rights'), 'upstream');
    await set(field('License'), 'MIT');
    await set(field('Attribution'), 'Them');
    await set(field('Source'), 'https://example.org/icons');
    await set(field('Source SHA-256'), 'abc');
    await click('Convert');
    expect(refusals()).toEqual([['', "Give the source's SHA-256 as 64 lowercase hex digits."]]);
    expect(f.convert).not.toHaveBeenCalled();
  });

  it('FR-LIB-004: converting, then each refusal by member path; nothing is registered', async () => {
    const f = fake();
    await act(async () => root.render(<LibraryImportDialog importer={f.importer} input={input} onClose={vi.fn()} />));
    await declareOwnWork();
    await click('Convert');
    expect(text()).toContain('Converting…');
    expect(button('Convert').disabled).toBe(true);
    expect(f.convert).toHaveBeenCalledWith(input, {
      namespace: 'my-icons',
      version: '1.0.0',
      name: 'my-icons',
      rights: { kind: 'original', license: 'MIT', attribution: 'Me', author: 'Me' },
    });
    await f.settle(
      err([
        { path: 'a.svg', message: 'is not painted' },
        { path: '', message: 'ZIP refused: damaged' },
      ]),
    );
    expect(refusals()).toEqual([
      ['a.svg', 'a.svg: is not painted'],
      ['', 'ZIP refused: damaged'],
    ]);
    expect(button('Import').disabled).toBe(true);
    expect(f.register).not.toHaveBeenCalled();
  });

  it('FR-LIB-004: converted with its colors; with no color mapped the one conversion is imported, and the dialog says so', async () => {
    const f = fake();
    await act(async () => root.render(<LibraryImportDialog importer={f.importer} input={input} onClose={vi.fn()} />));
    await declareOwnWork();
    await click('Convert');
    const first = conversion('first', ['#F00', 'blue']);
    await f.settle(ok(first));
    expect(text()).toContain('2 shapes are ready');
    expect([...host.querySelectorAll('[data-color]')].map((c) => c.getAttribute('data-color'))).toEqual(['#F00', 'blue']);
    const select = host.querySelector('select[aria-label="Token for #F00"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', '{color.accent}', '{color.text}']);
    await click('Import');
    expect(text()).toContain('Importing…');
    expect(f.convert).toHaveBeenCalledTimes(1);
    expect(f.register).toHaveBeenCalledWith(first.pack);
    await f.settle(ok(undefined));
    expect(text()).toContain('Imported 2 shapes');
    expect(button('Done')).toBeDefined();
  });

  it('FR-LIB-004: a mapped color re-converts with the mapping, and only that final pack is registered', async () => {
    const f = fake();
    await act(async () => root.render(<LibraryImportDialog importer={f.importer} input={input} onClose={vi.fn()} />));
    await declareOwnWork();
    await click('Convert');
    await f.settle(ok(conversion('first', ['#F00', 'blue'])));
    await set(host.querySelector('select[aria-label="Token for #F00"]') as HTMLSelectElement, '{color.accent}');
    await click('Import');
    expect(f.convert).toHaveBeenLastCalledWith(input, expect.objectContaining({ colors: { '#F00': '{color.accent}' } }));
    const final = conversion('final', ['#F00', 'blue']);
    await f.settle(ok(final));
    expect(f.register).toHaveBeenCalledTimes(1);
    expect(f.register).toHaveBeenCalledWith(final.pack);
    await f.settle(err([{ code: 'FLX_PACK_INVALID', severity: 'error', path: '', message: 'namespace my-icons is already registered' }]));
    expect(refusals()).toEqual([['', 'namespace my-icons is already registered']]);
  });

  it('NFR-LIC-003: a credits file is required, parsed before converting and passed as declared', async () => {
    const f = fake();
    await act(async () => root.render(<LibraryImportDialog importer={f.importer} input={input} onClose={vi.fn()} />));
    await set(field('Rights'), 'credits');
    await click('Convert');
    expect(refusals()).toEqual([['', 'Choose a credits file.']]);
    const credits = {
      license: 'MIT',
      attribution: 'Me',
      credits: [
        {
          id: 'mine',
          license: 'MIT',
          attribution: 'Me',
          notice: 'Me, MIT.',
          source: { kind: 'original', author: 'Me', statement: 'Mine.' },
          members: ['a.svg'],
        },
      ],
    };
    const picker = field('Credits file (JSON, notices inline)') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([JSON.stringify(credits)], 'credits.json', { type: 'application/json' }));
    await act(async () => {
      picker.files = transfer.files;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    // the file's text is read asynchronously; Convert sends the declaration once it is in
    await vi.waitFor(async () => {
      await click('Convert');
      expect(f.convert).toHaveBeenCalled();
    });
    expect(f.convert.mock.calls[0]?.[1].rights).toMatchObject({ kind: 'credits', credits: { license: 'MIT', noticeFiles: [] } });
  });

  it('NFR-LIC-003: the declaration is fixed and Esc does not close while a convert or an import runs, so the pack registered is the one shown', async () => {
    const f = fake();
    const onClose = vi.fn();
    await act(async () => root.render(<LibraryImportDialog importer={f.importer} input={input} onClose={onClose} />));
    await declareOwnWork();
    const pressEscape = () =>
      act(async () => host.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const declaration = () => ['Namespace', 'Rights', 'License', 'Author'].map((l) => field(l).matches(':disabled'));
    await click('Convert');
    expect(declaration()).toEqual([true, true, true, true]);
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    await f.settle(ok(conversion('first', [])));
    expect(declaration()).toEqual([false, false, false, false]);
    await click('Import');
    expect(declaration()).toEqual([true, true, true, true]);
    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    await f.settle(err([{ message: 'namespace my-icons is taken' }]));
    expect(refusals()).toEqual([['', 'namespace my-icons is taken']]);
    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('<LibraryPanel importer> (FR-LIB-004)', () => {
  it('FR-LIB-004: Import SVG… shows only with an importer and opens the dialog over the picked files', async () => {
    const shapeDefs = createRegistry<string, ShapeDef>('shapeDefs');
    await act(async () => root.render(<LibraryPanel shapeDefs={shapeDefs} />));
    expect(button('Import SVG…')).toBeUndefined();
    const f = fake();
    await act(async () => root.render(<LibraryPanel shapeDefs={shapeDefs} importer={f.importer} />));
    const picker = host.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.multiple).toBe(true);
    const transfer = new DataTransfer();
    transfer.items.add(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }));
    transfer.items.add(new File(['<svg/>'], 'b.svg', { type: 'image/svg+xml' }));
    await act(async () => {
      picker.files = transfer.files;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Import SVG');
    expect(text()).toContain('2 files picked');
    await declareOwnWork();
    await click('Convert');
    const [picked] = f.convert.mock.calls[0] ?? [];
    expect(picked?.kind).toBe('files');
    expect(picked?.items.map((i) => [i.name, i.size])).toEqual([
      ['a.svg', 6],
      ['b.svg', 6],
    ]);
    await f.settle(err([{ path: 'a.svg', message: 'is not painted' }]));
    await click('Cancel');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

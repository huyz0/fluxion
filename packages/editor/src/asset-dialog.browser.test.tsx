import { createCore } from '@fluxion/core';
import type { ImageCodec } from '@fluxion/format';
import { type AnyRecord, type RecordId, seededRandom } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetDialog } from './asset-dialog.js';
import { createAssetStore } from './asset-store.js';
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

const id = (s: string) => s as RecordId;
/** A 64-digit hex hash that is different for each name. */
const hashOf = (name: string): string =>
  [...name]
    .map((c) => c.charCodeAt(0).toString(16))
    .join('')
    .padEnd(64, '0');
const asset = (name: string, size: number): AnyRecord =>
  ({ id: id(name), type: 'asset', hash: hashOf(name), mime: 'image/png', size, name: `${name}.png` }) as AnyRecord;

/** A PNG header for a 40 x 30 picture, enough for the import to know what it is. */
const png = (n = 200): Uint8Array =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    0,
    0,
    0,
    40,
    0,
    0,
    0,
    30,
    8,
    6,
    0,
    0,
    0,
    ...new Array(n).fill(1),
  ]);
/** A codec that answers with a WebP of 5 bytes at the picture's size. */
const codec: ImageCodec = { toWebp: () => Promise.resolve({ bytes: Uint8Array.from([1, 2, 3, 4, 5]), width: 40, height: 30, scaled: false }) };

/** A document with one image element using `kept`, and the assets `kept`, `spare` and `other` (the last two unused). */
function setup() {
  const core = createCore(newDocument(seededRandom(31)));
  const screen = core.store.members('byType', 'screen')[0] as RecordId;
  for (const [name, size] of [
    ['kept', 5000],
    ['spare', 3000],
    ['other', 2000],
  ] as const) {
    expect(core.execute('asset.create', { asset: asset(name, size) })).toMatchObject({ ok: true });
  }
  const element = {
    id: id('image1'),
    type: 'element',
    kind: 'image',
    screenId: screen,
    index: 'a5',
    assetId: id('kept'),
    transform: { x: 0, y: 0, w: 10, h: 10 },
  };
  expect(core.execute('element.create', { element })).toMatchObject({ ok: true });
  const assets = createAssetStore((x) => (core.store.get(x as RecordId) as { readonly hash?: string } | undefined)?.hash);
  assets.set(id('kept'), 'data:image/png;base64,OLD');
  const onClose = vi.fn();
  const show = () => act(async () => root.render(<AssetDialog store={core.store} execute={core.execute} assets={assets} codec={codec} onClose={onClose} />));
  return { core, assets, onClose, show };
}
const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name) as HTMLButtonElement;
const rowOf = (name: string) => host.querySelector(`[data-asset="${name}"]`) as HTMLElement;

describe('<AssetDialog> (FR-AST-005)', () => {
  it('FR-AST-005: it lists every asset with its size and share, and says which ones nothing uses', async () => {
    const { show } = setup();
    await show();
    expect([...host.querySelectorAll('[data-asset]')].map((r) => r.getAttribute('data-asset'))).toEqual(['kept', 'spare', 'other']);
    expect(rowOf('kept').textContent).toContain('4.9 kB (50%)');
    expect(rowOf('kept').textContent).toContain('Used');
    expect(rowOf('spare').textContent).toContain('Unused');
    expect(host.textContent).toContain('3 assets, 9.8 kB in all');
    expect(button('Remove kept.png').disabled).toBe(true);
    expect(button('Remove spare.png').disabled).toBe(false);
    expect(button('Remove unused (2)').disabled).toBe(false);
  });

  it('FR-AST-005: Remove unused deletes exactly the unreferenced assets, in one undo step', async () => {
    const { core, show } = setup();
    await show();
    await act(async () => button('Remove unused (2)').click());
    expect(core.store.members('byType', 'asset')).toEqual([id('kept')]);
    expect([...host.querySelectorAll('[data-asset]')].map((r) => r.getAttribute('data-asset'))).toEqual(['kept']);
    expect(button('Remove unused (0)').disabled).toBe(true);
    // one undo brings both back
    await act(async () => void core.store.history.undo());
    expect(core.store.members('byType', 'asset').sort()).toEqual([id('kept'), id('other'), id('spare')]);
    expect(host.querySelectorAll('[data-asset]')).toHaveLength(3);
  });

  it('FR-AST-005: Remove takes away one unused asset and nothing else', async () => {
    const { core, show } = setup();
    await show();
    await act(async () => button('Remove spare.png').click());
    expect(core.store.members('byType', 'asset').sort()).toEqual([id('kept'), id('other')]);
  });

  it('FR-AST-005: Replace keeps the record and its element and changes the picture; undo shows the old bytes again, redo the new', async () => {
    const { core, assets, show } = setup();
    await show();
    const input = rowOf('kept').querySelector('input[type="file"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File([png().slice().buffer], 'new.png', { type: 'image/png' }));
    await act(async () => {
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // the import and the read of the bytes are asynchronous
      await new Promise((r) => setTimeout(r, 200));
    });
    const record = core.store.get(id('kept')) as unknown as { hash: string; mime: string; size: number; w: number; h: number };
    expect(record).toMatchObject({ mime: 'image/webp', size: 5, w: 40, h: 30 });
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.hash).not.toBe(hashOf('kept'));
    expect(assets.url(id('kept'))).toMatch(/^data:image\/webp/);
    // the element still names the same asset record
    expect((core.store.get(id('image1')) as unknown as { assetId: string }).assetId).toBe('kept');
    expect(rowOf('kept').textContent).toContain('5 B');
    // the picture belongs to the record's hash: undo takes the record back and with it the old bytes, redo the new ones
    await act(async () => void core.store.history.undo());
    expect((core.store.get(id('kept')) as unknown as { hash: string }).hash).toBe(hashOf('kept'));
    expect(assets.url(id('kept'))).toBe('data:image/png;base64,OLD');
    await act(async () => void core.store.history.redo());
    expect(assets.url(id('kept'))).toMatch(/^data:image\/webp/);
  });

  it('FR-AST-005: Replace is a real button that a keyboard reaches, and focus is in the dialog when it opens', async () => {
    const { show } = setup();
    await show();
    expect(document.activeElement?.tagName).toBe('H2');
    expect(document.activeElement?.textContent).toBe('Assets');
    const replaceButton = button('Replace kept.png');
    expect(replaceButton.tagName).toBe('BUTTON');
    expect(replaceButton.disabled).toBe(false);
    expect(replaceButton.tabIndex).toBe(0);
    replaceButton.focus();
    expect(document.activeElement).toBe(replaceButton);
    // activating it opens the file chooser of the row's input
    const input = rowOf('kept').querySelector('input[type="file"]') as HTMLInputElement;
    const clicked = vi.fn((e: Event) => e.preventDefault());
    input.addEventListener('click', clicked);
    await act(async () => replaceButton.click());
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('FR-AST-001: a replacement that is not an image is a message, and nothing changes', async () => {
    const { core, assets, show } = setup();
    await show();
    const input = rowOf('kept').querySelector('input[type="file"]') as HTMLInputElement;
    const transfer = new DataTransfer();
    transfer.items.add(new File(['%PDF-1.7'], 'doc.png', { type: 'image/png' }));
    await act(async () => {
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('not a PNG, JPEG, WebP, AVIF, GIF or SVG');
    expect((core.store.get(id('kept')) as unknown as { size: number }).size).toBe(5000);
    // nothing was put and the old bytes are still the ones held
    expect(assets.url(id('kept'))).toBe('data:image/png;base64,OLD');
  });

  it('FR-AST-005: Close and Esc end the dialog; with no assets it says so', async () => {
    const { core, onClose, show } = setup();
    await show();
    await act(async () => button('Close').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      host.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => void core.execute('element.delete', { ids: ['image1'] }));
    await act(async () => button('Remove unused (3)').click());
    expect(host.textContent).toContain('This document holds no assets.');
  });
});

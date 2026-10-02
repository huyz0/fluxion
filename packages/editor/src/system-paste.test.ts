import { createCore } from '@fluxion/core';
import { createId, type RecordId, seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createAssetStore } from './asset-store.js';
import { copyPayload, pasteInto } from './clipboard.js';
import { fitImage, pasteSystemItem, type SystemItem } from './system-paste.js';

function setup(seed = 3) {
  const b = documentBuilder({ seed: 51 + seed });
  const s = b.screen();
  const core = createCore(b.build());
  const random = seededRandom(seed);
  const assets = createAssetStore();
  const deps = { view: core.store, execute: core.execute, seal: () => core.store.history.seal(), screen: s, newId: () => createId(random), assets };
  return { core, s, assets, deps };
}
const image: SystemItem = {
  type: 'image',
  mime: 'image/png',
  name: 'p.png',
  dataUrl: 'data:image/png;base64,AAAA',
  hash: 'b'.repeat(64),
  size: 3,
  w: 1000,
  h: 500,
};
const rec = (core: ReturnType<typeof setup>['core'], id: RecordId) =>
  core.store.get(id) as unknown as Record<string, unknown> & { transform: { x: number; y: number; w: number; h: number } };

describe('system paste (FR-EDT-007, NFR-SEC-001)', () => {
  it('FR-EDT-007: plain text becomes a text element of a paragraph per line, centred, in one undo step', () => {
    const { core, deps } = setup();
    const id = pasteSystemItem(deps, { type: 'text', text: 'first\n\nthird\r\nfourth' }, { x: 400, y: 300 });
    expect(id).toBeDefined();
    const e = rec(core, id as RecordId);
    expect(e['kind']).toBe('text');
    expect(e.transform).toEqual({ x: 240, y: 300 - 64, w: 320, h: 128 });
    const lines = (e['text'] as { content: { content?: { text: string }[] }[] }).content;
    expect(lines.map((p) => p.content?.[0]?.text)).toEqual(['first', undefined, 'third', 'fourth']);
    core.store.history.undo();
    expect(core.store.get(id as RecordId)).toBeUndefined();
    expect(core.store.history.canUndo()).toBe(false);
    // one line has the minimum height
    const one = pasteSystemItem(deps, { type: 'text', text: 'x' }, { x: 0, y: 0 });
    expect(rec(core, one as RecordId).transform.h).toBe(44);
  });

  it('FR-EDT-007: an image becomes an asset and an image element fitted to 480 px, its bytes held, in one undo step', () => {
    const { core, deps, assets } = setup();
    const id = pasteSystemItem(deps, image, { x: 400, y: 300 });
    const e = rec(core, id as RecordId);
    expect(e['kind']).toBe('image');
    expect(e.transform).toEqual({ x: 160, y: 300 - 120, w: 480, h: 240 });
    const asset = core.store.get(e['assetId'] as RecordId) as unknown as Record<string, unknown>;
    expect(asset).toMatchObject({ type: 'asset', hash: 'b'.repeat(64), mime: 'image/png', size: 3, name: 'p.png', w: 1000, h: 500 });
    expect(assets.url(e['assetId'] as RecordId)).toBe(image.dataUrl);
    // the same bytes again use the asset the document holds
    const again = pasteSystemItem(deps, image, { x: 0, y: 0 });
    expect(rec(core, again as RecordId)['assetId']).toBe(e['assetId']);
    expect(core.store.members('byType', 'asset')).toHaveLength(1);
    core.store.history.undo();
    expect(core.store.get(again as RecordId)).toBeUndefined();
    core.store.history.undo();
    expect(core.store.get(id as RecordId)).toBeUndefined();
    expect(core.store.members('byType', 'asset')).toHaveLength(0);
  });

  it('FR-EDT-007: an image with no pixel size gets the default one; nothing is written without a screen', () => {
    const { core, deps } = setup();
    expect(fitImage(undefined, 5)).toEqual({ w: 240, h: 160 });
    expect(fitImage(0, 5)).toEqual({ w: 240, h: 160 });
    expect(fitImage(100, 50)).toEqual({ w: 100, h: 50 });
    expect(fitImage(480, 480)).toEqual({ w: 480, h: 480 });
    expect(fitImage(240, 960)).toEqual({ w: 120, h: 480 });
    const bare = pasteSystemItem(deps, { ...image, w: undefined, h: undefined }, { x: 0, y: 0 });
    expect(rec(core, bare as RecordId).transform).toMatchObject({ w: 240, h: 160 });
    expect(core.store.get(rec(core, bare as RecordId)['assetId'] as RecordId)).not.toHaveProperty('w');
    expect(pasteSystemItem({ ...deps, screen: undefined }, image, { x: 0, y: 0 })).toBeUndefined();
    expect(pasteSystemItem({ ...deps, screen: undefined }, { type: 'text', text: 'x' }, { x: 0, y: 0 })).toBeUndefined();
  });

  it('FR-EDT-007: a copied image with its bytes pastes into another document as a new asset holding them, once', () => {
    const one = setup();
    const id = pasteSystemItem(one.deps, image, { x: 0, y: 0 });
    const payload = copyPayload(one.core.store, [id as RecordId], { docId: 'a', screen: one.s, assetData: one.assets.url });
    expect(payload?.assets).toHaveLength(1);
    expect(payload?.assets[0]?.dataUrl).toBe(image.dataUrl);
    // another document: the asset is made there with a fresh id, its bytes held, the element points at it
    const two = setup(40);
    const ids = pasteInto(two.deps, payload as never, { x: 0, y: 0 });
    const pasted = rec(two.core, (ids ?? [])[0] as RecordId);
    const newAsset = pasted['assetId'] as RecordId;
    expect(newAsset).not.toBe(rec(one.core, id as RecordId)['assetId']);
    expect(two.core.store.get(newAsset)).toMatchObject({ type: 'asset', hash: 'b'.repeat(64) });
    expect(two.assets.url(newAsset)).toBe(image.dataUrl);
    // pasting again finds the asset by its hash
    const again = pasteInto(two.deps, payload as never, { x: 16, y: 16 });
    expect(rec(two.core, (again ?? [])[0] as RecordId)['assetId']).toBe(newAsset);
    expect(two.core.store.members('byType', 'asset')).toHaveLength(1);
    // without bytes and not held, the image cannot be pasted (the document refuses a reference to no asset): it is left
    // out, with what hangs from it, and what else was copied is pasted
    const bare = copyPayload(one.core.store, [id as RecordId], { docId: 'a', screen: one.s });
    expect(bare?.assets[0]).not.toHaveProperty('dataUrl');
    const three = setup(41);
    expect(pasteInto(three.deps, bare as never, { x: 0, y: 0 })).toBeUndefined();
    expect(three.core.store.members('byType', 'element')).toHaveLength(0);
    expect(three.core.store.members('byType', 'asset')).toHaveLength(0);
    const four = setup(42);
    pasteInto({ ...four.deps, assets: undefined }, payload as never, { x: 0, y: 0 });
    expect(four.core.store.members('byType', 'asset')).toHaveLength(0);
  });
  it('FR-EDT-007: of a copy with an image whose asset is missing, the rest is pasted: the image, what hangs from it and its bindings are left out', () => {
    const one = setup();
    const image1 = pasteSystemItem(one.deps, image, { x: 0, y: 0 }) as RecordId;
    const note = pasteSystemItem(one.deps, { type: 'text', text: 'keep me' }, { x: 100, y: 0 }) as RecordId;
    const payload = copyPayload(one.core.store, [image1, note], { docId: 'a', screen: one.s });
    const two = setup(50);
    const ids = pasteInto(two.deps, payload as never, { x: 0, y: 0 });
    expect(ids).toHaveLength(1);
    expect(rec(two.core, (ids ?? [])[0] as RecordId)['kind']).toBe('text');
    expect(two.core.store.members('byType', 'element')).toHaveLength(1);
  });
  it('NFR-SEC-001: the SVG bytes of a pasted payload are sanitised again, and bytes the editor lacks for a held asset are filled in', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><rect width="1" height="1"/></svg>';
    const hostile = { ...image, mime: 'image/svg+xml', name: 'p.svg', dataUrl: `data:image/svg+xml;base64,${btoa(svg)}`, hash: 'c'.repeat(64) };
    const one = setup();
    const id = pasteSystemItem(one.deps, hostile, { x: 0, y: 0 }) as RecordId;
    const payload = copyPayload(one.core.store, [id], { docId: 'a', screen: one.s, assetData: one.assets.url });
    const two = setup(60);
    const ids = pasteInto(two.deps, payload as never, { x: 0, y: 0 });
    const held = two.assets.url(rec(two.core, (ids ?? [])[0] as RecordId)['assetId'] as RecordId) ?? '';
    const text = atob(held.slice(held.indexOf(',') + 1));
    expect(text).toContain('<rect');
    expect(text).not.toMatch(/script|onload/);
    // a document that holds the asset record but whose editor lacks the bytes gets them from the payload
    const three = setup(61);
    const first = pasteInto(three.deps, payload as never, { x: 0, y: 0 });
    const assetId = rec(three.core, (first ?? [])[0] as RecordId)['assetId'] as RecordId;
    const empty = createAssetStore();
    pasteInto({ ...three.deps, assets: empty }, payload as never, { x: 16, y: 16 });
    expect(empty.url(assetId)).toBeDefined();
    expect(three.core.store.members('byType', 'asset')).toHaveLength(1);
  });
});

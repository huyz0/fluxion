import { createCore } from '@fluxion/core';
import { createId, seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it, vi } from 'vitest';
import { createAssetStore } from './asset-store.js';
import { isImageFile, placeImageFiles } from './place-images.js';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function setup() {
  const b = documentBuilder({ seed: 311 });
  const screen = b.screen();
  const core = createCore(b.build());
  const random = seededRandom(5);
  const deps = {
    view: core.store,
    execute: core.execute,
    seal: () => core.store.history.seal(),
    screen,
    newId: () => createId(random),
    assets: createAssetStore(),
  };
  const images = () => core.store.members('byType', 'element').filter((id) => (core.store.get(id) as unknown as { kind?: string }).kind === 'image');
  return { core, deps, images };
}

describe('putting image files in the document (FR-AST-001)', () => {
  it('FR-AST-001: files are placed a step apart and the last one placed is returned; a refused file is told and the rest still go in', async () => {
    const { core, deps, images } = setup();
    const notify = vi.fn();
    const files = [
      new File([PNG], 'one.png', { type: 'image/png' }),
      new File(['not a picture'], 'bad.png', { type: 'image/png' }),
      new File([PNG], 'two.png', { type: 'image/png' }),
    ];
    const last = await placeImageFiles(deps, files, { x: 400, y: 300 }, notify);
    expect(images()).toHaveLength(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatch(/^bad\.png: /);
    // the third file (index 2) is the last placed, at the staggered centre: 48 px on from the first
    const placed = core.store.get(last as never) as unknown as { transform: { x: number; y: number; w: number; h: number } };
    expect(Math.abs(placed.transform.x + placed.transform.w / 2 - 448)).toBeLessThanOrEqual(1);
    // the same picture twice is one asset
    expect(core.store.members('byType', 'asset')).toHaveLength(1);
  });

  it('FR-AST-001: nothing placed when every file is refused', async () => {
    const { deps, images } = setup();
    const notify = vi.fn();
    expect(await placeImageFiles(deps, [new File(['x'], 'a.png', { type: 'image/png' })], { x: 0, y: 0 }, notify)).toBeUndefined();
    expect(images()).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('FR-AST-001: only files that claim to be images are ours to take', () => {
    expect(isImageFile(new File([], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isImageFile(new File([], 'a.flux', { type: '' }))).toBe(false);
    expect(isImageFile(new File([], 'a.txt', { type: 'text/plain' }))).toBe(false);
  });

  it('FR-AST-001: several refused files in one drop are told in one message, none lost', async () => {
    const { deps } = setup();
    const notify = vi.fn();
    const bad = (name: string) => new File(['nope'], name, { type: 'image/png' });
    await placeImageFiles(deps, [bad('a.png'), bad('b.png'), bad('c.png')], { x: 0, y: 0 }, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    const message = notify.mock.calls[0]?.[0] as string;
    expect(['a.png', 'b.png', 'c.png'].every((n) => message.includes(n))).toBe(true);
  });
});

import { createCore } from '@fluxion/core';
import { seededRandom } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { applyFontFamily, documentFontFamilies } from './font-apply.js';

function setup() {
  const b = documentBuilder({ seed: 11 });
  const screen = b.screen();
  const a = b.rect(screen);
  const c = b.rect(screen, { x: 300 });
  const core = createCore(b.build());
  return { core, screen, a, c };
}
const familyOf = (core: ReturnType<typeof setup>['core'], id: string) =>
  (core.store.get(id as never) as unknown as { style?: { font?: { family?: string } } }).style?.font?.family;

describe('applying a font (FR-THM-008)', () => {
  it('FR-THM-008: the family goes into the style of every selected element in one undo step, the rest of the style stays', () => {
    const { core, a, c } = setup();
    core.execute('element.update', { id: a, fields: { style: { opacity: 0.5, font: { size: 20, weight: 700 } } } });
    const depth = core.store.history.undoDepth;
    expect(applyFontFamily(core.store, core.execute, [a, c], 'Fx Face')).toBe(true);
    expect(familyOf(core, a)).toBe('Fx Face');
    expect(familyOf(core, c)).toBe('Fx Face');
    expect((core.store.get(a) as unknown as { style: { opacity: number; font: { size: number; weight: number } } }).style).toMatchObject({
      opacity: 0.5,
      font: { size: 20, weight: 700 },
    });
    expect(core.store.history.undoDepth).toBe(depth + 1);
    core.store.history.undo();
    expect(familyOf(core, a)).toBeUndefined();
    expect(familyOf(core, c)).toBeUndefined();
  });

  it('FR-THM-008: ids that are not elements, or an empty selection, apply nothing', () => {
    const { core, screen } = setup();
    const before = core.store.toDocument();
    expect(applyFontFamily(core.store, core.execute, [], 'X')).toBe(false);
    expect(applyFontFamily(core.store, core.execute, [screen, 'NoSuchRecord000' as never], 'X')).toBe(false);
    expect(core.store.toDocument()).toEqual(before);
  });

  it('FR-THM-008: the families the document holds are listed once each, in record order', () => {
    const { core } = setup();
    expect(documentFontFamilies(core.store)).toEqual([]);
    const asset = (id: string, family: string | undefined) => ({
      id: `Font${id}000000000`.slice(0, 16),
      type: 'asset',
      hash: id
        .repeat(64)
        .slice(0, 64)
        .replace(/[^0-9a-f]/g, 'a'),
      mime: 'font/woff2',
      size: 1,
      name: `${id}.woff2`,
      ...(family === undefined ? {} : { font: { family, weight: 400, style: 'normal', source: 'upload', license: 'unknown' } }),
    });
    for (const [i, f] of ['Alpha', 'Beta', 'Alpha', undefined].entries()) core.execute('asset.create', { asset: asset(String(i), f) });
    expect(documentFontFamilies(core.store)).toEqual(['Alpha', 'Beta']);
    expect(seededRandom(1)).toBeDefined();
  });
});

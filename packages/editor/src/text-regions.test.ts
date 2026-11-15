// FR-SHP-007: the editor's side of text regions and icon slots (M19.17). A double-click picks the region under it (the first
// region is the element's text); the inspector fills or empties an icon slot; and the Problems tab reports a `texts` entry
// naming the first region, which no region draws, with a fix that removes it.
import { createCore, type ShapeDef } from '@fluxion/core';
import type { DocumentFile, RecordId, ShapeElement } from '@fluxion/schema';
import { documentBuilder, plainText } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { problemsOf } from './problems.js';
import { regionProblems } from './region-problems.js';
import { fillSlot, slotRows } from './slot-inspector.js';
import { regionAfter, regionAt } from './text-edit.js';

const CARD: ShapeDef = {
  id: 'test:card',
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  textRegions: [
    { name: 'title', x: 0.32, y: 0.06, w: 0.62, h: 0.28 },
    { name: 'body', x: 0.06, y: 0.38, w: 0.88, h: 0.4 },
  ],
  iconSlots: [
    { name: 'icon', x: 0.06, y: 0.06, w: 0.2, h: 0.28 },
    { name: 'badge', x: 0.8, y: 0.8, w: 0.1, h: 0.1 },
  ],
  defaultSize: { w: 200, h: 100 },
};
const defs = { get: (id: string) => (id === CARD.id ? CARD : undefined) };

/** One card 200x100 at (100, 100) with `fields` merged in, and the core over it. */
function card(fields: Record<string, unknown> = {}) {
  const b = documentBuilder({ seed: 1917 });
  const screen = b.screen();
  const id = b.rect(screen, { x: 100, y: 100, w: 200, h: 100 });
  const file = b.build();
  const records = { ...file.records, [id]: { ...(file.records[id] as object), defId: CARD.id, ...fields } } as DocumentFile['records'];
  const core = createCore({ ...file, records });
  return { core, id: id as RecordId, el: () => core.store.get(id) as ShapeElement };
}

describe('text regions and icon slots in the editor (FR-SHP-007)', () => {
  it('FR-SHP-007: a point picks the region after the first under it; the first region, outside any, or a plain shape picks none', () => {
    const { el } = card();
    // the body spans 112..288 across and 138..178 down the page
    expect(regionAt(el(), CARD, { x: 200, y: 160 })).toBe('body');
    expect(regionAt(el(), CARD, { x: 220, y: 115 })).toBeUndefined();
    expect(regionAt(el(), CARD, { x: 200, y: 195 })).toBeUndefined();
    expect(regionAt(el(), undefined, { x: 200, y: 160 })).toBeUndefined();
    // (200, 125) is in the title unturned; turned a half turn about the centre (200, 150), or flipped vertically, the body
    // spans 122..162 down the page and holds it
    expect(regionAt(el(), CARD, { x: 200, y: 125 })).toBeUndefined();
    const turned = card({ transform: { x: 100, y: 100, w: 200, h: 100, rot: 180 } });
    expect(regionAt(turned.el(), CARD, { x: 200, y: 125 })).toBe('body');
    expect(regionAt(turned.el(), CARD, { x: 200, y: 170 })).toBeUndefined();
    const flipped = card({ transform: { x: 100, y: 100, w: 200, h: 100, rot: 0, flipY: true } });
    expect(regionAt(flipped.el(), CARD, { x: 200, y: 125 })).toBe('body');
  });

  it('FR-SHP-007: the inspector lists the slots in order, fills one, and emptying the last drops the field', () => {
    const { core, id, el } = card();
    expect(slotRows(core.store, id, defs)).toEqual([{ name: 'icon' }, { name: 'badge' }]);
    const run = (c: ReturnType<typeof fillSlot>) => {
      if (c === undefined) throw new Error('no command');
      expect(core.execute(c.id, c.args).ok).toBe(true);
    };
    run(fillSlot(core.store, id, 'icon', 'test:card'));
    expect(el().icons).toEqual({ icon: { defId: 'test:card' } });
    expect(slotRows(core.store, id, defs)?.[0]).toEqual({ name: 'icon', defId: 'test:card' });
    run(fillSlot(core.store, id, 'icon', ''));
    expect(el().icons).toBeUndefined();
    // a definition without slots, or no definitions, gives no section
    expect(slotRows(core.store, id, { get: () => undefined })).toBeUndefined();
  });

  it('FR-SHP-007: a texts entry naming the first region is reported, and its fix removes only that entry', () => {
    const { core, id, el } = card({ texts: { title: plainText('Hidden'), body: plainText('Kept') } });
    const [problem, ...rest] = regionProblems(core.store.toDocument(), defs);
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ severity: 'warning', elements: [id] });
    expect(problemsOf(core.store.toDocument(), defs).map((p) => p.id)).toContain(problem?.id);
    // without the definitions, the Problems tab has nothing to read the regions from
    expect(problemsOf(core.store.toDocument()).map((p) => p.id)).not.toContain(problem?.id);
    const fix = problem?.fix;
    if (fix === undefined) throw new Error('no fix');
    expect(core.execute(fix.command, fix.args).ok).toBe(true);
    expect(el().texts).toEqual({ body: plainText('Kept') });
    expect(regionProblems(core.store.toDocument(), defs)).toEqual([]);
    // the only entry gone takes the field with it
    const only = card({ texts: { title: plainText('Hidden') } });
    const f = regionProblems(only.core.store.toDocument(), defs)[0]?.fix;
    expect(only.core.execute(f?.command ?? '', f?.args).ok).toBe(true);
    expect(only.el().texts).toBeUndefined();
  });

  it('FR-SHP-007: Tab moves on to the next region and Shift+Tab back, the first region named undefined, none past either end', () => {
    const three: ShapeDef = { ...CARD, textRegions: [...(CARD.textRegions ?? []), { name: 'caption', x: 0, y: 0.8, w: 1, h: 0.2 }] };
    expect(regionAfter(three, undefined, false)).toBe('body');
    expect(regionAfter(three, 'body', false)).toBe('caption');
    expect(regionAfter(three, 'caption', false)).toBe(false);
    expect(regionAfter(three, 'body', true)).toBeUndefined();
    expect(regionAfter(three, undefined, true)).toBe(false);
    expect(regionAfter(undefined, undefined, false)).toBe(false);
    expect(regionAfter(three, 'gone', false)).toBe(false);
  });

  it('FR-SHP-007: an icon slot naming a definition that is not available is reported, and its fix empties only that slot', () => {
    const { core, id, el } = card({ icons: { icon: { defId: 'test:missing' }, badge: { defId: 'test:card' } } });
    const problems = regionProblems(core.store.toDocument(), defs);
    expect(problems.map((p) => p.id)).toEqual([`FLX_ICON_UNKNOWN|${id}|icon`]);
    const fix = problems[0]?.fix;
    expect(core.execute(fix?.command ?? '', fix?.args).ok).toBe(true);
    expect(el().icons).toEqual({ badge: { defId: 'test:card' } });
    expect(regionProblems(core.store.toDocument(), defs)).toEqual([]);
  });
});

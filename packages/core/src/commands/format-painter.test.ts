// FR-ARR-007: the format painter (M19.12). `element.pasteStyle` copies one element's `style` as written, theme tokens included,
// to others; never `semantic` or anything else; a group passes it to its members; one undo step.
import type { AnyRecord, DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { createCore } from '../bootstrap.js';

const STYLE = { fill: '{color.accent}', stroke: { color: '#ff0000', width: 3, dash: [4, 2] }, opacity: 0.5 };

/** Source s (styled with a token, semantic slug "source"), targets t (its own style and semantic) and u (unstyled), group G of v. */
function setup() {
  const b = documentBuilder({ seed: 1913 });
  const screen = b.screen();
  const doc = b.build();
  const add = (id: string, index: string, kind: string, fields: Record<string, unknown>) => {
    (doc.records as Record<string, AnyRecord>)[id] = { id, type: 'element', kind, screenId: screen, index, ...fields } as unknown as AnyRecord;
    return id as RecordId;
  };
  const box = (x: number) => ({ x, y: 0, w: 100, h: 100, rot: 0 });
  const s = add('s', 'a0', 'shape', { defId: 'basic:rect', transform: box(0), style: STYLE, semantic: { slug: 'source', role: 'actor' } });
  const t = add('t', 'a1', 'shape', { defId: 'basic:rect', transform: box(200), style: { fill: '#00ff00' }, semantic: { slug: 'target' }, name: 'T' });
  const u = add('u', 'a2', 'shape', { defId: 'basic:ellipse', transform: box(400) });
  const g = add('G', 'a3', 'group', { transform: box(600) });
  const v = add('v', 'a0', 'shape', { defId: 'basic:rect', parentId: g, transform: box(600) });
  const plain = add('plain', 'a4', 'shape', { defId: 'basic:rect', transform: box(800) });
  const core = createCore(doc as DocumentFile);
  const at = (id: RecordId) => core.store.get(id) as unknown as Record<string, unknown>;
  return { core, s, t, u, g, v, plain, at };
}

describe('element.pasteStyle, the format painter (FR-ARR-007)', () => {
  it("FR-ARR-007: the format painter copies style with its tokens and never semantic, to a group's members too, in one undo step", () => {
    const { core, s, t, u, g, v, at } = setup();
    expect(core.execute('element.pasteStyle', { from: s, ids: [t, u, g] }).ok).toBe(true);
    for (const id of [t, u, v]) expect(at(id)['style']).toEqual(STYLE);
    expect([at(t)['semantic'], at(t)['name'], at(u)['semantic'], at(g)['style']]).toEqual([{ slug: 'target' }, 'T', undefined, undefined]);
    expect(at(s)['semantic']).toEqual({ slug: 'source', role: 'actor' });
    expect(core.store.history.undoDepth).toBe(1);
    core.store.history.undo();
    expect([at(t)['style'], at(u)['style'], at(v)['style']]).toEqual([{ fill: '#00ff00' }, undefined, undefined]);
  });

  it("FR-ARR-007: painting from an unstyled element clears the target's style; an unknown source or target is refused", () => {
    const { core, s, t, plain, at } = setup();
    expect(core.execute('element.pasteStyle', { from: plain, ids: [t] }).ok).toBe(true);
    expect(at(t)).not.toHaveProperty('style');
    for (const args of [
      { from: 'nope', ids: [t] },
      { from: s, ids: ['nope'] },
      { from: s, ids: [] },
      { from: s, ids: [s] },
    ])
      expect(core.execute('element.pasteStyle', args).ok).toBe(false);
  });

  it("FR-ARR-007: a group as the source is refused, so no target's style is cleared (M19 cp2 F6)", () => {
    const { core, g, t, u, at } = setup();
    const r = core.execute('element.pasteStyle', { from: g, ids: [t, u] });
    expect(r.ok).toBe(false);
    expect([at(t)['style'], core.store.history.undoDepth]).toEqual([{ fill: '#00ff00' }, 0]);
  });
});

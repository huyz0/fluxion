import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mergeOwned } from './merge.js';
import { applied, base, binding, document, edge, node, patched, rec, table, without, withRec } from './merge-fixture.js';
import type { Rec } from './remap.js';

describe('source view merge, fields', () => {
  it('FR-EDT-022: a text change writes the fields it changed and keeps the ones the canvas changed', () => {
    const next = patched(base(), 'a', { semantic: { slug: 'a', label: 'Alpha' } });
    // the canvas pinned a meanwhile
    const current = patched(document(), 'a', { placement: 'pinned', transform: { x: 300, y: 200, w: 160, h: 80 } });
    const result = mergeOwned({ base: base(), next, current });
    expect(result.puts.map((r) => r.id)).toEqual(['a']);
    expect(result.puts[0]).toMatchObject({ placement: 'pinned', transform: { x: 300, y: 200, w: 160, h: 80 }, semantic: { slug: 'a', label: 'Alpha' } });
    expect(result.deletes).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('FR-EDT-022: a field both the text and the canvas changed is written from the text and named as a conflict, nested fields one by one', () => {
    const next = patched(patched(base(), 'a', { semantic: { slug: 'a', label: 'Alpha' } }), 'b', {
      transform: { x: 500, y: 184, w: 160, h: 80 },
      placement: 'pinned',
    });
    const current = patched(patched(document(), 'a', { semantic: { slug: 'a', label: 'Canvas' } }), 'b', {
      placement: 'pinned',
      transform: { x: 90, y: 184, w: 300, h: 80 },
    });
    const result = mergeOwned({ base: base(), next, current });
    const after = applied(current, result);
    expect((after['a'] as Rec)['semantic']).toEqual({ slug: 'a', label: 'Alpha' });
    // x was changed by both (text wins), w only by the canvas (kept)
    expect((after['b'] as Rec)['transform']).toEqual({ x: 500, y: 184, w: 300, h: 80 });
    expect(result.conflicts).toEqual([
      { label: 'a', fields: ['semantic.label'] },
      { label: 'b', fields: ['transform.x'] },
    ]);
  });

  it('FR-EDT-022: a change the canvas made to the same value as the text is no conflict', () => {
    const next = patched(base(), 'a', { semantic: { slug: 'a', label: 'Alpha' } });
    const current = patched(document(), 'a', { semantic: { slug: 'a', label: 'Alpha' } });
    const result = mergeOwned({ base: base(), next, current });
    expect(result.conflicts).toEqual([]);
    expect(result.puts).toEqual([]);
  });

  it('FR-EDT-022: the layout reflowing an element does not move the pin the canvas gave it, but does move an element the canvas left to the layout', () => {
    const moved = { x: 80, y: 400, w: 160, h: 80 };
    const next = patched(patched(base(), 'a', { transform: moved }), 'b', { transform: moved });
    const current = patched(document(), 'a', { placement: 'pinned', transform: { x: 300, y: 200, w: 160, h: 80 } });
    const after = applied(current, mergeOwned({ base: base(), next, current }));
    expect((after['a'] as Rec)['transform']).toEqual({ x: 300, y: 200, w: 160, h: 80 });
    expect((after['b'] as Rec)['transform']).toEqual(moved);
    // a pin written in the text is the author's: it wins over the canvas pin
    const author = { x: 700, y: 400, w: 160, h: 80 };
    const second = mergeOwned({ base: base(), next: patched(base(), 'a', { placement: 'pinned', transform: author }), current });
    expect((applied(current, second)['a'] as Rec)['transform']).toEqual(author);
    expect(second.conflicts).toEqual([{ label: 'a', fields: ['transform.x', 'transform.y'] }]);
  });

  it('FR-EDT-022: the z-order index of an existing record is never written, and a field the text removed is removed', () => {
    const next = patched(patched(base(), 'a', { index: 'b5' }), 'b', { tone: undefined });
    const current = patched(document(), 'b', { tone: 'primary' });
    const result = mergeOwned({ base: patched(base(), 'b', { tone: 'primary' }), next, current });
    const after = applied(current, result);
    expect((after['a'] as Rec)['index']).toBe('a0');
    expect('tone' in (after['b'] as Rec)).toBe(false);
  });

  it('FR-EDT-022: text that compiles to the base writes nothing, whatever the canvas holds', () => {
    const current = patched(patched(document(), 'a', { placement: 'pinned', transform: { x: 1, y: 2, w: 3, h: 4 } }), 'b', { tone: 'danger' });
    const result = mergeOwned({ base: base(), next: base(), current });
    expect(result).toEqual({ puts: [], deletes: [], conflicts: [], dependents: 0, unpaired: [], remap: new Map() });
  });

  it('FR-EDT-022: merging the same text twice is a no-op the second time (property)', () => {
    const labels = fc.string({ minLength: 1, maxLength: 8 });
    fc.assert(
      fc.property(labels, fc.integer({ min: 0, max: 900 }), fc.boolean(), fc.integer({ min: 0, max: 900 }), (label, x, canvasPins, cx) => {
        const next = patched(patched(base(), 'a', { semantic: { slug: 'a', label } }), 'b', { placement: 'pinned', transform: { x, y: 184, w: 160, h: 80 } });
        const current = canvasPins ? patched(document(), 'a', { placement: 'pinned', transform: { x: cx, y: 0, w: 160, h: 80 } }) : document();
        const once = applied(current, mergeOwned({ base: base(), next, current }));
        const twice = mergeOwned({ base: next, next, current: once });
        expect(twice.puts).toEqual([]);
        expect(twice.deletes).toEqual([]);
      }),
      { seed: 12049, numRuns: 100 },
    );
  });

  it('FR-EDT-022: the merge writes exactly the fields the text changed and keeps every other one of the document (property)', () => {
    const edits = fc.record({
      label: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: undefined }),
      w: fc.option(fc.integer({ min: 10, max: 500 }), { nil: undefined }),
      tone: fc.option(fc.constantFrom('primary', 'danger', 'success'), { nil: undefined }),
    });
    fc.assert(
      fc.property(edits, edits, (text, canvas) => {
        // the text and the canvas change disjoint fields of a: the text's label and tone, the canvas's size; plus whatever `canvas.label` says, on b
        const asText = (r: Rec, e: typeof text): Rec =>
          rec({ ...r, ...(e.label === undefined ? {} : { semantic: { slug: 'a', label: e.label } }), ...(e.tone === undefined ? {} : { tone: e.tone }) });
        const next = withRec(base(), asText(base()['a'] as Rec, text));
        const current = patched(document(), 'a', { transform: { x: 80, y: 80, w: canvas.w ?? 160, h: 80 } });
        const after = applied(current, mergeOwned({ base: base(), next, current }))['a'] as Rec;
        expect((after['transform'] as { w: number }).w).toBe(canvas.w ?? 160);
        expect((after['semantic'] as { label: string }).label).toBe(text.label ?? 'A');
        expect(after['tone']).toBe(text.tone);
      }),
      { seed: 12050, numRuns: 100 },
    );
  });
});

describe('source view merge, add and delete', () => {
  it('FR-EDT-022: a node the text added is put on top of its siblings with its edge, and nothing else is written', () => {
    const added = [node('d', 'd', { index: 'a0' }), edge('e2', { index: 'a1' }), binding('e2s', 'e2', 'source', 'b'), binding('e2t', 'e2', 'target', 'd')];
    const next = { ...base(), ...table(added) };
    const current = document();
    const result = mergeOwned({ base: base(), next, current });
    expect(result.puts.map((r) => r.id).sort()).toEqual(['d', 'e2', 'e2s', 'e2t']);
    expect(result.deletes).toEqual([]);
    const after = applied(current, result);
    const roots = Object.values(after).filter((r) => r.type === 'element' && r['screenId'] === 'S' && r['parentId'] === undefined);
    const indexes = roots.map((r) => r['index']);
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(Math.max(...indexes.map(String).map((k) => k.length))).toBeGreaterThan(0);
    expect(String((after['d'] as Rec)['index']) > String((after['img-link'] as Rec)['index'])).toBe(true);
    expect(String((after['e2'] as Rec)['index']) > String((after['d'] as Rec)['index'])).toBe(true);
  });

  it('FR-EDT-022: a record that the text added under an id the document already holds is an update, not a second record', () => {
    const next = { ...base(), ...table([node('x', 'x')]) };
    const current = withRec(document(), node('x', 'x', { tone: 'danger', index: 'a7' }));
    const result = mergeOwned({ base: base(), next, current });
    expect((applied(current, result)['x'] as Rec)['index']).toBe('a7');
    expect(result.deletes).toEqual([]);
  });

  it('FR-EDT-022: a node the text deleted goes with its edge and bindings, and the records that pointed at it are removed or cleaned, and counted', () => {
    const next = without(base(), 'a', 'e', 'eb1', 'eb2');
    const current = document();
    const result = mergeOwned({ base: base(), next, current });
    const after = applied(current, result);
    for (const id of ['a', 'e', 'eb1', 'eb2', 'note-a', 'click-a', 'img-link-b']) expect(after[id], id).toBeUndefined();
    // what pointed at the image, or at b, stays; the lists lose a
    expect(after['note-img']).toBeDefined();
    expect((after['click-img'] as Rec)['actions']).toEqual([{ do: 'toggle', targets: ['b'] }]);
    expect((after['st'] as Rec)['animations']).toEqual([{ effect: 'appear', targets: ['img'] }]);
    // the image link lost its binding: counted with the comment, the interaction, the action list of click-img and the step
    expect(result.dependents).toBe(5);
    expect(after['img-link']).toBeDefined();
    expect(result.puts.map((r) => r.id).sort()).toEqual(['click-img', 'st']);
  });

  it('FR-EDT-022: a record outside the block is never written by an apply that deletes nothing it points at', () => {
    const next = patched(base(), 'b', { semantic: { slug: 'b', label: 'Beta' } });
    const result = mergeOwned({ base: base(), next, current: document() });
    expect(result.puts.map((r) => r.id)).toEqual(['b']);
    expect(result.dependents).toBe(0);
  });

  it('FR-EDT-022: deleting a group moves the elements the block does not show out of it, to the group parent, and keeps them', () => {
    const next = without(base(), 'g', 'c');
    const current = document();
    const result = mergeOwned({ base: base(), next, current });
    const after = applied(current, result);
    expect(after['g']).toBeUndefined();
    expect(after['c']).toBeUndefined();
    const kept = after['img-in-g'] as Rec;
    expect(kept).toBeDefined();
    expect('parentId' in kept).toBe(false);
    const roots = Object.values(after).filter((r) => r.type === 'element' && r['screenId'] === 'S' && r['parentId'] === undefined);
    expect(new Set(roots.map((r) => r['index'])).size).toBe(roots.length);
    // a group inside a group: the kept element goes to the nearest group left
    const nested = { ...base(), ...table([node('h', 'h', { parentId: 'g' }), rec({ ...(base()['c'] as Rec), parentId: 'g' })]) };
    const inner = withRec(
      document((all) => withRec(all, node('h', 'h', { parentId: 'g' }))),
      rec({ ...(document()['img-in-g'] as Rec), parentId: 'h' }),
    );
    const out = applied(inner, mergeOwned({ base: nested, next: without(nested, 'h'), current: inner }));
    expect((out['img-in-g'] as Rec)['parentId']).toBe('g');
  });

  it('FR-EDT-022: a record the canvas deleted stays deleted when the text did not touch it, and comes back when the text changed it, named as a conflict', () => {
    const current = without(document(), 'b');
    expect(mergeOwned({ base: base(), next: base(), current }).puts).toEqual([]);
    const next = patched(base(), 'b', { semantic: { slug: 'b', label: 'Beta' } });
    const result = mergeOwned({ base: base(), next, current });
    expect(applied(current, result)['b']).toMatchObject({ semantic: { label: 'Beta' } });
    expect(result.conflicts).toEqual([{ label: 'b', fields: ['*'] }]);
  });

  it('FR-EDT-022: the shown screen is never deleted by an apply, and a record added by the canvas that the text does not know is left alone', () => {
    const current = withRec(document(), node('canvas-made', 'canvas-made', { index: 'a8' }));
    const next = without(base(), 'S');
    const result = mergeOwned({ base: base(), next, current });
    expect(result.deletes).not.toContain('S');
    expect(result.deletes).not.toContain('canvas-made');
  });
});

describe('source view merge, nested keys the text adds or removes', () => {
  const run = (b: Record<string, unknown>, n: Record<string, unknown>, c: Record<string, unknown>) => {
    const current = patched(document(), 'a', c);
    const result = mergeOwned({ base: patched(base(), 'a', b), next: patched(base(), 'a', n), current });
    return { after: applied(current, result)['a'] as Rec, result };
  };
  const keys = ['style', 'params', 'meta'] as const;

  it('FR-EDT-022: a nested key the text adds keeps the sub-fields the canvas set, in each nested key', () => {
    for (const key of keys) {
      const { after, result } = run({ [key]: undefined }, { [key]: { stroke: 'red' } }, { [key]: { fill: 'blue' } });
      expect(after[key], key).toEqual({ fill: 'blue', stroke: 'red' });
      expect(result.conflicts, key).toEqual([]);
    }
    // a first transform: the text pins the element, the canvas had only set a size
    const t = run({ transform: undefined }, { transform: { x: 5 } }, { transform: { w: 9 } });
    expect(t.after['transform']).toEqual({ w: 9, x: 5 });
  });

  it('FR-EDT-022: a nested key the text removes removes only the sub-fields the base had, and the key goes when nothing is left', () => {
    for (const key of keys) {
      const kept = run({ [key]: { fill: 'red' } }, { [key]: undefined }, { [key]: { fill: 'red', opacity: 0.5 } });
      expect(kept.after[key], key).toEqual({ opacity: 0.5 });
      expect(kept.result.conflicts, key).toEqual([]);
      const gone = run({ [key]: { fill: 'red' } }, { [key]: undefined }, { [key]: { fill: 'red' } });
      expect(key in gone.after, key).toBe(false);
    }
  });

  it('FR-EDT-022: both adding a nested key is a conflict only at the sub-field both set to different values', () => {
    const { after, result } = run({ style: undefined }, { style: { stroke: 'red', fill: 'green' } }, { style: { fill: 'blue', opacity: 0.5 } });
    expect(after['style']).toEqual({ fill: 'green', opacity: 0.5, stroke: 'red' });
    expect(result.conflicts).toEqual([{ label: 'a', fields: ['style.fill'] }]);
  });

  it('FR-EDT-022: a nested key that is a scalar in the document is written whole, as before', () => {
    const { after } = run({ style: undefined }, { style: { stroke: 'red' } }, { style: 'legacy' });
    expect(after['style']).toEqual({ stroke: 'red' });
  });

  it('FR-EDT-022: a sub-field the text did not change always keeps the document value (property)', () => {
    const sub = fc.dictionary(fc.constantFrom('fill', 'stroke', 'opacity', 'w'), fc.integer({ min: 0, max: 5 }));
    const side = fc.option(sub, { nil: undefined });
    fc.assert(
      fc.property(side, side, side, (b, n, c) => {
        const { after } = run({ style: b }, { style: n }, { style: c });
        const [bo, no, co] = [b ?? {}, n ?? {}, c ?? {}];
        const got = (after['style'] ?? {}) as Record<string, unknown>;
        for (const f of ['fill', 'stroke', 'opacity', 'w']) {
          if (no[f] === bo[f]) expect(got[f]).toBe(co[f]);
          else expect(got[f]).toBe(no[f]);
        }
      }),
      { seed: 12051, numRuns: 200 },
    );
  });
});

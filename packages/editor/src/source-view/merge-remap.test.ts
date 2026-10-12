import { describe, expect, it } from 'vitest';
import { detectRenames, mergeOwned, type Recs } from './merge.js';
import { applied, base, binding, blockRecords, document, edge, keptRecords, node, patched, rec, table, without, withRec } from './merge-fixture.js';
import type { Rec } from './remap.js';

describe('source view merge, groups', () => {
  it('FR-EDT-022: a record the text moved into a group is put on top of that group, so no two siblings share an index', () => {
    // b and c both have index a0 in their own parents; moving b under g would make two children of g with the same index
    const first = patched(base(), 'b', { index: 'a0' });
    const next = patched(first, 'b', { parentId: 'g' });
    const current = patched(document(), 'b', { index: 'a0' });
    const after = applied(current, mergeOwned({ base: first, next, current }));
    expect(after['b']).toMatchObject({ parentId: 'g' });
    const inGroup = Object.values(after).filter((r) => r.parentId === 'g');
    expect(new Set(inGroup.map((r) => r.index)).size).toBe(inGroup.length);
  });

  it('FR-EDT-022: a node the canvas put into a group the text deletes goes up to the screen with the others, and is not deleted', () => {
    // the canvas moved a into g; the text knows nothing of it and deletes g and c
    const current = patched(document(), 'a', { parentId: 'g' });
    const result = mergeOwned({ base: base(), next: without(base(), 'g', 'c'), current });
    const after = applied(current, result);
    expect(after['a']).toBeDefined();
    expect('parentId' in (after['a'] as Rec)).toBe(false);
    expect(after['g']).toBeUndefined();
  });
});

describe('source view merge, id remap', () => {
  const renamed = (): Recs => {
    const records = blockRecords().map((r) => {
      if (r.id === 'a') return rec({ ...r, id: 'a2', semantic: { slug: 'a2', label: 'A' } });
      if (r.id === 'e') return rec({ ...r, id: 'e2' });
      if (r.id === 'eb1') return rec({ ...r, id: 'eb1b', connectorId: 'e2', elementId: 'a2' });
      if (r.id === 'eb2') return rec({ ...r, id: 'eb2b', connectorId: 'e2' });
      return r;
    });
    return table(records);
  };

  it('FR-EDT-022: a slug renamed in the text is one remap: the record keeps its canvas fields, the old id is deleted, every reference follows', () => {
    const current = patched(document(), 'a', { placement: 'pinned', transform: { x: 300, y: 200, w: 160, h: 80 } });
    const result = mergeOwned({ base: base(), next: renamed(), current });
    const after = applied(current, result);
    expect(after['a']).toBeUndefined();
    expect(after['a2']).toMatchObject({ semantic: { slug: 'a2', label: 'A' }, placement: 'pinned', transform: { x: 300, y: 200, w: 160, h: 80 } });
    expect(result.remap.get('a')).toBe('a2');
    expect(result.remap.get('e')).toBe('e2');
    expect(result.remap.get('eb1')).toBe('eb1b');
    expect(result.remap.get('eb2')).toBe('eb2b');
    expect(after['e2']).toBeDefined();
    expect(after['eb1b']).toMatchObject({ connectorId: 'e2', elementId: 'a2' });
    expect(after['eb2b']).toMatchObject({ connectorId: 'e2', elementId: 'b' });
    // the records outside the block that held the old id, one of each type
    expect(after['note-a']).toMatchObject({ targetId: 'a2' });
    expect(after['click-a']).toMatchObject({ ownerId: 'a2' });
    expect(after['click-img']).toMatchObject({
      actions: [
        { do: 'toggle', targets: ['a2', 'b'] },
        { do: 'zoomTo', target: 'a2' },
      ],
    });
    expect(after['st']).toMatchObject({ animations: [{ effect: 'appear', targets: ['a2', 'img'] }] });
    expect(after['img-link-b']).toMatchObject({ elementId: 'a2' });
    expect(result.dependents).toBe(0);
    expect(result.deletes.sort()).toEqual(['a', 'e', 'eb1', 'eb2']);
  });

  it('FR-EDT-022: an edge is matched by its ends whatever order its bindings are listed in', () => {
    const next = table(Object.values(renamed()).sort((a, b) => (b.id < a.id ? -1 : 1)));
    expect(detectRenames(base(), next).get('e')).toBe('e2');
    expect(detectRenames(base(), next).get('eb1')).toBe('eb1b');
  });

  it('FR-EDT-022: a renamed group rewrites the parent of its children, the kept ones too', () => {
    const next = table(
      blockRecords().map((r) =>
        r.id === 'g' ? rec({ ...r, id: 'g2', semantic: { slug: 'g2', label: 'G' } }) : r.id === 'c' ? rec({ ...r, parentId: 'g2' }) : r,
      ),
    );
    const current = document();
    const after = applied(current, mergeOwned({ base: base(), next, current }));
    expect(after['g']).toBeUndefined();
    expect(after['c']).toMatchObject({ parentId: 'g2' });
    expect(after['img-in-g']).toMatchObject({ parentId: 'g2' });
  });

  it('FR-EDT-022: a rename that also changes the text of the node is a rename and a change, but a renamed pair that is not alone is a delete and an add', () => {
    const labelled = patched(renamed(), 'a2', { semantic: { slug: 'a2', label: 'Other' } });
    // the label changed with the slug: not the same node any more
    expect(detectRenames(base(), labelled).has('a')).toBe(false);
    expect(detectRenames(base(), renamed()).get('a')).toBe('a2');
    const same = (id: string, index: string): Rec => node(id, id, { semantic: { slug: id, label: 'Same' }, index });
    const twins = table([same('t1', 'a0'), same('t2', 'a1')]);
    const both = table([same('u1', 'a0'), same('u2', 'a1')]);
    // identical but for the slug: which is which cannot be said
    expect(detectRenames(twins, both).size).toBe(0);
    const result = mergeOwned({ base: twins, next: both, current: withRec(withRec(document(), twins['t1'] as Rec), twins['t2'] as Rec) });
    expect(result.deletes.sort()).toEqual(['t1', 't2']);
    expect(result.puts.map((r) => r.id).sort()).toEqual(['u1', 'u2']);
    expect(result.remap.size).toBe(0);
  });

  it('FR-EDT-022: a renamed screen id is one remap of the screen: its elements, the timeline and the kept records follow', () => {
    const next = table(
      blockRecords().map((r) => (r.id === 'S' ? rec({ ...r, id: 'S2', meta: { slug: 'uno' } }) : r.screenId === 'S' ? rec({ ...r, screenId: 'S2' }) : r)),
    );
    const current = document();
    const result = mergeOwned({ base: base(), next, current });
    const after = applied(current, result);
    expect(after['S']).toBeUndefined();
    expect(after['S2']).toMatchObject({ meta: { slug: 'uno' } });
    expect(after['a']).toMatchObject({ screenId: 'S2' });
    expect(after['img']).toMatchObject({ screenId: 'S2' });
    expect(after['tl']).toMatchObject({ screenId: 'S2' });
    expect(result.remap.get('S')).toBe('S2');
  });

  it('FR-EDT-022: records made by hand, whose ids are random, are remapped to the ids their slugs derive, and every reference follows', () => {
    // the document holds the block under random ids; the base compile has the derived ones
    const random = new Map([
      ['a', 'r-a'],
      ['b', 'r-b'],
      ['e', 'r-e'],
      ['eb1', 'r-eb1'],
      ['eb2', 'r-eb2'],
    ]);
    const handMade = document((all) => {
      const ids = new Map([...random]);
      return Object.fromEntries(
        Object.values(all).map((r) => {
          const own = ids.get(r.id) ?? r.id;
          const body = JSON.parse(JSON.stringify(r).replaceAll(/"(a|b|e)"/g, (_m, id: string) => `"${ids.get(id)}"`)) as Record<string, unknown>;
          return [own, rec({ ...body, id: own })];
        }),
      );
    });
    const next = patched(base(), 'a', { semantic: { slug: 'a', label: 'Alpha' } });
    const alias = new Map(random);
    const result = mergeOwned({ base: base(), next, current: handMade, alias });
    const after = applied(handMade, result);
    for (const old of random.values()) expect(after[old], old).toBeUndefined();
    expect(after['a']).toMatchObject({ semantic: { slug: 'a', label: 'Alpha' } });
    expect(after['eb1']).toMatchObject({ connectorId: 'e', elementId: 'a' });
    expect(after['note-a']).toMatchObject({ targetId: 'a' });
    expect(after['click-img']).toMatchObject({
      actions: [
        { do: 'toggle', targets: ['a', 'b'] },
        { do: 'zoomTo', target: 'a' },
      ],
    });
    expect(result.remap.get('r-a')).toBe('a');
    expect(result.remap.size).toBe(5);
    // the second apply, with the aliases gone, finds nothing left to do
    const again = mergeOwned({ base: next, next, current: after });
    expect(again.puts).toEqual([]);
    expect(again.deletes).toEqual([]);
  });

  it('FR-EDT-022: an alias that names a record the document no longer holds, or a base id the document holds as another record, is ignored', () => {
    const result = mergeOwned({
      base: base(),
      next: base(),
      current: document(),
      alias: new Map([
        ['a', 'gone'],
        ['b', 'a'],
      ]),
    });
    expect(result.puts).toEqual([]);
    expect(result.remap.size).toBe(0);
  });
});

describe('source view merge, ambiguous renames', () => {
  const same = (id: string, index: string): Rec => node(id, id, { semantic: { slug: id, label: 'Same' }, index });

  it('FR-EDT-022: when two identical nodes cannot be told apart, the unpaired ones that lose a comment or canvas fields are named', () => {
    const twins = table([same('t1', 'a0'), same('t2', 'a1'), same('t3', 'a2')]);
    // t1 and t2 are replaced by u1 and u2 in one edit; t3 stays. t1 has a comment, t2 a canvas change, t3 is untouched
    const next = table([same('u1', 'a0'), same('u2', 'a1'), same('t3', 'a2')]);
    let current = { ...document(), ...twins };
    current = patched(current, 't2', { tone: 'danger' });
    current = withRec(current, rec({ id: 'note-t1', type: 'comment', targetId: 't1', author: 'x', body: 'b' }));
    const result = mergeOwned({ base: twins, next, current });
    expect(result.unpaired).toEqual(['t1', 't2']);
    expect(result.remap.size).toBe(0);
    expect(applied(current, result)['note-t1']).toBeUndefined();
  });

  it('FR-EDT-022: a plain delete, a clean rename and ambiguous nodes that lose nothing name nobody', () => {
    const twins = table([same('t1', 'a0'), same('t2', 'a1')]);
    const both = table([same('u1', 'a0'), same('u2', 'a1')]);
    expect(mergeOwned({ base: twins, next: both, current: { ...document(), ...twins } }).unpaired).toEqual([]);
    expect(mergeOwned({ base: base(), next: without(base(), 'b', 'e', 'eb1', 'eb2'), current: document() }).unpaired).toEqual([]);
  });

  /** The fixture block with edges a -> b, identical but for its ids, one edge and its two bindings per id given. */
  const twinEdges = (ids: readonly string[]): Recs => {
    const list = ids.flatMap((id) => [edge(id), binding(`${id}-s`, id, 'source', 'a'), binding(`${id}-t`, id, 'target', 'b')]);
    return table([...blockRecords().filter((r) => !['e', 'eb1', 'eb2'].includes(r.id)), ...list]);
  };

  it('FR-EDT-022: two connectors identical but for their ids are named by their ends when the one removed loses a comment or an interaction', () => {
    const before = twinEdges(['e1', 'e2']);
    const after = twinEdges(['e3', 'e4']);
    let current = { ...before, ...table(keptRecords()) };
    current = withRec(current, rec({ id: 'note-e1', type: 'comment', targetId: 'e1', author: 'x', body: 'on the edge' }));
    const result = mergeOwned({ base: before, next: after, current });
    expect(result.unpaired).toEqual(['a \u2192 b']);
    expect(result.remap.size).toBe(0);
    expect(applied(current, result)['note-e1']).toBeUndefined();
    // an interaction on the other twin is named the same way, and a connector of other ends is told apart by them
    const click = withRec(current, rec({ id: 'click-e2', type: 'interaction', ownerId: 'e2', trigger: { kind: 'onClick' }, actions: [] }));
    expect(mergeOwned({ base: before, next: after, current: click }).unpaired).toEqual(['a \u2192 b']);
  });

  it('FR-EDT-022: connector twins that lose nothing, and a plain connector delete, name nobody', () => {
    const before = twinEdges(['e1', 'e2']);
    const current = { ...before, ...table(keptRecords()) };
    expect(mergeOwned({ base: before, next: twinEdges(['e3', 'e4']), current }).unpaired).toEqual([]);
    expect(mergeOwned({ base: before, next: twinEdges([]), current }).unpaired).toEqual([]);
  });
});

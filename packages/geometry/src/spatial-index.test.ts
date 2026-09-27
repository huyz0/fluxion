import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { coord } from './__fixtures__/arbitraries.js';
import { type Box, boxIntersects } from './box.js';
import { createDynamicIndex, createStaticIndex, type IndexedBox } from './spatial-index.js';

/** A box on the 1e-3 grid in [-100, 100] with a size in [0, 50] (zero-size boxes included). */
const box: fc.Arbitrary<Box> = fc.record({ x: coord, y: coord, w: coord.map(Math.abs).map((v) => v / 2), h: coord.map(Math.abs).map((v) => v / 2) });
// few distinct ids, so repeats (replace) happen
const item: fc.Arbitrary<IndexedBox> = fc.record({ id: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'A', 'Z', '10', '9'), box });

/** Brute force: the last box of each id, then every id whose box intersects `q`, sorted. */
function scan(items: readonly IndexedBox[], q: Box): string[] {
  const last = new Map(items.map((i) => [i.id, i.box]));
  return [...last]
    .filter(([, b]) => boxIntersects(b, q))
    .map(([id]) => id)
    .sort();
}

const unit = (x: number, y: number): Box => ({ x, y, w: 1, h: 1 });

describe('spatial index (ADR-0141)', () => {
  it('NFR-REL-005: both spatial index adapters return identical sorted hits', () => {
    fc.assert(
      fc.property(fc.array(item, { maxLength: 60 }), fc.array(box, { minLength: 1, maxLength: 10 }), (items, queries) => {
        const dynamic = createDynamicIndex(items);
        const incremental = createDynamicIndex();
        for (const i of items) incremental.insert(i);
        const fixed = createStaticIndex(items);
        for (const q of queries) {
          const expected = scan(items, q);
          expect(dynamic.search(q)).toEqual(expected);
          expect(incremental.search(q)).toEqual(expected);
          expect(fixed.search(q)).toEqual(expected);
          expect([dynamic.collides(q), fixed.collides(q)]).toEqual([expected.length > 0, expected.length > 0]);
        }
        expect([dynamic.size, incremental.size, fixed.size]).toEqual(Array(3).fill(new Set(items.map((i) => i.id)).size));
      }),
    );
  });

  it('NFR-REL-005: removals keep the dynamic index equal to a static one of what is left', () => {
    fc.assert(
      fc.property(fc.array(item, { maxLength: 60 }), fc.array(fc.nat(), { maxLength: 20 }), box, (items, drops, q) => {
        const dynamic = createDynamicIndex(items);
        const ids = [...new Set(items.map((i) => i.id))];
        const dropped = new Set(drops.map((n) => ids[n % Math.max(1, ids.length)]));
        for (const id of dropped) if (id !== undefined) expect(dynamic.remove(id)).toBe(true);
        const left = items.filter((i) => !dropped.has(i.id));
        expect(dynamic.search(q)).toEqual(createStaticIndex(left).search(q));
        expect(dynamic.size).toBe(new Set(left.map((i) => i.id)).size);
      }),
    );
  });

  it('boxes touching at an edge or corner intersect in both adapters', () => {
    const items = [
      { id: 'left', box: unit(0, 0) },
      { id: 'corner', box: unit(2, 2) },
      { id: 'far', box: unit(5, 5) },
    ];
    const q = unit(1, 1);
    expect(createDynamicIndex(items).search(q)).toEqual(['corner', 'left']);
    expect(createStaticIndex(items).search(q)).toEqual(['corner', 'left']);
  });

  it('insert replaces an id, remove reports whether it existed, clear empties', () => {
    const index = createDynamicIndex([{ id: 'a', box: unit(0, 0) }]);
    index.insert({ id: 'a', box: unit(10, 10) });
    expect(index.size).toBe(1);
    expect(index.search(unit(0, 0))).toEqual([]);
    expect(index.search(unit(10, 10))).toEqual(['a']);
    expect(index.remove('a')).toBe(true);
    expect(index.remove('a')).toBe(false);
    index.insert({ id: 'b', box: unit(0, 0) });
    index.clear();
    expect([index.size, index.collides(unit(0, 0))]).toEqual([0, false]);
  });

  it('an empty static index finds nothing', () => {
    const index = createStaticIndex([]);
    expect([index.size, index.search(unit(0, 0)), index.collides(unit(0, 0))]).toEqual([0, [], false]);
  });
});

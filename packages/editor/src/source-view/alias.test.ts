import { describe, expect, it } from 'vitest';
import { aliasOf } from './alias.js';
import type { Recs } from './merge.js';
import type { Rec } from './remap.js';

const rec = (r: Record<string, unknown>): Rec => r as unknown as Rec;
const table = (list: readonly Rec[]): Recs => Object.fromEntries(list.map((r) => [r.id, r]));
const node = (id: string, slug: string): Rec => rec({ id, type: 'element', kind: 'shape', screenId: 'S', semantic: { slug }, index: 'a0' });
const edge = (id: string, index: string, screenId = 'S'): Rec => rec({ id, type: 'element', kind: 'connector', screenId, index });
const bind = (id: string, connectorId: string, end: string, elementId: string): Rec => rec({ id, type: 'binding', connectorId, end, elementId });

/** The base compile: nodes a and b, two edges between them (one drawn after the other), a screen. */
const base = (): Recs =>
  table([
    rec({ id: 'S', type: 'screen', index: 'a0' }),
    node('a', 'a'),
    node('b', 'b'),
    edge('e1', 'a2'),
    bind('e1s', 'e1', 'source', 'a'),
    bind('e1t', 'e1', 'target', 'b'),
    edge('e2', 'a3'),
    bind('e2s', 'e2', 'source', 'a'),
    bind('e2t', 'e2', 'target', 'b'),
  ]);

describe('source view alias', () => {
  it('FR-EDT-022: the nodes, edges, bindings and screen of a hand-made document are found by slug and by their ends, the nth edge to the nth', () => {
    // the document: random ids, an edge b -> a, the second drawn first in the table, and a third a -> b that the text does not know, on another screen too
    const doc = table([
      rec({ id: 'r-S', type: 'screen', index: 'a0' }),
      node('r-a', 'a'),
      node('r-b', 'b'),
      edge('r-e2', 'a6', 'r-S'),
      bind('r-e2s', 'r-e2', 'source', 'r-a'),
      bind('r-e2t', 'r-e2', 'target', 'r-b'),
      edge('r-e1', 'a5', 'r-S'),
      bind('r-e1s', 'r-e1', 'source', 'r-a'),
      bind('r-e1t', 'r-e1', 'target', 'r-b'),
      edge('r-back', 'a7', 'r-S'),
      bind('r-backs', 'r-back', 'source', 'r-b'),
      bind('r-backt', 'r-back', 'target', 'r-a'),
      edge('r-other', 'a1', 'T'),
      bind('r-others', 'r-other', 'source', 'r-a'),
      bind('r-othert', 'r-other', 'target', 'r-b'),
    ]);
    const slugs = new Map([
      ['r-a', 'a'],
      ['r-b', 'b'],
    ]);
    const alias = aliasOf({ base: base(), doc, slugs, screen: 'r-S' });
    expect(Object.fromEntries(alias)).toEqual({
      S: 'r-S',
      a: 'r-a',
      b: 'r-b',
      e1: 'r-e1',
      e1s: 'r-e1s',
      e1t: 'r-e1t',
      e2: 'r-e2',
      e2s: 'r-e2s',
      e2t: 'r-e2t',
    });
  });

  it('FR-EDT-022: records that already have the base ids, or a slug the base does not know, are not aliased', () => {
    const doc = table([rec({ id: 'S', type: 'screen', index: 'a0' }), node('a', 'a'), node('x', 'ghost')]);
    const alias = aliasOf({
      base: base(),
      doc,
      slugs: new Map([
        ['a', 'a'],
        ['x', 'ghost'],
      ]),
      screen: 'S',
    });
    expect(alias.size).toBe(0);
  });

  it('FR-EDT-022: the bindings are indexed once, not searched for every edge (the document is walked a constant number of times)', () => {
    const count = 300;
    const list: Rec[] = [rec({ id: 'S', type: 'screen', index: 'a0' }), node('a', 'a'), node('b', 'b')];
    const docList: Rec[] = [rec({ id: 'r-S', type: 'screen', index: 'a0' }), node('r-a', 'a'), node('r-b', 'b')];
    for (let i = 0; i < count; i++) {
      list.push(edge(`e${i}`, `a${String(i).padStart(4, '0')}`), bind(`e${i}s`, `e${i}`, 'source', 'a'), bind(`e${i}t`, `e${i}`, 'target', 'b'));
      docList.push(
        edge(`r-e${i}`, `a${String(i).padStart(4, '0')}`, 'r-S'),
        bind(`r-e${i}s`, `r-e${i}`, 'source', 'r-a'),
        bind(`r-e${i}t`, `r-e${i}`, 'target', 'r-b'),
      );
    }
    const walks = { n: 0 };
    const watch = (recs: Recs): Recs => new Proxy(recs, { ownKeys: (t) => (walks.n++, Reflect.ownKeys(t)) });
    const alias = aliasOf({
      base: watch(table(list)),
      doc: watch(table(docList)),
      slugs: new Map([
        ['r-a', 'a'],
        ['r-b', 'b'],
      ]),
      screen: 'r-S',
    });
    expect(alias.size).toBe(count * 3 + 3);
    expect(alias.get('e17t')).toBe('r-e17t');
    expect(walks.n).toBeLessThan(20);
  });
});

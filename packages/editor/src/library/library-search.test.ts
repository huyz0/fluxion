import type { ShapeDef } from '@fluxion/core';
import { describe, expect, it } from 'vitest';
import { buildLibraryIndex, entryOf, type LibraryEntry, tokensOf } from './library-search.js';

const entry = (id: string, keywords: string[] = [], category = 'Basic'): LibraryEntry => ({ id, name: id, pack: 'basic', category, keywords });
const names = (r: readonly LibraryEntry[]) => r.map((e) => e.id);

describe('library search (FR-LIB-001)', () => {
  it('FR-LIB-001: words are lower-cased, accent-folded and split on anything that is not a letter or digit', () => {
    expect(tokensOf('Café-Au_Lait, 3D Box!')).toEqual(['cafe', 'au', 'lait', '3d', 'box']);
    expect(tokensOf('  ')).toEqual([]);
  });

  it('FR-LIB-001: an entry is found by its name, pack, category or a keyword; the exact word before a prefix before the inside of a word', () => {
    const index = buildLibraryIndex([
      entry('Cylinder', ['database', 'storage']),
      entry('Databases', ['rack']),
      entry('Rectangle', ['box'], 'Shapes'),
      entry('Predatabase', ['x']),
    ]);
    // exact (keyword "database"), then prefix ("databases" is a name token), and "predatabase" is only inside
    expect(names(index.search('database'))).toEqual(['Cylinder', 'Databases']);
    expect(names(index.search('DATABASE'))).toEqual(['Cylinder', 'Databases']);
    // nothing begins with it: look inside tokens
    // (all three only inside a word: the tie goes to the name)
    expect(names(index.search('atabas'))).toEqual(['Cylinder', 'Databases', 'Predatabase']);
    expect(names(index.search('shapes'))).toEqual(['Rectangle']);
    expect(names(index.search('basic')).sort()).toEqual(['Cylinder', 'Databases', 'Predatabase', 'Rectangle']);
    expect(index.search('zzz')).toEqual([]);
  });

  it('FR-LIB-001: every word of the query must match; ranking sums the words and ties go to the name', () => {
    const index = buildLibraryIndex([
      entry('Zeta', ['arrow', 'left']),
      entry('Alpha', ['arrow', 'left']),
      entry('Beta', ['arrow']),
      entry('Gamma', ['arrowhead', 'left']),
    ]);
    expect(names(index.search('arrow left'))).toEqual(['Alpha', 'Zeta', 'Gamma']);
    expect(names(index.search('left arrow'))).toEqual(['Alpha', 'Zeta', 'Gamma']);
    // a repeated word counts once
    expect(names(index.search('arrow arrow'))).toEqual(['Alpha', 'Beta', 'Zeta', 'Gamma']);
    expect(index.search('arrow nothing')).toEqual([]);
  });

  it('FR-LIB-001: a blank query lists everything by name', () => {
    const index = buildLibraryIndex([entry('b'), entry('c'), entry('a')]);
    expect([names(index.search('')), names(index.search('  ,')), index.size]).toEqual([['a', 'b', 'c'], ['a', 'b', 'c'], 3]);
    expect(buildLibraryIndex([]).search('x')).toEqual([]);
  });

  it('FR-LIB-001: a definition becomes an entry named after its id, in its category and with its keywords', () => {
    const def = { id: 'basic:rounded-rect', outline: { path: 'M 0 0' }, defaultSize: { w: 1, h: 1 }, keywords: ['card'], category: 'Basic' } as ShapeDef;
    expect(entryOf(def)).toEqual({ id: 'basic:rounded-rect', name: 'Rounded rect', pack: 'basic', category: 'Basic', keywords: ['card'] });
    expect(entryOf({ ...def, id: 'lone', keywords: undefined, category: undefined } as unknown as ShapeDef)).toEqual({
      id: 'lone',
      name: 'Lone',
      pack: '',
      category: 'Other',
      keywords: [],
    });
    expect(names(buildLibraryIndex([entryOf(def)]).search('card'))).toEqual(['basic:rounded-rect']);
  });
});

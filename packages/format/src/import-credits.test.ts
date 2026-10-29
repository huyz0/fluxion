// NFR-LIC-003 FR-LIB-004: the declared rights of an SVG pack import (M18.174): a credits file is validated, each member in exactly
// one credit, its notice files named for the host to read, and each credit scoped to exactly its members' definitions.
import { describe, expect, it } from 'vitest';
import { type DeclaredImportCredits, type ImportRights, parseImportCredits, scopedCredits, withNotices } from './index.js';

const sha = 'a'.repeat(64);
const file = {
  license: 'MIT',
  attribution: 'Acme',
  credits: [
    {
      id: 'own',
      license: 'MIT',
      attribution: 'Acme',
      notice: 'Acme, MIT.',
      source: { kind: 'original', author: 'Acme', statement: 'Ours.' },
      members: ['b.svg'],
    },
    {
      id: 'up',
      license: 'ISC',
      attribution: 'Up',
      noticeFile: 'LICENSE-up',
      source: { kind: 'upstream', reference: 'https://example.org/up', sha256: sha },
      members: ['a.svg', 'c.svg'],
    },
  ],
};
const declared = (json: unknown): DeclaredImportCredits => {
  const parsed = parseImportCredits(json);
  if ('kind' in parsed) throw new Error(parsed.message);
  return parsed;
};

describe('parseImportCredits', () => {
  it('NFR-LIC-003: a valid file gives its credits and the notice files to read', () => {
    const d = declared(file);
    expect(d.noticeFiles).toEqual(['LICENSE-up']);
    // a file two credits name is listed once, so a host reads it once
    const shared = { ...file, credits: [{ ...file.credits[0], notice: undefined, noticeFile: 'LICENSE-up' }, file.credits[1]] };
    expect(declared(JSON.parse(JSON.stringify(shared))).noticeFiles).toEqual(['LICENSE-up']);
    expect(d.credits.map((c) => [c.id, c.members])).toEqual([
      ['own', ['b.svg']],
      ['up', ['a.svg', 'c.svg']],
    ]);
  });

  it('NFR-LIC-003: schema issues are joined; a member in two credits is named', () => {
    const both = { ...file, credits: [{ ...file.credits[0], noticeFile: 'N' }, file.credits[1]] };
    expect(parseImportCredits(both)).toEqual({ kind: 'schema', message: 'credits/0 give exactly one of notice and noticeFile' });
    expect(parseImportCredits({ license: '' })).toMatchObject({ kind: 'schema', message: expect.stringContaining('; ') });
    const twice = { ...file, credits: [file.credits[0], { ...file.credits[1], members: ['a.svg', 'b.svg'] }] };
    expect(parseImportCredits(twice)).toEqual({ kind: 'member', message: 'b.svg is in credits own and up; each member needs exactly one' });
  });
});

describe('withNotices and scopedCredits', () => {
  it('NFR-LIC-003: notice files take the texts the host read; a credit whose file has none is refused, naming both', () => {
    const rights = withNotices(declared(file), new Map([['LICENSE-up', 'ISC text']]));
    expect(typeof rights !== 'string' && rights.credits.map((c) => c.notice)).toEqual(['Acme, MIT.', 'ISC text']);
    expect(withNotices(declared(file), new Map())).toBe('cannot read notice file LICENSE-up of credit up');
  });

  it('FR-LIB-004 NFR-LIC-003: each credit is scoped to its members’ ids in code-unit order; gaps either way are refused', () => {
    const rights = withNotices(declared(file), new Map([['LICENSE-up', 'ISC text']])) as ImportRights;
    const idOf = new Map([
      ['c.svg', 'x:c'],
      ['a.svg', 'x:a'],
      ['b.svg', 'x:b'],
    ]);
    expect(scopedCredits(rights, idOf)).toMatchObject([
      { id: 'own', definitionIds: ['x:b'] },
      { id: 'up', definitionIds: ['x:a', 'x:c'] },
    ]);
    expect(scopedCredits(rights, new Map([...idOf, ['d.svg', 'x:d']]))).toBe('no credit names d.svg');
    expect(
      scopedCredits(
        rights,
        new Map([
          ['a.svg', 'x:a'],
          ['b.svg', 'x:b'],
        ]),
      ),
    ).toBe('credits name c.svg, which the input does not hold');
    expect(scopedCredits({ license: rights.license, attribution: rights.attribution, credits: rights.credits }, idOf)).toBeUndefined();
  });
});

import type { ShapeDef, ShapePackCredit, ShapePackSubset, VersionedShapePackIndex } from '@fluxion/core';
import type { QualifiedName } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { documentCredits } from './pack-credits.js';

const def = (id: string) => ({ id }) as unknown as ShapeDef;
const credit = (id: string, definitionIds?: string[]): ShapePackCredit => ({
  id,
  license: 'MIT',
  attribution: `${id} authors`,
  notice: `${id} notice`,
  source: { kind: 'original', author: `${id} authors`, statement: 'Original.' },
  ...(definitionIds === undefined ? {} : { definitionIds: definitionIds as QualifiedName[] }),
});
const saved: ShapePackSubset = {
  format: 'fluxion-shape-pack',
  formatVersion: '1.0',
  id: 'people',
  version: '1.0.0',
  license: 'MIT',
  attribution: 'Saved people',
  definitions: [def('people:person'), def('people:pair')],
  credits: [credit('all'), credit('pair-only', ['people:pair'])],
};
const lucide = {
  id: 'lucide',
  version: '2.0.0',
  name: 'Lucide icons',
  license: 'ISC AND MIT',
  attribution: 'Lucide',
  credits: [credit('lucide'), credit('feather', ['lucide:database', 'lucide:server', 'lucide:x'])],
} as unknown as VersionedShapePackIndex;
const installedPeople = { ...lucide, id: 'people', attribution: 'Installed people', credits: [credit('installed')] } as unknown as VersionedShapePackIndex;
const distribution = (index: VersionedShapePackIndex, ids: string[]) => ({ kind: 'distribution' as const, index, definitions: ids.map(def) });
const font = (id: string, definitionIds: string[]) => ({
  id,
  license: 'OFL-1.1',
  attribution: `${id} authors`,
  notice: `${id} notice`,
  source: { kind: 'original' as const, author: id, statement: 'Original.' },
  resourceIds: [`${id}-400`],
  definitionIds: definitionIds as QualifiedName[],
});

describe('the studio credits of the packs a document uses (NFR-LIC-003, ADR-0050)', () => {
  it('NFR-LIC-003: lists each used pack once, by id, with only the credits that apply to the used definitions, scoped lists trimmed', () => {
    const names = new Map([
      ['lucide', 'Lucide icons'],
      ['people', 'People'],
    ]);
    const packs = documentCredits(
      [saved],
      [distribution(lucide, ['lucide:database', 'lucide:house'])],
      ['people:person', 'lucide:database', 'lucide:house', 'basic:rect'],
      names,
    );
    expect(packs.map((p) => [p.id, p.name, p.version, p.attribution, p.credits.map((c) => [c.id, c.definitionIds])])).toEqual([
      [
        'lucide',
        'Lucide icons',
        '2.0.0',
        'Lucide',
        [
          ['lucide', undefined],
          ['feather', ['lucide:database']],
        ],
      ],
      // the scoped credit of a definition no longer used is left out
      ['people', 'People', '1.0.0', 'Saved people', [['all', undefined]]],
    ]);
  });

  it("NFR-LIC-003: a 1.1 pack's font credits are kept for the used definitions only, scoped lists trimmed", () => {
    const v11 = {
      ...saved,
      formatVersion: '1.1',
      fontResources: [],
      fontFaces: [],
      definitionFonts: [],
      fontCredits: [font('inter', ['people:person', 'people:pair']), font('mono', ['people:pair'])],
    } as unknown as ShapePackSubset;
    const [people] = documentCredits([v11], [], ['people:person']);
    expect(people?.fontCredits).toEqual([font('inter', ['people:person'])]);
    // a 1.0 pack, or one whose font is not used, has no font credits
    expect(documentCredits([saved], [], ['people:person'])[0]).not.toHaveProperty('fontCredits');
    expect(
      documentCredits([{ ...v11, fontCredits: [font('mono', ['people:pair'])] } as unknown as ShapePackSubset], [], ['people:person'])[0],
    ).not.toHaveProperty('fontCredits');
  });

  it('NFR-LIC-003, FR-LIB-004: an imported SVG library (a 1.1 distribution the save embeds) is listed by its own name, with its font credit', () => {
    const imported = {
      ...lucide,
      id: 'mine',
      name: 'My icons',
      formatVersion: '1.1',
      attribution: 'Me',
      credits: [credit('mine')],
      fontCredits: [font('inter', ['mine:label'])],
    } as unknown as VersionedShapePackIndex;
    expect(documentCredits([], [distribution(imported, ['mine:label'])], ['mine:label'])).toEqual([
      {
        id: 'mine',
        name: 'My icons',
        version: '2.0.0',
        license: 'ISC AND MIT',
        attribution: 'Me',
        credits: [credit('mine')],
        fontCredits: [font('inter', ['mine:label'])],
      },
    ]);
  });

  it("NFR-LIC-003: a saved namespace keeps the file's credits over an installed pack, and an unused pack has none", () => {
    const packs = documentCredits([saved], [distribution(installedPeople, ['people:person'])], ['people:pair']);
    expect(packs).toEqual([
      {
        id: 'people',
        version: '1.0.0',
        license: 'MIT',
        attribution: 'Saved people',
        credits: [credit('all'), credit('pair-only', ['people:pair'])],
      },
    ]);
    expect(documentCredits([saved], [distribution(lucide, ['lucide:x'])], ['basic:rect'])).toEqual([]);
    expect(documentCredits([], [{ kind: 'embedded', subset: saved }], ['people:person'])).toEqual([]);
  });
});

// Original deterministic geometry for portable-format acceptance; never a runtime pack.
import type { ShapeDef, ShapePackIndex } from '@fluxion/core';
import type { DocumentFile, QualifiedName } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';

export const usedIds: readonly QualifiedName[] = ['portable:s0', 'portable:s7', 'portable:s23'];
export function portableDistribution(count = 5000): { readonly kind: 'distribution'; readonly index: ShapePackIndex; readonly definitions: ShapeDef[] } {
  const paths = ['M0 0H{w}V{h}H0Z', 'M0 {h}L{w/2} 0L{w} {h}Z', 'M{w/2} 0L{w} {h/2}L{w/2} {h}L0 {h/2}Z'];
  const definitions = Array.from({ length: count }, (_, i) => ({
    id: `portable:s${i}` as QualifiedName,
    outline: { path: paths[i % paths.length] ?? paths[0] ?? '' },
    defaultSize: { w: 80, h: 80 },
  }));
  const credit = {
    id: 'global',
    license: 'MIT',
    attribution: 'Fluxion contributors',
    notice: 'Original geometric test definitions, MIT.',
    source: { kind: 'original' as const, author: 'Fluxion contributors', statement: 'Original geometric test fixtures authored for Fluxion.' },
  };
  const index: ShapePackIndex = {
    format: 'fluxion-shape-pack',
    formatVersion: '1.0',
    id: 'portable',
    version: '1.0.0',
    name: 'Portable acceptance shapes',
    license: 'MIT',
    attribution: 'Fluxion contributors',
    categories: { basic: { path: 'categories/basic.json', sha256: '0'.repeat(64) } },
    definitions: definitions.map((def) => ({ id: def.id, name: def.id, keywords: [], category: 'basic' })),
    credits: [
      credit,
      { ...credit, id: 'scoped', definitionIds: ['portable:s0', 'portable:s1', 'portable:s7'] },
      { ...credit, id: 'unused', definitionIds: ['portable:s4999'] },
    ],
  };
  return { kind: 'distribution' as const, index, definitions };
}
export function portableDocument(ids: readonly QualifiedName[] = usedIds): DocumentFile {
  const b = documentBuilder({ seed: 1814 });
  const screen = b.screen();
  const group = b.rect(screen);
  ids.forEach((defId, i) => {
    b.rect(screen, { defId, x: 100 + i * 120, y: 100, w: 80, h: 80, ...(i === 0 ? { parentId: group } : {}) });
  });
  const document = b.build();
  const parent = document.records[group];
  if (!parent) throw new Error('fixture group missing');
  return { ...document, records: { ...document.records, [group]: { ...parent, kind: 'group' } } };
}

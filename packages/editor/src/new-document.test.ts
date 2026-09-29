import { parseDocument, seededRandom, serializeDocument } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { newDocument } from './new-document.js';

describe('new documents (FR-EDT-001)', () => {
  it('FR-EDT-001: a new document is valid and holds one empty 16:9 screen', () => {
    const doc = newDocument(seededRandom(7));
    const parsed = parseDocument(serializeDocument(doc));
    expect(parsed.ok ? parsed.value.diagnostics.filter((d) => d.severity === 'error') : parsed.error).toEqual([]);
    const records = Object.values(doc.records);
    expect(records.map((r) => r.type).sort()).toEqual(['document', 'screen']);
    const screen = records.find((r) => r.type === 'screen') as { size: { w: number; h: number } };
    expect(screen.size.w / screen.size.h).toBeCloseTo(16 / 9, 9);
    // ids come from the random source: another seed, other ids
    expect(Object.keys(newDocument(seededRandom(8)).records)).not.toEqual(Object.keys(doc.records));
  });
});

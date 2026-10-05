import { createCore } from '@fluxion/core';
import type { DocumentFile, RecordId } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { presentationOrder, screensInOrder } from './screen-order.js';

/** Four screens a, b, c, d in index order, with sections S1 (before) and S2 (after) and the rest set by `edit`. */
function deck(edit: (records: Record<string, Record<string, unknown>>, ids: { a: RecordId; b: RecordId; c: RecordId; d: RecordId }) => void) {
  const builder = documentBuilder({ seed: 41 });
  const [a, b, c, d] = [builder.screen(), builder.screen(), builder.screen(), builder.screen()] as [RecordId, RecordId, RecordId, RecordId];
  const file = builder.build();
  const records = structuredClone(file.records) as Record<string, Record<string, unknown>>;
  Object.assign(records, {
    s1: { id: 's1', type: 'section', name: 'One', index: 'a0' },
    s2: { id: 's2', type: 'section', name: 'Two', index: 'a1' },
  });
  edit(records, { a, b, c, d });
  const store = createCore({ ...file, records } as DocumentFile, { validate: false }).store;
  return { store, ids: { a, b, c, d } };
}

describe('presentation order (FR-SCR-004, FR-PRS-002)', () => {
  it("FR-SCR-004: with sections, first and next visit the screens in the navigator's order and the first visible screen is the navigator's first", () => {
    // index order a b c d; a and c sit in S2, b in S1, d in none: the navigator lists d, then S1 (b), then S2 (a, c)
    const { store, ids } = deck((r, { a, b, c }) => {
      Object.assign(r[a] as object, { sectionId: 's2' });
      Object.assign(r[b] as object, { sectionId: 's1' });
      Object.assign(r[c] as object, { sectionId: 's2' });
    });
    const order = store.query((view) => presentationOrder(view, false))();
    expect(order).toEqual([ids.d, ids.b, ids.a, ids.c]);
    // the first visible screen is the navigator's first, not the first by index
    expect(order[0]).not.toBe(store.query((view) => screensInOrder(view, false)[0])());
  });

  it("FR-SCR-004: without sections the order is the screens' own, hidden screens are skipped, and a section that does not exist holds nothing", () => {
    const { store, ids } = deck((r, { b, c }) => {
      Object.assign(r[b] as object, { hidden: true });
      Object.assign(r[c] as object, { sectionId: 'gone' });
    });
    expect(store.query((view) => presentationOrder(view, false))()).toEqual([ids.a, ids.c, ids.d]);
    expect(store.query((view) => presentationOrder(view, true))()).toEqual([ids.a, ids.b, ids.c, ids.d]);
  });
});

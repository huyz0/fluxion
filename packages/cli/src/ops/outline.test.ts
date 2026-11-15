import { type DocumentFile, serializeDocument } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { hostRegistries } from './index.js';
import { outlineDocument, screenText } from './outline.js';

/** A master sorting first, and a slide using it, as text. */
function masterDoc() {
  const b = documentBuilder({ seed: 4923 });
  const master = b.screen({ name: 'brand' });
  b.rect(master);
  const slide = b.screen({ name: 'slide' });
  const built = b.build();
  const records = {
    ...built.records,
    [master]: { ...(built.records[master] as object), role: 'master' },
    [slide]: { ...(built.records[slide] as object), masterId: master },
  };
  return { text: serializeDocument({ ...built, records } as DocumentFile), master, slide };
}

describe('the document outline (FR-SCR-005, ADR-0054)', () => {
  it('FR-SCR-005: the outline lists the slides and not their master; the first screen is the first slide; a master by id still has its text', () => {
    const t = masterDoc();
    const outline = outlineDocument(t.text);
    expect(outline.ok && outline.value.screens.map((s) => s.name)).toEqual(['slide']);
    const first = screenText(t.text, hostRegistries().registries);
    expect(first.ok && first.value.screen).toBe(t.slide);
    const master = screenText(t.text, hostRegistries().registries, t.master);
    expect(master.ok && master.value.screen).toBe(t.master);
  });
});

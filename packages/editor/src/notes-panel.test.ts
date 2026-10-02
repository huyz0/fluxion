import type { RichTextDoc } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { blankNotes } from './notes-panel.js';

const doc = (...content: unknown[]) => ({ type: 'doc', content }) as unknown as RichTextDoc;
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string) => ({ type: 'text', text: t });

describe('speaker notes (FR-SCR-006)', () => {
  it('FR-SCR-006: notes with no text are blank, so emptying the field removes them', () => {
    expect([blankNotes(doc()), blankNotes(doc(paragraph())), blankNotes(doc(paragraph(), paragraph())), blankNotes(doc(paragraph(text(''))))]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([
      blankNotes(doc(paragraph(text('a')))),
      blankNotes(doc(paragraph(), paragraph(text(' ')))),
      blankNotes(doc(paragraph({ type: 'hardBreak' }))),
    ]).toEqual([false, false, false]);
    // text deeper down (a list item) counts
    const list = { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('point'))] }] };
    expect(blankNotes(doc(list))).toBe(false);
  });
});

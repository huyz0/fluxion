import type { RichTextDoc } from '@fluxion/schema';
import { toggleMark } from 'prosemirror-commands';
import { describe, expect, it } from 'vitest';
import { edited, textOf, textState } from './text-pm.js';
import { TEXT_SCHEMA } from './text-schema.js';

const doc = (...text: string[]): RichTextDoc =>
  ({ type: 'doc', content: text.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) }) as RichTextDoc;

describe('text-pm (FR-TXT-003)', () => {
  it('FR-TXT-003: the state holds the text, all selected, with nothing edited yet', () => {
    const state = textState(doc('one', 'two'));
    expect(state.selection.from).toBe(1);
    expect(state.doc.textBetween(state.selection.from, state.selection.to, '|')).toBe('one|two');
    expect(edited(state)).toBe(false);
    expect(textOf(state)).toEqual(doc('one', 'two'));
  });

  it('FR-TXT-003: an absent or empty document is an empty paragraph with the cursor in it', () => {
    for (const empty of [undefined, { type: 'doc' } as RichTextDoc]) {
      const state = textState(empty);
      expect(textOf(state)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
      expect(state.selection.empty).toBe(true);
    }
  });

  it('FR-TXT-003: typing is an edit, and a mark over the selection is stored as the schema`s mark', () => {
    let state = textState(doc('hello'));
    toggleMark(TEXT_SCHEMA.marks['bold'] as never)(state, (tr) => {
      state = state.apply(tr);
    });
    expect(textOf(state)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] }] }] });
    state = state.apply(state.tr.insertText('bye'));
    expect(edited(state)).toBe(true);
    expect(textOf(state)).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'bye', marks: [{ type: 'bold' }] }] }] });
  });
});

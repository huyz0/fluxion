import { undoInputRule } from 'prosemirror-inputrules';
import type { EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';
import { textOf, textState } from './text-pm.js';

/** Type `text` into an empty paragraph one character at a time, through the plugins' text-input handlers. */
function type(text: string, from: EditorState = textState(undefined)): EditorState {
  let state = from;
  const view = {
    get state() {
      return state;
    },
    dispatch: (tr: ReturnType<EditorState['apply']> extends never ? never : Parameters<EditorState['apply']>[0]) => {
      state = state.apply(tr);
    },
  } as unknown as EditorView;
  for (const ch of text) {
    const { from: a, to: b } = state.selection;
    const handled = state.plugins.some((p) => p.props.handleTextInput?.call(p, view, a, b, ch, () => state.tr.insertText(ch, a, b)));
    if (!handled) state = state.apply(state.tr.insertText(ch, a, b));
  }
  return state;
}

const blocks = (state: EditorState) =>
  (textOf(state).content ?? []) as readonly { type: string; attrs?: Record<string, unknown>; content?: readonly unknown[] }[];
const inline = (state: EditorState) => JSON.stringify(textOf(state).content?.[0]?.content);

describe('markdown shortcuts (FR-TXT-004)', () => {
  it('FR-TXT-004: `# ` to `###### ` start a heading of that level, and seven hashes do not', () => {
    for (const level of [1, 2, 3, 6]) {
      const state = type(`${'#'.repeat(level)} Title`);
      expect(blocks(state)[0]).toMatchObject({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: 'Title' }] });
    }
    expect(blocks(type('####### x'))[0]?.type).toBe('paragraph');
    // a hash that is not at the start of the block is text
    expect(blocks(type('a # b'))[0]?.type).toBe('paragraph');
  });

  it('FR-TXT-004: `- `, `* ` and `1. ` start a bullet and a numbered list holding the rest', () => {
    for (const marker of ['- ', '* ', '+ ']) expect(blocks(type(`${marker}item`))[0]).toMatchObject({ type: 'bulletList' });
    const numbered = blocks(type('3. item'))[0];
    expect(numbered).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
    expect(JSON.stringify(numbered)).toContain('item');
    expect(blocks(type('1. item'))[0]?.attrs).toBeUndefined();
  });

  it('FR-TXT-004: `**b**`, `_i_` and `` `c` `` mark their text and drop the markers, and what follows is plain', () => {
    expect(inline(type('a **bold** b'))).toBe(
      JSON.stringify([
        { type: 'text', text: 'a ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' b' },
      ]),
    );
    expect(inline(type('_it_'))).toBe(JSON.stringify([{ type: 'text', text: 'it', marks: [{ type: 'italic' }] }]));
    expect(inline(type('`x + 1`'))).toBe(JSON.stringify([{ type: 'text', text: 'x + 1', marks: [{ type: 'code' }] }]));
    // after the closing marker the next characters are not marked
    expect(inline(type('**b**c'))).toBe(
      JSON.stringify([
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'c' },
      ]),
    );
  });

  it('FR-TXT-004: markers that do not wrap text stay as typed (spaces inside, snake_case, an empty pair)', () => {
    for (const plain of ['** b**', '**b **', 'snake_case_name', '____', '****', '``']) {
      expect(JSON.stringify(textOf(type(plain)).content?.[0]?.content?.[0])).not.toContain('marks');
    }
    expect(inline(type('snake_case_name'))).toBe(JSON.stringify([{ type: 'text', text: 'snake_case_name' }]));
  });

  it('FR-TXT-004: Backspace right after a shortcut gives the typed characters back', () => {
    let state = type('# ');
    expect(blocks(state)[0]?.type).toBe('heading');
    undoInputRule(state, (tr) => {
      state = state.apply(tr);
    });
    expect(blocks(state)[0]?.type).toBe('paragraph');
    expect(JSON.stringify(textOf(state))).toContain('# ');
    let bold = type('**b**');
    undoInputRule(bold, (tr) => {
      bold = bold.apply(tr);
    });
    expect(inline(bold)).toBe(JSON.stringify([{ type: 'text', text: '**b**' }]));
  });
});

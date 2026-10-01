// The ProseMirror state of the inline text editor (ADR-0064, M7.12): the editor-only library, mapped to and
// from the schema's rich-text JSON by pm-json.ts. This file is the editor's behaviour (its keys, its history);
// inline-text-editor.tsx is the DOM around it.
import type { RichTextDoc } from '@fluxion/schema';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo, undoDepth } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { Node } from 'prosemirror-model';
import { EditorState, Selection, TextSelection } from 'prosemirror-state';
import { fromPmJson, type PmNode, toPmJson } from './pm-json.js';
import { TEXT_SCHEMA } from './text-schema.js';

/** The editor's key bindings: the marks, the history, and a soft line break. */
const KEYS = keymap({
  'Mod-b': toggleMark(TEXT_SCHEMA.marks['bold'] as never),
  'Mod-i': toggleMark(TEXT_SCHEMA.marks['italic'] as never),
  'Mod-u': toggleMark(TEXT_SCHEMA.marks['underline'] as never),
  'Mod-z': undo,
  'Mod-y': redo,
  'Mod-Shift-z': redo,
  'Shift-Enter': (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(TEXT_SCHEMA.nodes['hardBreak']?.create() as Node).scrollIntoView());
    return true;
  },
});

/** The editing state of `text` (an absent document is an empty paragraph), with all of it selected. */
export function textState(text: RichTextDoc | undefined): EditorState {
  const doc = Node.fromJSON(TEXT_SCHEMA, toPmJson(text));
  const state = EditorState.create({ doc, plugins: [history(), KEYS, keymap(baseKeymap)] });
  return state.apply(state.tr.setSelection(TextSelection.between(Selection.atStart(doc).$from, Selection.atEnd(doc).$to)));
}

/** The rich text `state` holds, as it is stored. */
export function textOf(state: EditorState): RichTextDoc {
  return fromPmJson(state.doc.toJSON() as PmNode) as RichTextDoc;
}

/** Whether `state` was edited since it was made (its history has a step). */
export const edited = (state: EditorState): boolean => undoDepth(state) > 0;

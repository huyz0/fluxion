// The speaker notes panel (FR-SCR-006, M8.16): the notes of the shown screen in the same rich-text editor the canvas
// uses for labels (ProseMirror, text-pm.ts). Leaving the field, or the panel, or the screen, commits: one
// `screen.setNotes` and one undo step. A change from elsewhere (an undo, an AI patch) shows here when the field is not
// being typed in.
import type { Store } from '@fluxion/core';
import { useValue } from '@fluxion/render';
import type { RecordId, RichTextDoc, ScreenRecord } from '@fluxion/schema';
import { t } from '@lingui/core/macro';
import './i18n.js';
import { type EditorState, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import type { Execute } from './pointer.js';
import { edited, textOf, textState } from './text-pm.js';

/** Props of {@link NotesPanel}. */
export type NotesPanelProps = {
  /** The document store. */
  readonly store: Store;
  /** Runs a command. */
  readonly execute: Execute;
  /** The screen the canvas shows. */
  readonly screenId: RecordId | undefined;
};

type Node = { readonly type?: string; readonly text?: string; readonly content?: readonly Node[] };

/** Whether `node` holds any text or break. */
const hasText = (node: Node): boolean => (node.type === 'text' ? (node.text ?? '') !== '' : node.type === 'hardBreak' || (node.content ?? []).some(hasText));

/** Whether `doc` holds no text: nothing, or paragraphs without content. */
export const blankNotes = (doc: RichTextDoc): boolean => !hasText(doc as unknown as Node);

/** The notes of `screen`, as stored. */
const readNotes = (store: Pick<Store, 'get'>, screen: RecordId): RichTextDoc | undefined => (store.get(screen) as ScreenRecord | undefined)?.notes;

/** A state for `notes` with the cursor at the end (typing adds to them). */
function stateFor(notes: RichTextDoc | undefined): EditorState {
  const state = textState(notes);
  return state.apply(state.tr.setSelection(Selection.atEnd(state.doc)));
}

/** The panel. */
export function NotesPanel(props: NotesPanelProps): ReactNode {
  const { store, execute, screenId } = props;
  return screenId === undefined ? (
    <p className="fx-chrome-placeholder">{t`No screen to take notes for.`}</p>
  ) : (
    <Notes key={screenId} store={store} execute={execute} screenId={screenId} />
  );
}

/** The editor of one screen's notes. */
function Notes(props: NotesPanelProps & { readonly screenId: RecordId }): ReactNode {
  const { store, execute, screenId } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const stored = useValue(useMemo(() => store.query((view) => readNotes(view, screenId)), [store, screenId]));
  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    const editor = new EditorView(parent, {
      state: stateFor(readNotes(store, screenId)),
      attributes: { class: 'fx-chrome-textroot fx-chrome-notes', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Speaker notes' },
    });
    view.current = editor;
    // commit what was typed: one command, one undo step; a field emptied removes the notes
    const commit = () => {
      if (!edited(editor.state)) return;
      const doc = textOf(editor.state);
      execute('screen.setNotes', { id: screenId, ...(blankNotes(doc) ? {} : { notes: doc }) });
      store.history.seal();
      editor.updateState(stateFor(readNotes(store, screenId)));
    };
    parent.addEventListener('focusout', commit);
    return () => {
      parent.removeEventListener('focusout', commit);
      commit();
      editor.destroy();
      view.current = null;
    };
  }, [store, execute, screenId]);
  // the stored notes changed elsewhere: show them, unless they are being typed
  useEffect(() => {
    const editor = view.current;
    if (editor === null || editor.hasFocus() || edited(editor.state)) return;
    if (JSON.stringify(textOf(editor.state)) !== JSON.stringify(textOf(stateFor(stored)))) editor.updateState(stateFor(stored));
  }, [stored]);
  return <div ref={host} className="fx-chrome-notes-host" data-testid="notes" />;
}

import { undoDepth } from '@codemirror/commands';
import { StateEffect, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { has, manualScheduler, moveOnCanvas, retitle, setup } from './source-fixture.js';
import { headerLength, RECONCILE_DELAY_MS } from './source-sync.js';
import { SourceView } from './source-view.js';

// T1 for FR-EDT-022 (M12.59): the text's own undo in a real CodeMirror (ADR-0032, "Undo"): Mod-z undoes what was typed, never the document.
let host: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const UNDO = '{Control>}z{/Control}';
const REDO = '{Control>}{Shift>}Z{/Shift}{/Control}';

async function mount() {
  const fixture = setup();
  const timer = manualScheduler();
  await act(async () =>
    root.render(
      <SourceView store={fixture.store} execute={fixture.execute} registries={fixture.registries} screenId={fixture.one} scheduler={timer.scheduler} />,
    ),
  );
  const editor = EditorView.findFromDOM(host) as EditorView;
  /** Type `typed` right after `after`, as a person at the keyboard would. */
  const type = async (after: string, typed: string) => {
    editor.focus();
    editor.dispatch({ selection: { anchor: editor.state.doc.toString().indexOf(after) + after.length } });
    await act(async () => userEvent.keyboard(typed));
  };
  const replace = (from: string, to: string) => {
    const at = editor.state.doc.toString().indexOf(from);
    editor.dispatch({ changes: { from: at, to: at + from.length, insert: to } });
  };
  return { ...fixture, timer, editor, type, replace, text: () => editor.state.doc.toString() };
}

/** Record the `addToHistory` annotation of every change that is not the author's typing (a regeneration), as the history sees it. */
function spyOnHistory(editor: EditorView): (boolean | undefined)[] {
  const seen: (boolean | undefined)[] = [];
  editor.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((u) => {
        for (const tr of u.transactions) if (tr.docChanged && tr.isUserEvent('input') === false) seen.push(tr.annotation(Transaction.addToHistory));
      }),
    ),
  });
  return seen;
}

describe('source view text history', () => {
  it('FR-EDT-022: Mod-z in the editor undoes the typing in the text and leaves the document and its undo stack alone', async () => {
    const { editor, store, type, text } = await mount();
    const before = text();
    await type('label: Alpha', 'XY');
    expect(text()).toContain('label: AlphaXY');
    const depth = store.history.undoDepth;
    const doc = store.toDocument();
    await act(async () => userEvent.keyboard(UNDO));
    expect(text()).toBe(before);
    expect(store.toDocument()).toEqual(doc);
    expect(store.history.undoDepth).toBe(depth);
    expect(editor.hasFocus).toBe(true);
  });

  it('FR-EDT-022: Mod-Shift-z and Mod-y redo what Mod-z undid, in the text only', async () => {
    const { store, type, text } = await mount();
    await type('label: Alpha', 'XY');
    const typed = text();
    const depth = store.history.undoDepth;
    await act(async () => userEvent.keyboard(UNDO));
    expect(text()).not.toContain('AlphaXY');
    await act(async () => userEvent.keyboard(REDO));
    expect(text()).toBe(typed);
    await act(async () => userEvent.keyboard(UNDO));
    await act(async () => userEvent.keyboard('{Control>}y{/Control}'));
    expect(text()).toBe(typed);
    expect(store.history.undoDepth).toBe(depth);
  });

  it('FR-EDT-022: a text restored by Mod-z is an ordinary edit: it is applied after the pause, as one more document step', async () => {
    const { store, timer, type, text } = await mount();
    await type('label: Alpha', 'XY');
    await act(async () => timer.advance(300));
    expect(has(store, 'AlphaXY')).toBe(true);
    const depth = store.history.undoDepth;
    await act(async () => userEvent.keyboard(UNDO));
    expect(text()).not.toContain('AlphaXY');
    expect(has(store, 'AlphaXY')).toBe(true);
    expect(timer.count()).toBe(1);
    await act(async () => timer.advance(300));
    expect(has(store, 'AlphaXY')).toBe(false);
    expect(has(store, 'Alpha')).toBe(true);
    expect(store.history.undoDepth).toBe(depth + 1);
  });

  it('FR-EDT-022: a Reload is one entry of the text history, apart from the typing before it: Mod-z brings the text it replaced back and the annotation of the regeneration does not stick', async () => {
    const fixture = await mount();
    const { store, timer, text, type } = fixture;
    // real input events: the typing is a user event of its own, and the Reload that follows must not join it
    await type('label: Alpha', 'XY');
    const typed = text();
    await act(async () => {
      moveOnCanvas(fixture, 'Beta');
      timer.advance(RECONCILE_DELAY_MS);
    });
    const button = host.querySelector<HTMLButtonElement>('.fx-chrome-source-banner button');
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(text()).toContain('label: Beta, pin:');
    expect(timer.count()).toBe(0);
    await act(async () => userEvent.keyboard(UNDO));
    expect(text()).toBe(typed);
    // the undo is an ordinary edit for the sync: it is scheduled, not skipped as a regeneration
    expect(timer.count()).toBe(1);
    await act(async () => timer.advance(300));
    expect(has(store, 'AlphaXY')).toBe(true);
    expect(host.querySelector('.fx-chrome-source-status')?.getAttribute('data-status')).toBe('applied');
    await act(async () => userEvent.keyboard(REDO));
    expect(text()).toContain('label: Beta, pin:');
  });

  it('FR-EDT-022: a regeneration that changes the header is not undoable and ends the text history, so the read-only header cannot be corrupted', async () => {
    const fixture = await mount();
    const { editor, timer, text, replace, type } = fixture;
    await act(async () => replace('Alpha', 'Omega'));
    await act(async () => timer.advance(300));
    editor.contentDOM.blur();
    await act(async () => {
      retitle(fixture, 'A new title');
      timer.advance(RECONCILE_DELAY_MS);
    });
    const regenerated = text();
    expect(regenerated).toContain('title: A new title');
    editor.focus();
    await act(async () => userEvent.keyboard(UNDO));
    expect(text()).toBe(regenerated);
    expect(text().slice(0, headerLength(text()))).toContain('A new title');
    // typing after it is undone alone
    await type('label: Omega', 'Z');
    await act(async () => userEvent.keyboard(UNDO));
    expect(text()).toBe(regenerated);
    await act(async () => userEvent.keyboard(UNDO));
    expect(text()).toBe(regenerated);
  });

  it('FR-EDT-022: a regeneration that changes the header is not recorded in the text history (its transaction says so)', async () => {
    const fixture = await mount();
    const { editor, timer, replace } = fixture;
    await act(async () => replace('Alpha', 'Omega'));
    await act(async () => timer.advance(300));
    editor.contentDOM.blur();
    const seen = spyOnHistory(editor);
    await act(async () => {
      retitle(fixture, 'Another title');
      timer.advance(RECONCILE_DELAY_MS);
    });
    expect(editor.state.doc.toString()).toContain('title: Another title');
    expect(seen[0]).toBe(false);
  });

  it('FR-EDT-022: after a canvas drag regenerated the text, Mod-z in the editor does not revert the drag nor bring the pre-drag text back', async () => {
    const fixture = await mount();
    const { editor, store, timer, text, type } = fixture;
    // typing applied before the drag: a history that a stale Mod-z could restore
    await type('label: Alpha', 'XY');
    await act(async () => timer.advance(300));
    editor.contentDOM.blur();
    const seen = spyOnHistory(editor);
    await act(async () => {
      moveOnCanvas(fixture, 'Beta');
      timer.advance(RECONCILE_DELAY_MS);
    });
    const regenerated = text();
    expect(regenerated).toContain('label: Beta, pin:');
    expect(seen).toEqual([false]);
    expect(undoDepth(editor.state)).toBe(0);
    const doc = store.toDocument();
    editor.focus();
    await act(async () => userEvent.keyboard(UNDO));
    expect(text()).toBe(regenerated);
    expect(timer.count()).toBe(0);
    await act(async () => timer.advance(300));
    expect(store.toDocument()).toEqual(doc);
    expect(text()).toContain('label: Beta, pin:');
  });

  it('FR-EDT-022: Mod-u and Alt-u are not bound: selection undo is not offered and the keys reach the browser', async () => {
    const { editor, text } = await mount();
    editor.focus();
    const before = text();
    const prevented: boolean[] = [];
    const watch = (e: Event) => void prevented.push(e.defaultPrevented);
    host.addEventListener('keydown', watch);
    editor.dispatch({ selection: { anchor: before.indexOf('Alpha') } });
    editor.dispatch({ selection: { anchor: before.indexOf('Beta') } });
    const at = editor.state.selection.main.head;
    await act(async () => userEvent.keyboard('{Control>}u{/Control}'));
    await act(async () => userEvent.keyboard('{Alt>}u{/Alt}'));
    host.removeEventListener('keydown', watch);
    expect(prevented).toContain(false);
    expect(prevented.filter(Boolean)).toHaveLength(0);
    expect(editor.state.selection.main.head).toBe(at);
    expect(text()).toBe(before);
  });
});

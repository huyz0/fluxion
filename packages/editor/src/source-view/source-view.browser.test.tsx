import { EditorView } from '@codemirror/view';
import type { RecordId } from '@fluxion/schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { addRecords, commentOn, elementOf, has, manualScheduler, moveOnCanvas, retitle, setup } from './source-fixture.js';
import { headerLength, RECONCILE_DELAY_MS, sourceOf } from './source-sync.js';
import { SourceView } from './source-view.js';

// T1 for FR-EDT-022 (M12.22): the source view in a real CodeMirror, over a real store, with a timer the test advances by hand.
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

async function mount(onEscape?: () => void, onRemap?: (remap: ReadonlyMap<RecordId, RecordId>) => void) {
  const fixture = setup();
  const timer = manualScheduler();
  await act(async () =>
    root.render(
      <SourceView
        store={fixture.store}
        execute={fixture.execute}
        registries={fixture.registries}
        screenId={fixture.one}
        scheduler={timer.scheduler}
        {...(onEscape ? { onEscape } : {})}
        {...(onRemap ? { onRemap } : {})}
      />,
    ),
  );
  const editor = EditorView.findFromDOM(host) as EditorView;
  const replace = (from: string, to: string) => {
    const text = editor.state.doc.toString();
    const at = text.indexOf(from);
    editor.dispatch({ changes: { from: at, to: at + from.length, insert: to } });
  };
  return { ...fixture, timer, editor, replace };
}

describe('source view', () => {
  it('FR-EDT-022: the view shows the screen alone and a change of the header is refused', async () => {
    const { editor } = await mount();
    const before = editor.state.doc.toString();
    expect(before).toContain('label: Alpha');
    expect(before).not.toContain('Gamma');
    editor.dispatch({ changes: { from: 0, to: 4, insert: 'xxxx' } });
    editor.dispatch({ changes: { from: before.indexOf('title: Sync') + 7, insert: 'Y' } });
    expect(editor.state.doc.toString()).toBe(before);
    expect(host.querySelectorAll('.fx-source-header').length).toBeGreaterThan(0);
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe('Source view');
    expect(editor.contentDOM.getAttribute('aria-label')).toBe('FluxScript source');
  });

  it('FR-EDT-022: a valid edit reaches the canvas only after the debounce, as one undo step', async () => {
    const { store, timer, replace } = await mount();
    const before = store.toDocument();
    await act(async () => replace('Alpha', 'Omega'));
    await act(async () => timer.advance(299));
    expect(has(store, 'Omega')).toBe(false);
    await act(async () => timer.advance(1));
    expect(has(store, 'Omega')).toBe(true);
    expect(host.querySelector('.fx-chrome-source-status')?.getAttribute('data-status')).toBe('applied');
    await act(async () => replace('Omega', 'Sigma'));
    await act(async () => timer.advance(300));
    expect(has(store, 'Sigma')).toBe(true);
    store.history.undo();
    expect(has(store, 'Omega')).toBe(true);
    store.history.undo();
    expect(store.toDocument()).toEqual(before);
  });

  it('FR-EDT-022: an error marks its line in the gutter, lists it and leaves the canvas as it was', async () => {
    const { store, timer, replace, editor } = await mount();
    await act(async () => replace('Alpha', 'Omega'));
    await act(async () => timer.advance(300));
    const good = store.toDocument();
    await act(async () => replace('shape: rect, label: Omega', 'shape: rectt, label: Omega'));
    await act(async () => timer.advance(300));
    expect(store.toDocument()).toEqual(good);
    const marker = host.querySelector<HTMLElement>('.fx-source-marker[data-severity="error"]');
    expect(marker).not.toBeNull();
    expect(marker?.title).toMatch(/rectt/);
    const line = editor.state.doc.lineAt(editor.state.doc.toString().indexOf('rectt')).number;
    const gutterRow = [...host.querySelectorAll('.cm-gutterElement')].find((el) => el.querySelector('.fx-source-marker[data-severity="error"]'));
    expect(gutterRow?.textContent).toContain('!');
    const at = editor.coordsAtPos(editor.state.doc.line(line).from) as { top: number; bottom: number };
    const row = (gutterRow as HTMLElement).getBoundingClientRect();
    expect(row.top).toBeLessThanOrEqual(at.bottom);
    expect(row.bottom).toBeGreaterThanOrEqual(at.top);
    expect(host.querySelector('.fx-source-problems li[data-severity="error"]')?.textContent).toMatch(new RegExp(`Line ${line}:`));
    expect(host.querySelector('.fx-chrome-source-status')?.getAttribute('data-status')).toBe('invalid');
    // fixed: the marker goes and the edit is applied
    await act(async () => replace('rectt', 'rect'));
    await act(async () => replace('Omega', 'Zeta'));
    await act(async () => timer.advance(300));
    expect(host.querySelector('.fx-source-marker[data-severity="error"]')).toBeNull();
    expect(has(store, 'Zeta')).toBe(true);
  });

  it('FR-EDT-022: Escape hands the focus back to the host', async () => {
    const onEscape = vi.fn();
    const { editor } = await mount(onEscape);
    editor.focus();
    editor.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onEscape).toHaveBeenCalledOnce();
  });

  it('FR-EDT-022: a canvas change replaces the block of a clean view in one change, keeps the header and the cursor line, and applies nothing', async () => {
    const fixture = await mount();
    const { editor, timer, store } = fixture;
    const header = editor.state.doc.toString().slice(0, editor.state.doc.toString().indexOf('- id: one'));
    const at = editor.state.doc.toString().indexOf('label: Beta') + 3;
    editor.dispatch({ selection: { anchor: at } });
    const dispatch = vi.spyOn(editor, 'dispatch');
    await act(async () => {
      moveOnCanvas(fixture);
      timer.advance(RECONCILE_DELAY_MS);
    });
    const edits = dispatch.mock.calls.filter(([spec]) => (spec as { changes?: unknown }).changes !== undefined);
    expect(edits).toHaveLength(1);
    const text = editor.state.doc.toString();
    expect(text.startsWith(header)).toBe(true);
    expect(text).toContain('a: { shape: rect, label: Alpha, pin: { x: 300, y: 200 } }');
    expect(text).toBe(sourceOf(store, fixture.registries, fixture.one));
    expect(editor.state.doc.sliceString(editor.state.selection.main.head - 3, editor.state.selection.main.head + 8)).toBe('label: Beta');
    expect(timer.count()).toBe(0);
    expect(host.querySelector('.fx-chrome-source-banner button')).toBeNull();
  });

  it('FR-EDT-022: a canvas change under a dirty or focused view raises the banner, and Reload (a focusable button) replaces the text', async () => {
    const fixture = await mount();
    const { editor, store, timer, replace } = fixture;
    await act(async () => replace('Alpha', 'Alp'));
    expect(timer.count()).toBe(1);
    const typed = editor.state.doc.toString();
    await act(async () => {
      moveOnCanvas(fixture, 'Beta');
      timer.advance(RECONCILE_DELAY_MS);
    });
    expect(editor.state.doc.toString()).toBe(typed);
    const banner = host.querySelector('.fx-chrome-source-banner');
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toContain('Canvas changed — reload');
    const button = host.querySelector<HTMLButtonElement>('.fx-chrome-source-banner button');
    expect(button?.textContent).toBe('Reload');
    // the keyboard: the button is a real button, so Enter activates it
    button?.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => button?.click());
    expect(editor.state.doc.toString()).toBe(sourceOf(store, fixture.registries, fixture.one));
    expect(editor.state.doc.toString()).toContain('label: Beta, pin: { x: 300, y: 200 }');
    expect(host.querySelector('.fx-chrome-source-banner button')).toBeNull();
    expect(timer.count()).toBe(0);
    expect(has(store, 'Alp')).toBe(false);
    // focused: a clean view is not regenerated either, until it is blurred
    await act(async () => editor.contentDOM.dispatchEvent(new FocusEvent('focus')));
    await act(async () => {
      store.history.undo();
      timer.advance(RECONCILE_DELAY_MS);
    });
    expect(editor.state.doc.toString()).toContain('pin:');
    expect(host.querySelector('.fx-chrome-source-banner button')).not.toBeNull();
    await act(async () => editor.contentDOM.dispatchEvent(new FocusEvent('blur')));
    expect(editor.state.doc.toString()).not.toContain('pin:');
    expect(host.querySelector('.fx-chrome-source-banner button')).toBeNull();
  });

  it('FR-EDT-022: blur applies the waiting text at once', async () => {
    const { store, timer, replace, editor } = await mount();
    await act(async () => editor.contentDOM.dispatchEvent(new FocusEvent('focus')));
    await act(async () => replace('Alpha', 'Omega'));
    expect(has(store, 'Omega')).toBe(false);
    await act(async () => editor.contentDOM.dispatchEvent(new FocusEvent('blur')));
    expect(has(store, 'Omega')).toBe(true);
    expect(timer.count()).toBe(0);
  });

  it('FR-EDT-022: Tab from the editor to the banner keeps the waiting text unapplied, and Reload by keyboard replaces it and returns the focus to the editor', async () => {
    const fixture = await mount();
    const { editor, store, timer, replace } = fixture;
    editor.focus();
    await act(async () => replace('Alpha', 'Alp'));
    await act(async () => {
      moveOnCanvas(fixture, 'Beta');
      timer.advance(RECONCILE_DELAY_MS);
    });
    const button = host.querySelector<HTMLButtonElement>('.fx-chrome-source-banner button');
    expect(button).not.toBeNull();
    // the banner follows the editor in the tab order
    expect(editor.dom.compareDocumentPosition(button as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => userEvent.tab());
    expect(document.activeElement).toBe(button);
    expect(has(store, 'Alp')).toBe(false);
    expect(timer.count()).toBe(1);
    expect(host.querySelector('.fx-chrome-source-banner button')).toBe(button);
    await act(async () => userEvent.keyboard('{Enter}'));
    expect(editor.state.doc.toString()).toBe(sourceOf(store, fixture.registries, fixture.one));
    expect(host.querySelector('.fx-chrome-source-banner button')).toBeNull();
    expect(editor.hasFocus).toBe(true);
    expect(has(store, 'Alp')).toBe(false);
  });

  it('FR-EDT-022: leaving the banner for elsewhere applies the waiting text', async () => {
    const fixture = await mount();
    const { editor, store, timer, replace } = fixture;
    editor.focus();
    await act(async () => replace('Alpha', 'Alp'));
    await act(async () => {
      moveOnCanvas(fixture, 'Beta');
      timer.advance(RECONCILE_DELAY_MS);
    });
    await act(async () => userEvent.tab());
    expect(has(store, 'Alp')).toBe(false);
    await act(async () => userEvent.tab());
    expect(has(store, 'Alp')).toBe(true);
  });

  it('FR-EDT-022: a regenerated header of another length gets exactly its own header lines decorated', async () => {
    const fixture = await mount();
    const { editor, timer } = fixture;
    act(() => {
      retitle(fixture, `A document title that is a good deal longer than the one before it ${'x'.repeat(40)}`);
      timer.advance(RECONCILE_DELAY_MS);
    });
    const text = editor.state.doc.toString();
    expect(text).toContain('xxxx');
    const headerLines = text.slice(0, headerLength(text)).trimEnd().split('\n').length;
    expect(host.querySelectorAll('.fx-source-header').length).toBe(headerLines);
  });

  it('FR-EDT-022: the status line names the records whose canvas changes the text overwrote, and the records a deleted element took with it', async () => {
    const { store, timer, replace, execute } = await mount();
    // the canvas pins Alpha; the view is clean, so the banner path does not matter here: the text is typed over the pin before it is regenerated
    await act(async () => replace('a: { shape: rect, label: Alpha }', 'a: { shape: rect, label: Alpha, pin: { x: 10, y: 20 } }'));
    moveOnCanvas({ store, execute });
    await act(async () => timer.advance(300));
    const status = host.querySelector('.fx-chrome-source-status');
    expect(status?.textContent).toBe('Applied to the canvas. Overwrote canvas changes to: a (position).');
    addRecords({ execute }, [commentOn(elementOf(store, 'Beta'), 'note')]);
    await act(async () => replace('\n      b: { shape: rect, label: Beta }', ''));
    await act(async () => replace('\n    edges:\n      - a -> b', ''));
    await act(async () => timer.advance(300));
    expect(has(store, 'Beta')).toBe(false);
    expect(host.querySelector('.fx-chrome-source-status')?.textContent).toBe(
      'Applied to the canvas. Removed or cleaned 1 record that pointed at a deleted element.',
    );
  });

  it('FR-EDT-022: a renamed slug is told to the host with the old and the new id', async () => {
    const seen: ReadonlyMap<RecordId, RecordId>[] = [];
    const { store, timer, replace } = await mount(undefined, (remap) => seen.push(remap));
    const alpha = elementOf(store, 'Alpha');
    await act(async () => replace('a: {', 'alp: {'));
    await act(async () => replace('- a -> b', '- alp -> b'));
    await act(async () => timer.advance(300));
    expect(seen).toHaveLength(1);
    expect([...(seen[0] ?? [])].find(([old]) => old === alpha)?.[1]).toBeDefined();
    expect(store.has(alpha)).toBe(false);
  });
});

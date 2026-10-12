import { EditorView } from '@codemirror/view';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { has, manualScheduler, setup } from './source-fixture.js';
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

async function mount(onEscape?: () => void) {
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
});

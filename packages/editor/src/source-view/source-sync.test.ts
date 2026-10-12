import { describe, expect, it, vi } from 'vitest';
import { elementOf, has, manualScheduler, moveOnCanvas, setup } from './source-fixture.js';
import {
  applySource,
  createSourceController,
  createSourceSync,
  cursorAnchor,
  cursorIn,
  headerLength,
  RECONCILE_DELAY_MS,
  type SourceControllerOptions,
  type SyncResult,
  sourceOf,
} from './source-sync.js';

const withLabel = (text: string, from: string, to: string) => text.replace(`label: ${from}`, `label: ${to}`);

describe('source view sync', () => {
  it('FR-EDT-022: the source shown is the screen alone under the header, and the header ends at the screens line', () => {
    const { store, registries, one } = setup();
    const text = sourceOf(store, registries, one);
    expect(text).toContain('label: Alpha');
    expect(text).not.toContain('Gamma');
    expect(text.slice(0, headerLength(text)).trimEnd().endsWith('screens:')).toBe(true);
    expect(headerLength('no header here')).toBe(0);
  });

  it('FR-EDT-022: an edit is compiled after 300 ms of quiet and the last of several edits wins', () => {
    const { store, execute, registries, one } = setup();
    const text = sourceOf(store, registries, one);
    const timer = manualScheduler();
    const results: SyncResult[] = [];
    const sync = createSourceSync({ store, execute, registries, scheduler: timer.scheduler, onResult: (r) => results.push(r) });
    sync.edit(withLabel(text, 'Alpha', 'Al'));
    timer.advance(299);
    sync.edit(withLabel(text, 'Alpha', 'Alp'));
    timer.advance(299);
    expect(results).toEqual([]);
    expect(timer.count()).toBe(1);
    timer.advance(1);
    expect(results.map((r) => r.status)).toEqual(['applied']);
    expect(has(store, 'Alp')).toBe(true);
    expect(has(store, 'Al')).toBe(false);
  });

  it('FR-EDT-022: each apply is one undo step and undo restores the document before it', () => {
    const { store, execute, registries, one } = setup();
    const text = sourceOf(store, registries, one);
    const before = store.toDocument();
    expect(applySource(withLabel(text, 'Alpha', 'First'), store, execute, registries).status).toBe('applied');
    expect(applySource(withLabel(text, 'Alpha', 'Second'), store, execute, registries).status).toBe('applied');
    expect(has(store, 'Second')).toBe(true);
    store.history.undo();
    expect(has(store, 'First')).toBe(true);
    expect(has(store, 'Second')).toBe(false);
    store.history.undo();
    expect(store.toDocument()).toEqual(before);
  });

  it('FR-EDT-022: only the shown screen changes, and a text that changes nothing writes nothing', () => {
    const { store, execute, registries, one } = setup();
    const text = sourceOf(store, registries, one);
    expect(applySource(text, store, execute, registries).status).toBe('unchanged');
    expect(applySource(withLabel(text, 'Alpha', 'Zed'), store, execute, registries).status).toBe('applied');
    expect(has(store, 'Gamma')).toBe(true);
    expect(has(store, 'Beta')).toBe(true);
    expect(has(store, 'Alpha')).toBe(false);
  });

  it('FR-EDT-022: a text with an error applies nothing and reports its diagnostic at its line', () => {
    const { store, execute, registries, one } = setup();
    const text = sourceOf(store, registries, one);
    const before = store.toDocument();
    const bad = text.replace('shape: rect, label: Alpha', 'shape: rectt, label: Alpha');
    const result = applySource(bad, store, execute, registries);
    expect(result.status).toBe('invalid');
    const error = result.diagnostics.find((d) => d.severity === 'error');
    expect(error?.source).toBeDefined();
    expect(bad.slice(0, error?.source?.offset).split('\n').length).toBe(bad.split('\n').findIndex((l) => l.includes('rectt')) + 1);
    expect(store.toDocument()).toEqual(before);
  });
});

/** A controller over a fake view: the text it holds, the banner and the replacements it was told to make. */
function controlled() {
  const fixture = setup();
  const timer = manualScheduler();
  const view = { text: sourceOf(fixture.store, fixture.registries, fixture.one), banner: false, replaced: 0, results: [] as (SyncResult | undefined)[] };
  const port: SourceControllerOptions['port'] = {
    text: () => view.text,
    replace: (t) => {
      view.text = t;
      view.replaced++;
    },
    banner: (show) => {
      view.banner = show;
    },
    result: (r) => view.results.push(r),
  };
  const controller = createSourceController({ ...fixture, screen: fixture.one, scheduler: timer.scheduler, initial: view.text, port });
  // the author types: the view's text changes, then the controller is told
  const type = (text: string) => {
    view.text = text;
    controller.edit(text);
  };
  return { ...fixture, timer, view, controller, type, port };
}

/** A canvas change, then the quiet time the controller waits before it looks at it. */
function change(c: { readonly timer: { advance(ms: number): void } } & Parameters<typeof moveOnCanvas>[0], label?: string): void {
  moveOnCanvas(c, label);
  c.timer.advance(RECONCILE_DELAY_MS);
}

describe('source view, canvas to text', () => {
  it('FR-EDT-022: a canvas change regenerates the text of a clean view that is not focused', () => {
    const c = controlled();
    expect(c.controller.state().clean).toBe(true);
    change(c);
    expect(c.view.text).toContain('a: { shape: rect, label: Alpha, pin: { x: 300, y: 200 } }');
    expect(c.view.replaced).toBe(1);
    expect(c.view.banner).toBe(false);
    expect(c.controller.state()).toEqual({ clean: true, canvasChanged: false });
    // a second change regenerates again: the generated text is the new base
    c.store.history.undo();
    c.timer.advance(RECONCILE_DELAY_MS);
    expect(c.view.text).not.toContain('pin:');
    expect(c.view.replaced).toBe(2);
  });

  it('FR-EDT-022: a focused view is never regenerated by itself: the banner shows, and blur then regenerates', () => {
    const c = controlled();
    c.controller.focus();
    const before = c.view.text;
    change(c);
    expect(c.view.text).toBe(before);
    expect(c.view.banner).toBe(true);
    c.controller.blur();
    expect(c.view.text).toContain('pin: { x: 300, y: 200 }');
    expect(c.view.banner).toBe(false);
  });

  it('FR-EDT-022: a view with a waiting text is dirty: the canvas change raises the banner and the text stays', () => {
    const c = controlled();
    const typed = withLabel(c.view.text, 'Alpha', 'Alp');
    c.type(typed);
    expect(c.controller.state().clean).toBe(false);
    change(c, 'Beta');
    expect(c.view.text).toBe(typed);
    expect(c.view.replaced).toBe(0);
    expect(c.view.banner).toBe(true);
  });

  it('FR-EDT-022: a view with unapplied, erroring text is dirty: the canvas change raises the banner, blur keeps both', () => {
    const c = controlled();
    const bad = c.view.text.replace('shape: rect, label: Alpha', 'shape: rectt, label: Alpha');
    c.type(bad);
    c.timer.advance(300);
    expect(c.view.results.at(-1)?.status).toBe('invalid');
    change(c, 'Beta');
    expect(c.view.text).toBe(bad);
    expect(c.view.banner).toBe(true);
    // blur flushes (nothing waits), the text does not compile: it stays with its diagnostics and the banner stays
    c.controller.focus();
    c.controller.blur();
    expect(c.view.text).toBe(bad);
    expect(c.view.banner).toBe(true);
    expect(c.controller.state()).toEqual({ clean: false, canvasChanged: true });
  });

  it("FR-EDT-022: the view's own apply never regenerates the text nor raises the banner", () => {
    const c = controlled();
    const banners: boolean[] = [];
    (c.port as { banner: (show: boolean) => void }).banner = (show) => {
      banners.push(show);
    };
    // valid but not canonical (spacing): a regeneration WOULD rewrite it
    const typed = c.view.text.replace('a: { shape: rect, label: Alpha }', 'a: {shape: rect, label: Omega}');
    expect(typed).not.toBe(sourceOf(c.store, c.registries, c.one));
    c.type(typed);
    c.timer.advance(300);
    // the quiet time of a look at the canvas passes: the own apply must have been left out of it
    c.timer.advance(RECONCILE_DELAY_MS);
    expect(c.view.text).toBe(typed);
    expect(c.view.replaced).toBe(0);
    expect(banners).toEqual([]);
    expect(has(c.store, 'Omega')).toBe(true);
    expect(c.view.results.at(-1)?.status).toBe('applied');
    expect(c.view.replaced).toBe(0);
    expect(c.view.banner).toBe(false);
    expect(c.controller.state()).toEqual({ clean: true, canvasChanged: false });
  });

  it('FR-EDT-022: blur applies the waiting text at once, without the pause', () => {
    const c = controlled();
    c.controller.focus();
    c.type(withLabel(c.view.text, 'Alpha', 'Omega'));
    expect(has(c.store, 'Omega')).toBe(false);
    c.controller.blur();
    expect(has(c.store, 'Omega')).toBe(true);
    expect(c.timer.count()).toBe(0);
    expect(c.controller.state().clean).toBe(true);
  });

  it('FR-EDT-022: blur flushes first, and a canvas change that came meanwhile is then regenerated when the view is clean', () => {
    const c = controlled();
    c.controller.focus();
    c.type(withLabel(c.view.text, 'Alpha', 'Omega'));
    change(c, 'Beta');
    expect(c.view.banner).toBe(true);
    c.controller.blur();
    expect(has(c.store, 'Omega')).toBe(true);
    expect(c.view.banner).toBe(false);
    expect(c.view.text).toBe(sourceOf(c.store, c.registries, c.one));
  });

  it('FR-EDT-022: Reload replaces the text, drops the waiting text and the diagnostics, and clears the banner', () => {
    const c = controlled();
    c.type(c.view.text.replace('shape: rect, label: Alpha', 'shape: rectt, label: Alpha'));
    c.timer.advance(300);
    change(c);
    expect(c.view.banner).toBe(true);
    c.type(`${c.view.text}# more`);
    c.controller.reload();
    expect(c.view.text).toBe(sourceOf(c.store, c.registries, c.one));
    expect(c.view.text).toContain('pin: { x: 300, y: 200 }');
    expect(c.view.banner).toBe(false);
    expect(c.view.results.at(-1)).toBeUndefined();
    expect(c.timer.count()).toBe(0);
    expect(c.controller.state()).toEqual({ clean: true, canvasChanged: false });
  });

  it('FR-EDT-022: a canvas change that leaves the screen as it was does nothing, and a change on another screen is not shown', () => {
    const c = controlled();
    change(c, 'Gamma');
    expect(c.view.replaced).toBe(0);
    expect(c.view.banner).toBe(false);
    c.controller.focus();
    change(c, 'Gamma');
    expect(c.view.banner).toBe(false);
  });

  it('FR-EDT-022: after dispose the controller ignores the store', () => {
    const c = controlled();
    c.controller.dispose();
    moveOnCanvas(c);
    c.timer.advance(RECONCILE_DELAY_MS);
    expect(c.view.replaced).toBe(0);
  });

  it('FR-EDT-022: the cursor is found again on the same line below the same slug', () => {
    const c = controlled();
    const text = c.view.text;
    const pos = text.indexOf('label: Beta') + 3;
    const anchor = cursorAnchor(text, pos);
    expect(anchor.key).toBe('b');
    const moved = text.replace('a: { shape: rect, label: Alpha }', 'a: { shape: rect, label: Alpha, pin: { x: 300, y: 200 } }');
    const at = cursorIn(moved, anchor, headerLength(moved));
    expect(moved.slice(at - 3, at + 8)).toBe('label: Beta'.slice(0, 11));
    expect(cursorIn(moved, { key: 'zz', lines: 0, column: 0, pos: 0 }, 12)).toBe(12);
    expect(cursorAnchor('plain', 2).key).toBeUndefined();
  });

  it('FR-EDT-022: a blur toward the banner does not flush the waiting text; leaving the view does, and Reload discards it', () => {
    const c = controlled();
    c.controller.focus();
    c.type(withLabel(c.view.text, 'Alpha', 'Omega'));
    change(c, 'Beta');
    expect(c.view.banner).toBe(true);
    c.controller.blur({ toBanner: true });
    expect(has(c.store, 'Omega')).toBe(false);
    expect(c.view.banner).toBe(true);
    expect(c.timer.count()).toBe(1);
    c.controller.reload();
    expect(has(c.store, 'Omega')).toBe(false);
    expect(c.view.text).toContain('label: Beta, pin:');
    // another try: leaving the whole view flushes
    c.controller.focus();
    c.type(withLabel(c.view.text, 'Alpha', 'Omega'));
    c.controller.blur({ toBanner: true });
    expect(has(c.store, 'Omega')).toBe(false);
    c.controller.blur();
    expect(has(c.store, 'Omega')).toBe(true);
  });

  it('FR-EDT-022: 100 canvas changes before the quiet time pass are looked at once, and a banner that is up needs no look', () => {
    const c = controlled();
    const decompiles = vi.spyOn(c.store, 'toDocument');
    for (let x = 1; x <= 100; x++)
      c.execute('element.update', { id: elementOf(c.store, 'Alpha'), fields: { placement: 'pinned', transform: { x, y: 5, w: 160, h: 80 } } });
    c.timer.advance(RECONCILE_DELAY_MS - 1);
    expect(decompiles).not.toHaveBeenCalled();
    c.timer.advance(1);
    expect(decompiles).toHaveBeenCalledTimes(1);
    expect(c.view.text).toContain('pin: { x: 100, y: 5 }');
    // focused: the banner goes up after one look, and later changes are not looked at
    c.controller.focus();
    change(c, 'Beta');
    expect(c.view.banner).toBe(true);
    decompiles.mockClear();
    change(c, 'Gamma');
    expect(decompiles).not.toHaveBeenCalled();
  });
});

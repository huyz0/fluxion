import { idKeys, sha256Hash128, stableId } from '@fluxion/core';
import type { RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { addRecords, commentOn, elementOf, frameOn, has, manualScheduler, moveOnCanvas, recordOf, setup } from './source-fixture.js';
import { applyMerged, applySource, baseOf, createSourceController, generate, type SourceControllerOptions, type SyncResult, sourceOf } from './source-sync.js';

const derived = (slug: string): RecordId => stableId(sha256Hash128, '', idKeys.node(slug)) as RecordId;

/** A controller over a fake view, as the source-sync tests have it. */
function controlled() {
  const fixture = setup();
  const timer = manualScheduler();
  const view = {
    text: sourceOf(fixture.store, fixture.registries, fixture.one),
    banner: false,
    results: [] as (SyncResult | undefined)[],
    remaps: [] as ReadonlyMap<RecordId, RecordId>[],
  };
  const port: SourceControllerOptions['port'] = {
    text: () => view.text,
    replace: (t) => {
      view.text = t;
    },
    banner: (show) => {
      view.banner = show;
    },
    result: (r) => view.results.push(r),
  };
  const controller = createSourceController({
    ...fixture,
    screen: fixture.one,
    scheduler: timer.scheduler,
    initial: view.text,
    port,
    onRemap: (map) => view.remaps.push(map),
  });
  const type = (text: string) => {
    view.text = text;
    controller.edit(text);
  };
  return { ...fixture, timer, view, controller, type };
}

describe('source view, three-way merge', () => {
  it('FR-EDT-022: an element outside the decompiler subset survives an apply, and so does what points at it', () => {
    const f = setup();
    addRecords(f, [frameOn(f.one), commentOn('kept-frame' as RecordId, 'note')]);
    const text = sourceOf(f.store, f.registries, f.one);
    expect(text).toContain('# kept: 1 records not shown');
    const result = applySource(text.replace('label: Alpha', 'label: Omega'), f.store, f.execute, f.registries);
    expect(result.status).toBe('applied');
    expect(has(f.store, 'Omega')).toBe(true);
    expect(recordOf(f.store, 'kept-frame')).toMatchObject({ kind: 'frame', transform: { x: 600, y: 600, w: 200, h: 120 } });
    expect(recordOf(f.store, 'note')).toMatchObject({ targetId: 'kept-frame' });
    expect(result.dependents ?? 0).toBe(0);
  });

  it('FR-EDT-022: a shape dragged while the view holds unapplied text keeps its new pin after that text is applied', () => {
    const c = controlled();
    c.controller.focus();
    c.type(c.view.text.replace('label: Beta', 'label: Bet'));
    // the canvas pins Alpha meanwhile: the view is dirty, so it only raises the banner
    moveOnCanvas(c);
    c.timer.advance(50);
    expect(c.view.banner).toBe(true);
    c.controller.blur();
    expect(has(c.store, 'Bet')).toBe(true);
    expect(recordOf(c.store, elementOf(c.store, 'Alpha'))).toMatchObject({ placement: 'pinned', transform: { x: 300, y: 200 } });
    // the text did not know the pin: the view is behind the canvas, so it is regenerated (the view is clean and no longer focused)
    expect(c.view.text).toContain('a: { shape: rect, label: Alpha, pin: { x: 300, y: 200 } }');
    expect(c.view.text).toContain('label: Bet');
    expect(c.view.banner).toBe(false);
  });

  it('FR-EDT-022: an apply that leaves the canvas ahead of the text raises the banner, and one that leaves them level clears it', () => {
    const c = controlled();
    c.controller.focus();
    moveOnCanvas(c);
    c.type(c.view.text.replace('label: Beta', 'label: Bet'));
    c.timer.advance(300);
    expect(c.view.results.at(-1)?.status).toBe('applied');
    expect(c.view.banner).toBe(true);
    c.controller.reload();
    c.type(c.view.text.replace('label: Beta', 'label: Bet'));
    c.timer.advance(300);
    expect(c.view.banner).toBe(false);
  });

  it('FR-EDT-022: a field the canvas and the text both changed is written from the text and named', () => {
    const c = controlled();
    const base = baseOf(c.view.text, c.registries, generate(c.store, c.registries, c.one), c.one);
    moveOnCanvas(c);
    const text = c.view.text.replace('a: { shape: rect, label: Alpha }', 'a: { shape: rect, label: Alpha, pin: { x: 10, y: 20 } }');
    const result = applyMerged(text, c, base);
    expect(result.status).toBe('applied');
    expect(recordOf(c.store, elementOf(c.store, 'Alpha'))).toMatchObject({ transform: { x: 10, y: 20 } });
    // b was re-laid out by the pin of a, and the canvas had not touched it: that is no conflict
    expect(result.conflicts).toEqual([{ label: 'a', fields: ['transform.x', 'transform.y'] }]);
  });

  it('FR-EDT-022: a slug renamed in place keeps its record under the id the new slug derives, and every record that pointed at it follows, in one undo step', () => {
    const c = controlled();
    moveOnCanvas(c);
    const alpha = elementOf(c.store, 'Alpha');
    addRecords(c, [commentOn(alpha, 'note')]);
    c.store.history.seal();
    const before = c.store.toDocument();
    const renamed = c.view.text.replace('a: {', 'alp: {').replace('- a -> b', '- alp -> b');
    c.type(renamed);
    c.timer.advance(300);
    const result = c.view.results.at(-1);
    expect(result?.status).toBe('applied');
    const now = derived('alp');
    expect(recordOf(c.store, alpha)).toBeUndefined();
    // the record was moved, not made again: the pin the canvas gave it is still there
    expect(recordOf(c.store, now)).toMatchObject({ semantic: { slug: 'alp', label: 'Alpha' }, placement: 'pinned', transform: { x: 300, y: 200 } });
    expect(recordOf(c.store, 'note')).toMatchObject({ targetId: now });
    const bindings = c.store.members('byType', 'binding').map((id) => recordOf(c.store, id));
    expect(bindings.map((b) => b?.['elementId'])).toContain(now);
    expect(bindings.map((b) => b?.['elementId'])).not.toContain(alpha);
    expect(c.view.remaps.at(-1)?.get(alpha)).toBe(now);
    // the next apply finds nothing left to remap
    expect(applyMerged(renamed, c, result?.base).status).toBe('unchanged');
    c.store.history.undo();
    expect(c.store.toDocument()).toEqual(before);
  });

  it('FR-EDT-022: records the view does not own that point at an element the text deleted are removed, counted, and brought back by undo', () => {
    const c = controlled();
    const beta = elementOf(c.store, 'Beta');
    addRecords(c, [
      commentOn(beta, 'note'),
      { id: 'click', type: 'interaction', ownerId: beta, trigger: { kind: 'onClick' }, actions: [] },
      { id: 'tl', type: 'timeline', screenId: c.one, name: 'main', index: 'a0' },
      {
        id: 'step',
        type: 'step',
        timelineId: 'tl',
        index: 'a0',
        trigger: { kind: 'onClick' },
        animations: [{ id: 'x', effect: 'appear', targets: [beta, elementOf(c.store, 'Alpha')] }],
      },
    ]);
    c.store.history.seal();
    const before = c.store.toDocument();
    const text = c.view.text
      .replace(/ {6}b: \{[^\n]*\n/, '')
      .replace(/ {6}- a -> b\n/, '')
      .replace('    edges:\n', '');
    const result = applySource(text, c.store, c.execute, c.registries);
    expect(result.status).toBe('applied');
    expect(has(c.store, 'Beta')).toBe(false);
    expect(recordOf(c.store, 'note')).toBeUndefined();
    expect(recordOf(c.store, 'click')).toBeUndefined();
    expect(recordOf(c.store, 'step')).toMatchObject({ animations: [{ id: 'x', effect: 'appear', targets: [elementOf(c.store, 'Alpha')] }] });
    expect(result.dependents).toBe(3);
    c.store.history.undo();
    expect(c.store.toDocument()).toEqual(before);
  });

  it('FR-EDT-022: records made by hand, with random ids, are remapped to the ids their slugs derive on the first apply, and what pointed at them follows', () => {
    const c = controlled();
    const [alpha, beta] = [elementOf(c.store, 'Alpha'), elementOf(c.store, 'Beta')];
    // the document as the editor leaves it after hand work: other ids, no kept salt needed
    const doc = c.store.toDocument();
    const swap = (s: string) => s.replaceAll(alpha, 'hand-alpha').replaceAll(beta, 'hand-beta');
    const puts = Object.values(doc.records)
      .filter((r) => JSON.stringify(r).includes(alpha) || JSON.stringify(r).includes(beta))
      .map((r) => JSON.parse(swap(JSON.stringify(r))));
    const deletes = [alpha, beta];
    const handMade = c.execute('document.applyRecords', { puts, deletes });
    expect(handMade.ok).toBe(true);
    addRecords(c, [commentOn('hand-alpha' as RecordId, 'note')]);
    c.store.history.seal();
    const text = sourceOf(c.store, c.registries, c.one);
    // the controller made its base from the document it was given: build a new one over this document
    const timer = manualScheduler();
    const view = { text, remaps: [] as ReadonlyMap<RecordId, RecordId>[] };
    const controller = createSourceController({
      store: c.store,
      execute: c.execute,
      registries: c.registries,
      screen: c.one,
      scheduler: timer.scheduler,
      initial: text,
      port: {
        text: () => view.text,
        replace: (t) => {
          view.text = t;
        },
        banner: () => undefined,
        result: () => undefined,
      },
      onRemap: (map) => view.remaps.push(map),
    });
    view.text = text.replace('label: Beta', 'label: Bet');
    controller.edit(view.text);
    timer.advance(300);
    expect(has(c.store, 'Bet')).toBe(true);
    expect(recordOf(c.store, 'hand-alpha')).toBeUndefined();
    expect(recordOf(c.store, 'hand-beta')).toBeUndefined();
    expect(recordOf(c.store, derived('a'))).toMatchObject({ semantic: { slug: 'a' } });
    expect(recordOf(c.store, 'note')).toMatchObject({ targetId: derived('a') });
    expect(view.remaps.at(-1)?.get('hand-alpha' as RecordId)).toBe(derived('a'));
    const bindings = c.store.members('byType', 'binding').map((id) => recordOf(c.store, id)?.['elementId']);
    expect(bindings).toEqual(expect.arrayContaining([derived('a'), derived('b')]));
    controller.dispose();
  });
});

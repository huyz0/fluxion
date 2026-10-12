import { describe, expect, it } from 'vitest';
import { has, manualScheduler, setup } from './source-fixture.js';
import { applySource, createSourceSync, headerLength, type SyncResult, sourceOf } from './source-sync.js';

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

describe('source view sync, composition', () => {
  const composing = () => {
    const fixture = setup();
    const timer = manualScheduler();
    const state = { on: false };
    const results: SyncResult[] = [];
    const sync = createSourceSync({
      ...fixture,
      scheduler: timer.scheduler,
      composing: () => state.on,
      onResult: (r) => results.push(r),
    });
    return { ...fixture, timer, state, results, sync, text: sourceOf(fixture.store, fixture.registries, fixture.one) };
  };

  it('FR-EDT-022: nothing is compiled while an IME composes, and the text is applied after the pause that follows the composition', () => {
    const c = composing();
    c.state.on = true;
    c.sync.edit(withLabel(c.text, 'Alpha', 'A'));
    c.timer.advance(300);
    c.timer.advance(300);
    expect(c.results).toEqual([]);
    expect(has(c.store, 'A')).toBe(false);
    expect(c.sync.pending()).toBe(true);
    // the held text keeps one pause timer going, so a composition that never reports its end cannot strand it
    expect(c.timer.count()).toBe(1);
    // the end of the composition is the fast path: it schedules the apply at once

    c.sync.edit(withLabel(c.text, 'Alpha', 'Ab'));
    c.state.on = false;
    c.sync.resume();
    c.timer.advance(299);
    expect(c.results).toEqual([]);
    c.timer.advance(1);
    expect(c.results.map((r) => r.status)).toEqual(['applied']);
    expect(has(c.store, 'Ab')).toBe(true);
    expect(has(c.store, 'A')).toBe(false);
  });

  it('FR-EDT-022: a resume with nothing waiting does nothing, and a flush applies a composing text (the view is going)', () => {
    const c = composing();
    c.sync.resume();
    expect(c.timer.count()).toBe(0);
    c.state.on = true;
    c.sync.edit(withLabel(c.text, 'Alpha', 'Omega'));
    c.sync.flush();
    expect(has(c.store, 'Omega')).toBe(true);
  });

  it('FR-EDT-022: a text held by a composition is applied at the first pause after it ends even if no end was reported, and after 10 s of composing at the latest', () => {
    const c = composing();
    c.state.on = true;
    c.sync.edit(withLabel(c.text, 'Alpha', 'Omega'));
    for (let i = 0; i < 5; i++) c.timer.advance(300);
    expect(c.results).toEqual([]);
    c.state.on = false;
    c.timer.advance(300);
    expect(c.results.map((r) => r.status)).toEqual(['applied']);
    expect(has(c.store, 'Omega')).toBe(true);
    // an IME that never ends (a focus change cancelled it): the hold is given up after 10 s
    const stuck = composing();
    stuck.state.on = true;
    stuck.sync.edit(withLabel(stuck.text, 'Alpha', 'Sigma'));
    for (let i = 0; i < 33; i++) stuck.timer.advance(300);
    expect(stuck.results).toEqual([]);
    for (let i = 0; i < 2; i++) stuck.timer.advance(300);
    expect(stuck.results.map((r) => r.status)).toEqual(['applied']);
    expect(has(stuck.store, 'Sigma')).toBe(true);
    expect(stuck.timer.count()).toBe(0);
  });
});

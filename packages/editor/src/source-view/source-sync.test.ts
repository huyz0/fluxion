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

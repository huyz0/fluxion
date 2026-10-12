// Fixtures of the source view's tests (FR-EDT-022): a document loaded from a two-screen source, and a timer advanced by hand.
import { type Core, createCore, type ShapeDef } from '@fluxion/core';
import { compile } from '@fluxion/dsl';
import { type RecordId, seededRandom } from '@fluxion/schema';
import { newDocument } from '../new-document.js';
import type { Scheduler } from './source-sync.js';

export const SOURCE =
  'flux: 1\ntitle: Sync\nuses: [basic]\nscreens:\n- id: one\n  title: One\n  nodes:\n    a: { shape: rect, label: Alpha }\n    b: { shape: rect, label: Beta }\n  edges:\n  - a -> b\n- id: two\n  title: Two\n  nodes:\n    c: { shape: rect, label: Gamma }\n';

/** A core holding the two-screen source, and the id of its first screen. */
export function setup(): Core & { readonly one: RecordId } {
  const core = createCore(newDocument(seededRandom(5)));
  core.registries.shapeDefs.register('basic:rect', { id: 'basic:rect' } as unknown as ShapeDef, 'basic');
  const loaded = compile(SOURCE, { registries: core.registries, base: core.store.toDocument() });
  // the document as a streamed source leaves it: its screens in, the empty first screen gone
  core.execute('document.applyRecords', {
    puts: Object.values(loaded.doc?.records ?? {}),
    deletes: core.store.members('byType', 'screen').filter((id) => !(id in (loaded.doc?.records ?? {}))),
  });
  core.store.history.seal();
  const one = core.store.members('byType', 'screen').find((id) => (core.store.get(id) as { meta?: { slug?: string } }).meta?.slug === 'one');
  if (one === undefined) throw new Error('no screen one');
  return { ...core, one };
}

/** A timer the test advances by hand. */
/** A scheduler the test advances by hand. */
export function manualScheduler(): { readonly scheduler: Scheduler; readonly advance: (ms: number) => void; readonly count: () => number } {
  const pending = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let next = 0;
  const scheduler: Scheduler = {
    set: (run, ms) => {
      pending.set(++next, { at: now + ms, run });
      return next;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, p] of [...pending]) {
      if (p.at <= now) {
        pending.delete(id);
        p.run();
      }
    }
  };
  return { scheduler, advance, count: () => pending.size };
}

/** Whether some element of the document holds `text` as a whole string (a label of a node). */
export const has = (store: Core['store'], text: string): boolean =>
  store.members('byType', 'element').some((id) => JSON.stringify(store.get(id)).includes(`"${text}"`));

/** The element that shows `label`. */
export const elementOf = (store: Core['store'], label: string): RecordId => {
  const id = store.members('byType', 'element').find((i) => JSON.stringify(store.get(i)).includes(`"${label}"`));
  if (id === undefined) throw new Error(`no element ${label}`);
  return id;
};

/** A change from the canvas: pin the element that shows `label` at (300, 200). */
export function moveOnCanvas(fixture: Pick<Core, 'store' | 'execute'>, label = 'Alpha'): void {
  const id = elementOf(fixture.store, label);
  const result = fixture.execute('element.update', { id, fields: { placement: 'pinned', transform: { x: 300, y: 200, w: 160, h: 80 } } });
  if (!result.ok) throw new Error(result.error.message);
}

/** A change from the canvas side: the document's title. */
export function retitle(fixture: Pick<Core, 'execute'>, title: string): void {
  const result = fixture.execute('document.updateMeta', { fields: { title }, modified: '2026-01-01T00:00:00.000Z' });
  if (!result.ok) throw new Error(result.error.message);
}

/** Records made beside the source's: what a person or another tool added to the document (an element the grammar cannot say, a comment). */
export function addRecords(fixture: Pick<Core, 'execute'>, puts: readonly object[]): void {
  const result = fixture.execute('document.applyRecords', { puts, deletes: [] });
  if (!result.ok) throw new Error(result.error.message);
}

/** A frame on `screen`: an element the decompiler leaves out. */
export const frameOn = (screen: RecordId, id = 'kept-frame'): object => ({
  id,
  type: 'element',
  kind: 'frame',
  screenId: screen,
  index: 'a8',
  transform: { x: 600, y: 600, w: 200, h: 120 },
});

/** A comment on `target`. */
export const commentOn = (target: RecordId, id: string): object => ({ id, type: 'comment', targetId: target, author: 'ada', body: `on ${target}` });

/** The record `id` of the document, loosely. */
export const recordOf = (store: Core['store'], id: string): Record<string, unknown> | undefined =>
  store.get(id as RecordId) as unknown as Record<string, unknown> | undefined;

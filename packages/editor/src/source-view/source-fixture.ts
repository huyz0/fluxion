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

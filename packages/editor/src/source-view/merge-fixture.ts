// Records of the merge tests (FR-EDT-022): a block of a screen (nodes a and b with an edge, a group g holding c), and what a document holds beside it.
import type { MergeResult, Recs } from './merge.js';
import type { Rec } from './remap.js';

export const rec = (r: Record<string, unknown>): Rec => r as unknown as Rec;
export const table = (list: readonly Rec[]): Recs => Object.fromEntries(list.map((r) => [r.id, r]));

export const node = (id: string, slug: string, extra: Record<string, unknown> = {}): Rec =>
  rec({
    id,
    type: 'element',
    screenId: 'S',
    kind: 'shape',
    defId: 'basic:rect',
    semantic: { slug, label: slug.toUpperCase() },
    placement: 'auto',
    transform: { x: 80, y: 80, w: 160, h: 80 },
    index: extra['index'] ?? 'a0',
    ...extra,
  });
export const edge = (id: string, extra: Record<string, unknown> = {}): Rec =>
  rec({ id, type: 'element', screenId: 'S', kind: 'connector', route: { type: 'straight' }, markers: { start: 'none', end: 'arrow' }, index: 'a9', ...extra });
export const binding = (id: string, connectorId: string, end: 'source' | 'target', elementId: string): Rec =>
  rec({ id, type: 'binding', connectorId, end, elementId, anchor: { kind: 'auto' } });

/** The block of the fixture: a screen, nodes a and b with an edge, and a group g holding c. */
export const blockRecords = (): Rec[] => [
  rec({ id: 'S', type: 'screen', index: 'a0', meta: { slug: 'one' }, name: 'One' }),
  node('a', 'a', { index: 'a0' }),
  node('b', 'b', { index: 'a1', transform: { x: 80, y: 184, w: 160, h: 80 } }),
  rec({
    id: 'g',
    type: 'element',
    screenId: 'S',
    kind: 'group',
    semantic: { slug: 'g', label: 'G' },
    index: 'a2',
    transform: { x: 0, y: 300, w: 200, h: 100 },
  }),
  node('c', 'c', { parentId: 'g', index: 'a0' }),
  edge('e'),
  binding('eb1', 'e', 'source', 'a'),
  binding('eb2', 'e', 'target', 'b'),
];
export const base = (): Recs => table(blockRecords());

/** What the document holds beside the block: an image in the group, an image on the screen, and records that point at the block. */
export const keptRecords = (): Rec[] => [
  rec({ id: 'doc', type: 'document', title: 'T' }),
  rec({ id: 'img-in-g', type: 'element', screenId: 'S', kind: 'image', parentId: 'g', index: 'a1' }),
  rec({ id: 'img', type: 'element', screenId: 'S', kind: 'image', index: 'a3' }),
  rec({ id: 'note-a', type: 'comment', targetId: 'a', author: 'x', body: 'on a' }),
  rec({ id: 'note-img', type: 'comment', targetId: 'img', author: 'x', body: 'on the image' }),
  rec({ id: 'click-a', type: 'interaction', ownerId: 'a', trigger: { kind: 'onClick' }, actions: [] }),
  rec({
    id: 'click-img',
    type: 'interaction',
    ownerId: 'img',
    trigger: { kind: 'onClick' },
    actions: [
      { do: 'toggle', targets: ['a', 'b'] },
      { do: 'zoomTo', target: 'a' },
    ],
  }),
  rec({ id: 'tl', type: 'timeline', screenId: 'S', name: 'main', index: 'a0' }),
  rec({ id: 'st', type: 'step', timelineId: 'tl', index: 'a0', trigger: { kind: 'onClick' }, animations: [{ effect: 'appear', targets: ['a', 'img'] }] }),
  rec({ id: 'img-link', type: 'element', screenId: 'S', kind: 'connector', index: 'a4', freeSource: { x: 0, y: 0 } }),
  binding('img-link-b', 'img-link', 'target', 'a'),
];
export const document = (patch: (all: Recs) => Recs = (all) => all): Recs => patch(table([...blockRecords(), ...keptRecords()]));

export const withRec = (all: Recs, r: Rec): Recs => ({ ...all, [r.id]: r });
export const without = (all: Recs, ...ids: string[]): Recs => Object.fromEntries(Object.entries(all).filter(([id]) => !ids.includes(id)));
export const patched = (all: Recs, id: string, fields: Record<string, unknown>): Recs => withRec(all, { ...(all[id] as Rec), ...fields } as Rec);

/** The document after the result is applied. */
export function applied(current: Recs, result: MergeResult): Recs {
  const out: { [id: string]: Rec } = { ...current };
  for (const id of result.deletes) delete out[id];
  for (const r of result.puts) out[r.id] = r;
  return out;
}

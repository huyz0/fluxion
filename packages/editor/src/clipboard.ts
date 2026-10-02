// The editor's clipboard (FR-EDT-007, ADR-0020, M7.21): copy, cut, paste and duplicate of elements within a
// document. What is copied is a payload in the format ADR-0020 fixes (M7.22 puts it on the system clipboard and
// reads it back, across documents and tabs): the elements and their members, and the bindings whose both ends were
// copied; an end whose element was not copied becomes free at the point it had. Pasting remaps every id through the
// editor's id source, puts the roots in front of the screen, offsets everything by +16 px per paste of the same
// payload, and writes it all as one undo step. Pure but for the commands `pasteInto` runs.
import type { ReadView } from '@fluxion/core';
import { type Box, boxUnion, type Vec2 } from '@fluxion/geometry';
import { type AnyRecord, compareKeys, nKeysBetween, type RecordId, SCHEMA_VERSION } from '@fluxion/schema';
import { frontIndex } from './create-tool.js';
import type { Execute } from './pointer.js';

/**
 * What is on the clipboard: records copied from a document (ADR-0020 §payload).
 *
 * @public
 */
export type ClipboardPayload = {
  /** Marks the payload as the editor's. */
  readonly fluxion: 'clipboard';
  /** The payload format's version. */
  readonly version: 1;
  /** The schema version of the records. */
  readonly schemaVersion: string;
  /** The document they were copied from. */
  readonly sourceDocId: string;
  /** The screen they were copied from, if the copy came from one. */
  readonly sourceScreen: RecordId | undefined;
  /** The copied elements (members included) and the bindings between them. */
  readonly records: readonly AnyRecord[];
  /** The box the copied roots cover, page units. */
  readonly bounds: Box | undefined;
};

/**
 * The distance each paste of one payload is offset by, page px (ADR-0020).
 *
 * @public
 */
export const PASTE_OFFSET = 16;

type Rec = AnyRecord & {
  readonly index?: string;
  readonly screenId?: RecordId;
  readonly parentId?: RecordId;
  readonly transform?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly freeSource?: Vec2;
  readonly freeTarget?: Vec2;
  readonly route?: { readonly waypoints?: readonly Vec2[] } & { readonly [field: string]: unknown };
  readonly kind?: string;
  readonly semantic?: { readonly slug?: unknown } & { readonly [field: string]: unknown };
  readonly connectorId?: RecordId;
  readonly elementId?: RecordId;
  readonly end?: 'source' | 'target';
};

/** `id` and its members, all the way down. */
const withMembers = (view: ReadView, id: RecordId): RecordId[] => [id, ...view.members('byParent', id).flatMap((m) => withMembers(view, m))];

/** The bindings that join two copied elements, from the bindings of each copied element. */
function innerBindings(view: ReadView, ids: ReadonlySet<RecordId>): readonly Rec[] {
  const found = new Map<string, Rec>();
  for (const id of ids)
    for (const b of view.members('bindingsByElement', id)) {
      const r = view.get(b) as Rec | undefined;
      if (r?.type === 'binding' && r.connectorId !== undefined && r.elementId !== undefined && ids.has(r.connectorId) && ids.has(r.elementId)) found.set(b, r);
    }
  return [...found.values()];
}

/**
 * The payload copying the elements `ids` (and their members) of `view`; undefined when none is an element. A
 * connector is copied with the point each of its ends has (`endPoint`), so an end whose element was not copied stays
 * free there when pasted, and a bound one has a point until its binding is written.
 *
 * @public
 */
export function copyPayload(
  view: ReadView,
  ids: readonly RecordId[],
  source: { readonly docId: string; readonly screen: RecordId | undefined; readonly endPoint?: (id: RecordId, end: 'source' | 'target') => Vec2 | undefined },
): ClipboardPayload | undefined {
  const all = [...new Set(ids.flatMap((id) => withMembers(view, id)))].filter((id) => view.get(id)?.type === 'element');
  if (all.length === 0) return undefined;
  const set = new Set(all);
  const bindings = innerBindings(view, set);
  const elements = all.map((id) => {
    const r = view.get(id) as Rec;
    if (r.kind !== 'connector') return r;
    // every end is copied with the point it has: a bound end needs one to exist until its binding is written (as when a
    // connector is made), and an end whose binding was not copied stays there, free
    const free = (end: 'source' | 'target'): Record<string, Vec2> => {
      const at = source.endPoint?.(id, end);
      return at === undefined ? {} : { [end === 'source' ? 'freeSource' : 'freeTarget']: at };
    };
    return { ...r, ...free('source'), ...free('target') } as Rec;
  });
  const roots = elements.filter((e) => e.parentId === undefined || !set.has(e.parentId));
  const bounds = roots
    .flatMap((e) => (e.transform ? [{ x: e.transform.x, y: e.transform.y, w: e.transform.w, h: e.transform.h }] : []))
    .reduce<Box | undefined>((u, b) => (u === undefined ? b : boxUnion(u, b)), undefined);
  return {
    fluxion: 'clipboard',
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    sourceDocId: source.docId,
    sourceScreen: source.screen,
    records: [...elements, ...bindings],
    bounds,
  };
}

const shift = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/** `r` without the semantic slug, which names one element only. */
function withoutSlug(r: Rec): Rec {
  if (r.semantic?.slug === undefined) return r;
  const { slug: _slug, ...rest } = r.semantic;
  const { semantic: _semantic, ...others } = r;
  return (Object.keys(rest).length === 0 ? others : { ...others, semantic: rest }) as Rec;
}

/** The element `r` moved by `d`: its box, free ends and waypoints. */
function offsetBy(r: Rec, d: Vec2): Rec {
  return {
    ...r,
    ...(r.transform && { transform: { ...r.transform, ...shift(r.transform, d) } }),
    ...(r.freeSource && { freeSource: shift(r.freeSource, d) }),
    ...(r.freeTarget && { freeTarget: shift(r.freeTarget, d) }),
    ...(r.route?.waypoints && { route: { ...r.route, waypoints: r.route.waypoints.map((w) => shift(w, d)) } }),
  } as Rec;
}

/**
 * What a paste writes.
 *
 * @public
 */
export type PastePlan = {
  /** The elements, with fresh ids. */
  readonly elements: readonly AnyRecord[];
  /** The bindings between them, with fresh ids. */
  readonly bindings: readonly AnyRecord[];
};

/**
 * What pasting `payload` writes: its elements with fresh ids (members under their copied parent, roots on
 * `screen` with the `indexes` given in order), offset by `by`, and its bindings with fresh ids between the fresh
 * elements.
 *
 * @public
 */
export function planPaste(
  payload: ClipboardPayload,
  target: { readonly screen: RecordId; readonly indexes: readonly string[]; readonly by: Vec2; readonly newId: () => RecordId },
): PastePlan {
  const { screen, indexes, by, newId } = target;
  const elements = payload.records.filter((r) => r.type === 'element') as Rec[];
  const renamed = new Map(elements.map((e) => [e.id as RecordId, newId()] as const));
  const roots = elements.filter((e) => e.parentId === undefined || !renamed.has(e.parentId)).sort((a, b) => compareKeys(String(a.index), String(b.index)));
  const rootIndex = new Map(roots.map((e, k) => [e.id as RecordId, indexes[k]] as const));
  const pasted = elements.map((e) => {
    const root = rootIndex.has(e.id as RecordId);
    const { parentId: _parent, ...rest } = withoutSlug(offsetBy(e, by));
    return {
      ...rest,
      id: renamed.get(e.id as RecordId),
      screenId: screen,
      ...(root ? { index: rootIndex.get(e.id as RecordId) } : { parentId: renamed.get(e.parentId as RecordId) }),
    } as unknown as AnyRecord;
  });
  const bindings = (payload.records.filter((r) => r.type === 'binding') as Rec[]).map(
    (b) =>
      ({ ...b, id: newId(), connectorId: renamed.get(b.connectorId as RecordId), elementId: renamed.get(b.elementId as RecordId) }) as unknown as AnyRecord,
  );
  return { elements: pasted, bindings };
}

/**
 * What pasting needs: the document to read, the command runner, the screen pasted onto, and fresh ids.
 *
 * @public
 */
export type PasteDeps = {
  /** The document. */
  readonly view: ReadView;
  /** Runs a command. */
  readonly execute: Execute;
  /** Closes the undo step. */
  seal(): void;
  /** The screen pasted onto. */
  readonly screen: RecordId | undefined;
  /** A fresh record id. */
  newId(): RecordId;
};

/**
 * Paste `payload` onto the deps' screen, offset by `by`, as one undo step; the ids of the pasted roots, or
 * undefined when nothing was pasted (no screen, or the document refused it).
 *
 * @public
 */
export function pasteInto(deps: PasteDeps, payload: ClipboardPayload, by: Vec2): readonly RecordId[] | undefined {
  const { view, execute, screen } = deps;
  if (screen === undefined) return undefined;
  const rootCount = (payload.records.filter((r) => r.type === 'element') as Rec[]).filter(
    (e, _k, all) => e.parentId === undefined || !all.some((o) => o.id === e.parentId),
  ).length;
  const front = frontIndex(view, screen);
  const more = front === undefined ? undefined : nKeysBetween(front, null, rootCount - 1);
  if (front === undefined || more === undefined || !more.ok) return undefined;
  const plan = planPaste(payload, { screen, indexes: [front, ...more.value], by, newId: deps.newId });
  const mergeKey = `paste:${plan.elements[0]?.id}`;
  const made = execute('element.createMany', { elements: plan.elements }, { mergeKey });
  if (made.ok)
    // a binding the document refuses leaves that end where it was copied
    for (const b of plan.bindings as unknown as Rec[])
      execute(
        'binding.set',
        { id: b.id, connectorId: b.connectorId, end: b.end, elementId: b.elementId, anchor: (b as { anchor?: unknown }).anchor ?? { kind: 'auto' } },
        { mergeKey },
      );
  deps.seal();
  if (!made.ok) return undefined;
  const pastedIds = new Set(plan.elements.map((e) => e.id));
  return (plan.elements as unknown as Rec[]).filter((e) => e.parentId === undefined || !pastedIds.has(e.parentId)).map((e) => e.id as RecordId);
}

/**
 * The clipboard of an editor: the payload last copied and how many times it has been pasted.
 *
 * @public
 */
export type Clipboard = {
  /** The payload, if one was copied. */
  get(): ClipboardPayload | undefined;
  /** Put a payload on the clipboard (the paste count starts again). */
  set(payload: ClipboardPayload): void;
  /** How many times the payload has been pasted. */
  pastes(): number;
  /** Count one more paste of the payload (after one was made). */
  countPaste(): void;
};

/**
 * An empty clipboard.
 *
 * @public
 */
export function createClipboard(): Clipboard {
  let payload: ClipboardPayload | undefined;
  let pastes = 0;
  return {
    get: () => payload,
    set: (p) => {
      payload = p;
      pastes = 0;
    },
    pastes: () => pastes,
    countPaste: () => {
      pastes++;
    },
  };
}

// The editor's clipboard (FR-EDT-007, ADR-0020, M7.21): copy, cut, paste and duplicate of elements within a
// document. What is copied is a payload in the format ADR-0020 fixes (M7.22 puts it on the system clipboard and
// reads it back, across documents and tabs): the elements and their members, and the bindings whose both ends were
// copied; an end whose element was not copied becomes free at the point it had. Pasting remaps every id through the
// editor's id source, puts the roots in front of the screen, offsets everything by +16 px per paste of the same
// payload, and writes it all as one undo step. Pure but for the commands `pasteInto` runs.
import type { ReadView } from '@fluxion/core';
import { type Box, boxUnion, type Vec2 } from '@fluxion/geometry';
import { type AnyRecord, type AssetRecord, compareKeys, nKeysBetween, type RecordId, SCHEMA_VERSION } from '@fluxion/schema';
import type { AssetStore } from './asset-store.js';
import { type ClipboardAsset, makeAssets, planAssets } from './clipboard-assets.js';
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
  /** The assets the copied elements use. */
  readonly assets: readonly ClipboardAsset[];
  /** The box the copied roots cover, page units. */
  readonly bounds: Box | undefined;
};

/** The most a `data:` URL may weigh to travel inside a payload (1 MB of bytes as base64, ADR-0020). */
const MAX_INLINE_ASSET = Math.ceil((1024 * 1024 * 4) / 3) + 64;

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

/** The asset ids the records refer to, anywhere in them (an image element's, an image fill's). */
function assetIdsIn(value: unknown, found: Set<string> = new Set()): ReadonlySet<string> {
  if (Array.isArray(value)) for (const v of value) assetIdsIn(v, found);
  else if (typeof value === 'object' && value !== null)
    for (const [k, v] of Object.entries(value)) {
      if (k === 'assetId' && typeof v === 'string') found.add(v);
      else assetIdsIn(v, found);
    }
  return found;
}

/** `value` with every asset id replaced through `map` (the others are left). */
function withAssetIds<T>(value: T, map: ReadonlyMap<string, RecordId>): T {
  if (Array.isArray(value)) return value.map((v) => withAssetIds(v, map)) as T;
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, k === 'assetId' && typeof v === 'string' ? (map.get(v) ?? v) : withAssetIds(v, map)]),
  ) as T;
}

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
  source: {
    readonly docId: string;
    readonly screen: RecordId | undefined;
    readonly endPoint?: (id: RecordId, end: 'source' | 'target') => Vec2 | undefined;
    /** An asset's bytes as a `data:` URL, if the host holds them. */
    readonly assetData?: ((id: RecordId) => string | undefined) | undefined;
  },
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
  const assets = [...assetIdsIn(elements)].flatMap((id): ClipboardAsset[] => {
    const r = view.get(id as RecordId);
    if (r?.type !== 'asset') return [];
    const dataUrl = source.assetData?.(id as RecordId);
    return [{ ...(r as AssetRecord), ...(dataUrl !== undefined && dataUrl.length <= MAX_INLINE_ASSET && { dataUrl }) }];
  });
  return {
    fluxion: 'clipboard',
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    sourceDocId: source.docId,
    sourceScreen: source.screen,
    records: [...elements, ...bindings],
    assets,
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
  target: {
    readonly screen: RecordId;
    readonly indexes: readonly string[];
    readonly by: Vec2;
    readonly newId: () => RecordId;
    /** For a source asset id, the target document's asset with the same bytes, where it holds one. */
    readonly assets?: ReadonlyMap<string, RecordId>;
  },
): PastePlan {
  const { screen, indexes, by, newId } = target;
  const sameAssets = target.assets ?? new Map<string, RecordId>();
  const elements = payload.records.filter((r) => r.type === 'element') as Rec[];
  const renamed = new Map(elements.map((e) => [e.id as RecordId, newId()] as const));
  const roots = elements.filter((e) => e.parentId === undefined || !renamed.has(e.parentId)).sort((a, b) => compareKeys(String(a.index), String(b.index)));
  const rootIndex = new Map(roots.map((e, k) => [e.id as RecordId, indexes[k]] as const));
  const pasted = elements.map((e) => {
    const root = rootIndex.has(e.id as RecordId);
    const { parentId: _parent, ...rest } = withAssetIds(withoutSlug(offsetBy(e, by)), sameAssets);
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
  /** Where the bytes of the document's assets are held: a pasted asset with bytes is held here under its new id. */
  readonly assets?: AssetStore | undefined;
};

/**
 * `payload` without the elements that name an asset the document does not have and could not be given (the document
 * refuses a reference to nothing), their members, and the bindings that joined them.
 */
function withoutMissingAssets(payload: ClipboardPayload, view: ReadView, made: ReadonlyMap<string, RecordId>): ClipboardPayload {
  const present = (id: string) => made.has(id) || view.get(id as RecordId)?.type === 'asset';
  const dropped = new Set<string>();
  const elements = payload.records.filter((r) => r.type === 'element') as Rec[];
  for (const e of elements) if ([...assetIdsIn(e)].some((id) => !present(id))) dropped.add(e.id as string);
  // members go with the parent they hang from, however deep
  for (let grew = true; grew; ) {
    grew = false;
    for (const e of elements) if (e.parentId !== undefined && dropped.has(e.parentId) && !dropped.has(e.id as string)) grew = !!dropped.add(e.id as string);
  }
  if (dropped.size === 0) return payload;
  const kept = payload.records.filter(
    (r) =>
      !dropped.has(r.id as string) && !(r.type === 'binding' && (dropped.has((r as Rec).connectorId as string) || dropped.has((r as Rec).elementId as string))),
  );
  return { ...payload, records: kept };
}

/**
 * Paste `payload` onto the deps' screen, offset by `by`, as one undo step; the ids of the pasted roots, or
 * undefined when nothing was pasted (no screen, or the document refused it).
 *
 * @public
 */
export function pasteInto(deps: PasteDeps, payload: ClipboardPayload, by: Vec2): readonly RecordId[] | undefined {
  const { view, execute, screen } = deps;
  if (screen === undefined) return undefined;
  const assetPlan = planAssets(deps, payload);
  const assets = assetPlan.ids;
  const pasting = withoutMissingAssets(payload, view, assets);
  const rootCount = (pasting.records.filter((r) => r.type === 'element') as Rec[]).filter(
    (e, _k, all) => e.parentId === undefined || !all.some((o) => o.id === e.parentId),
  ).length;
  const front = frontIndex(view, screen);
  const more = front === undefined || rootCount === 0 ? undefined : nKeysBetween(front, null, rootCount - 1);
  if (front === undefined || more === undefined || !more.ok) return undefined;
  // only now that something will be pasted: the assets it names are made, and their bytes held
  const mergeKey = `paste:${deps.newId()}`;
  makeAssets(deps, assetPlan, mergeKey);
  const plan = planPaste(pasting, { screen, indexes: [front, ...more.value], by, newId: deps.newId, assets });
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
  /** Take `payload` (read off the system clipboard as `json`, or just written as it): a payload that is not the one held starts a new count. */
  adopt(payload: ClipboardPayload, json: string): void;
  /** An asset's bytes as a `data:` URL, if the editor holds them (a copy carries them). */
  readonly assetData?: ((id: RecordId) => string | undefined) | undefined;
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
export function createClipboard(assetData?: (id: RecordId) => string | undefined): Clipboard {
  let payload: ClipboardPayload | undefined;
  let pastes = 0;
  let held: string | undefined;
  return {
    assetData,
    get: () => payload,
    set: (p) => {
      payload = p;
      pastes = 0;
      held = undefined;
    },
    adopt: (p, json) => {
      if (json === held) return;
      payload = p;
      pastes = 0;
      held = json;
    },
    pastes: () => pastes,
    countPaste: () => {
      pastes++;
    },
  };
}

export type { ClipboardAsset };

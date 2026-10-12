// The three-way merge of the Source view's apply (FR-EDT-022, ADR-0032 "Text to canvas"). Pure: records in, the `puts` and `deletes` of one
// `document.applyRecords` out.
//
// Three sets of records meet: `base`, the compile of the text as last generated or applied; `next`, the compile of the text now; `current`, the
// document. Only what differs between `base` and `next` is written, field by field, so a field the author did not touch keeps the document's value even
// when the canvas changed it meanwhile. A field both changed is written from the text (the author's latest action) and reported as a conflict. The
// source OWNS the records of `base` and `next` (the block's screen, its nodes, groups and edges, and their bindings): a record of `current` that is in
// neither is never written, but it follows what happens to the owned records it points at:
//   - an owned record missing from `next` is deleted. Its dependents go with it: a comment, interaction, binding or step that pointed at it is deleted
//     or loses the reference (`scrubRecord`); an element of the document that the block does not show but sits inside a deleted group is moved to the
//     group's parent (the screen, when there is none) and keeps its place on the canvas, it is not deleted;
//   - a slug renamed in the text is an id remap, not a delete and an add: a removed owned record and an added one that are the same but for the slug
//     (ids and `index` aside) are one record under a new id, and every record that held the old id is rewritten;
//   - a record of `current` whose id is not the one its slug derives (made by hand: ADR-0031's random ids) is remapped to the derived id the same way.
//     `alias` says which document record each record of `base` is.
// Other decisions: `index` (the z-order) is never written for an existing record, a new record goes on top of its siblings and a record moved to another
// parent is put on top there, so no two siblings share an index; a screen is never deleted by an apply (only renamed); the transform of an element that
// both texts leave to the layout (`placement` not pinned) is the layout's output, not the author's, so it never replaces the pin the canvas gave it.
import { nKeysBetween } from '@fluxion/schema';
import { diffRecords, type RecordsById, sameValue } from '../record-diff.js';
import { type Rec, remapRecord, scrubRecord } from './remap.js';

/** The records of a compile or of a document, by id. */
export type Recs = { readonly [id: string]: Rec };

/** What the merge reads. */
export type MergeInput = {
  /** The records the text last generated or applied compiles to. */
  readonly base: Recs;
  /** The records the text compiles to now. */
  readonly next: Recs;
  /** Every record of the document. */
  readonly current: Recs;
  /** The id in `current` of the record of `base` that has another id there (a record made by hand). */
  readonly alias?: ReadonlyMap<string, string>;
};

/** A record the text and the canvas both changed: the text's value was written. */
export type MergeConflict = {
  /** The record's slug (its id when it has none). */
  readonly label: string;
  /** The changed fields by path (`transform.x`); `*` is a record the canvas deleted and the text changed. */
  readonly fields: readonly string[];
};

/** What the merge wants written. */
export type MergeResult = {
  /** The records to put. */
  readonly puts: Rec[];
  /** The ids to delete. */
  readonly deletes: string[];
  /** The records the canvas changed that the text overwrote. */
  readonly conflicts: readonly MergeConflict[];
  /** How many records outside the block were deleted or lost a reference because the element they pointed at went. */
  readonly dependents: number;
  /** The slugs of removed nodes that could not be paired with an added one (the same shape came and went more than once) and lost a comment, interaction or canvas field with it. */
  readonly unpaired: readonly string[];
  /** Each document id that changes, to the id it becomes. */
  readonly remap: ReadonlyMap<string, string>;
};

type Obj = { [key: string]: unknown };
type Work = { [id: string]: Rec };

const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fields the merge never writes of an existing record. */
const KEPT_KEYS: ReadonlySet<string> = new Set(['id', 'type', 'index']);
/** Fields merged one level down: an edit of `transform.x` does not clobber a canvas edit of `transform.w`. */
const NESTED: ReadonlySet<string> = new Set(['transform', 'style', 'semantic', 'meta', 'params']);

// ---- the field merge ---------------------------------------------------------------------------------------------------------------------------

/** The same field of a record in the base compile, the new compile and the document. */
type Trio = { readonly b: Obj; readonly n: Obj; readonly c: Obj };

/** Whether `transform` is the layout's: neither text pins the element, and the canvas has (a pin of the canvas is not the layout's to move). */
const layoutOnly = (t: Trio): boolean => t.b['placement'] !== 'pinned' && t.n['placement'] !== 'pinned' && t.c['placement'] === 'pinned';

/** Whether the merge leaves `key` as the document has it: the text did not change it, or it is not the text's to write. */
const leaves = (t: Trio, key: string, top: boolean): boolean =>
  sameValue(t.n[key], t.b[key]) || (top && (KEPT_KEYS.has(key) || (key === 'transform' && layoutOnly(t))));

/** Where a merge writes: the path of the object being merged (empty at the record), the object and the conflicts so far. */
type Into = { readonly path: string; readonly out: Obj; readonly conflicts: string[] };

/** Whether a nested key is merged sub-field by sub-field: each of its three values is an object or missing, and one is an object (a scalar anywhere is written whole). */
const nestable = (...values: unknown[]): boolean => values.every((v) => v === undefined || isObject(v)) && values.some(isObject);
const asObject = (v: unknown): Obj => (isObject(v) ? v : {});

/** What `key` of the document's record comes to: the text's value, field by field one level down for the nested ones; a field both changed is a conflict. */
function mergeKey(t: Trio, key: string, into: Into): void {
  const { path, out, conflicts } = into;
  const [bv, nv, cv] = [t.b[key], t.n[key], t.c[key]];
  const at = path === '' ? key : `${path}.${key}`;
  if (path === '' && NESTED.has(key) && nestable(bv, nv, cv)) {
    const merged = mergeFields({ b: asObject(bv), n: asObject(nv), c: asObject(cv) }, at, conflicts);
    if (Object.keys(merged).length === 0) delete out[key];
    else out[key] = merged;
    return;
  }
  if (!sameValue(cv, bv) && !sameValue(cv, nv)) conflicts.push(at);
  if (nv === undefined) delete out[key];
  else out[key] = nv;
}

function mergeFields(t: Trio, path: string, conflicts: string[]): Obj {
  const out: Obj = { ...t.c };
  for (const key of new Set([...Object.keys(t.b), ...Object.keys(t.n)])) if (!leaves(t, key, path === '')) mergeKey(t, key, { path, out, conflicts });
  return out;
}

// ---- indexes -----------------------------------------------------------------------------------------------------------------------------------

/** What a record's `index` orders it among, or undefined for a record that has none. */
function siblings(r: Rec): string | undefined {
  if (typeof r['index'] !== 'string') return undefined;
  return r.type === 'element' ? `element/${String(r['screenId'])}/${String(r['parentId'] ?? '')}` : r.type;
}

/** `record` with an index after those of its siblings in `work`. */
function onTop(record: Rec, work: Work): Rec {
  const group = siblings(record);
  if (group === undefined) return record;
  const taken = Object.values(work)
    .filter((r) => r.id !== record.id && siblings(r) === group)
    .map((r) => String(r['index']))
    .sort();
  const key = nKeysBetween(taken.at(-1) ?? null, null, 1);
  return key.ok ? ({ ...record, index: key.value[0] } as Rec) : record;
}

// ---- renames -----------------------------------------------------------------------------------------------------------------------------------

/** `value` as JSON with the keys sorted. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (!isObject(value)) return JSON.stringify(value) ?? 'null';
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(value[k])}`)
    .join(',')}}`;
}

/** What a record is when its id, its slug, its place among its siblings and its parent are left out. */
function signature(record: Rec, renamed: ReadonlyMap<string, string>): string {
  const { id: _id, index: _index, parentId: _parent, ...rest } = remapRecord(record, renamed);
  const { slug: _slug, ...semantic } = (rest['semantic'] ?? {}) as Obj;
  return canon({ ...rest, ...(rest['semantic'] === undefined ? {} : { semantic }) });
}

/** The removed records each rename map could not pair because the same shape was removed or added more than once. */
const AMBIGUOUS = new WeakMap<Map<string, string>, string[]>();

/** Pair each removed record with the added one of its signature, when there is exactly one of each. */
function pair(out: Map<string, string>, removed: readonly Rec[], added: readonly Rec[], sign: (r: Rec, side: 'removed' | 'added') => string): void {
  const group = (list: readonly Rec[], side: 'removed' | 'added'): Map<string, Rec[]> => {
    const by = new Map<string, Rec[]>();
    for (const r of list) by.set(sign(r, side), [...(by.get(sign(r, side)) ?? []), r]);
    return by;
  };
  const adds = group(added, 'added');
  for (const [key, olds] of group(removed, 'removed')) {
    const news = adds.get(key);
    if (olds.length === 1 && news?.length === 1) out.set((olds[0] as Rec).id, (news[0] as Rec).id);
    else if (news !== undefined) AMBIGUOUS.set(out, [...(AMBIGUOUS.get(out) ?? []), ...olds.map((r) => r.id)]);
  }
}

const kindOf = (r: Rec): unknown => r['kind'];
const isNode = (r: Rec): boolean => r.type === 'element' && kindOf(r) !== 'connector';
const isConnector = (r: Rec): boolean => r.type === 'element' && kindOf(r) === 'connector';

/** The bindings of each connector of `recs`. */
function bindingsOf(recs: Recs): Map<string, Rec[]> {
  const out = new Map<string, Rec[]>();
  for (const r of Object.values(recs)) if (r.type === 'binding') out.set(String(r['connectorId']), [...(out.get(String(r['connectorId'])) ?? []), r]);
  return out;
}

/** The ends of a connector, as the elements they bind. */
const endsOf = (list: readonly Rec[] | undefined, renamed: ReadonlyMap<string, string>): string =>
  (list ?? [])
    .map((b) => `${String(b['end'])}=${renamed.get(String(b['elementId'])) ?? String(b['elementId'])}`)
    .sort()
    .join(';');

/**
 * The records of `base` that are the same as a record of `next` under another id: the screen, nodes and groups that differ only in their slug, then the
 * edges between renamed (or same) ends, then their bindings. A match needs to be the only one of its signature on both sides; otherwise it is a delete and an add.
 */
export function detectRenames(base: Recs, next: Recs): Map<string, string> {
  const out = new Map<string, string>();
  const removed = Object.values(base).filter((r) => !(r.id in next));
  const added = Object.values(next).filter((r) => !(r.id in base));
  const [screensOut, screensIn] = [removed.filter((r) => r.type === 'screen'), added.filter((r) => r.type === 'screen')];
  pair(out, screensOut, screensIn, () => 'screen');
  pair(out, removed.filter(isNode), added.filter(isNode), (r, side) => signature(r, side === 'removed' ? out : new Map()));
  const [oldBindings, newBindings] = [bindingsOf(base), bindingsOf(next)];
  pair(
    out,
    removed.filter(isConnector),
    added.filter(isConnector),
    (r, side) =>
      `${signature(r, side === 'removed' ? out : new Map())}|${endsOf((side === 'removed' ? oldBindings : newBindings).get(r.id), side === 'removed' ? out : new Map())}`,
  );
  const bound = (r: Rec, side: 'removed' | 'added'): string => {
    const own = side === 'removed' ? out : new Map<string, string>();
    return `${own.get(String(r['connectorId'])) ?? String(r['connectorId'])}|${String(r['end'])}|${own.get(String(r['elementId'])) ?? String(r['elementId'])}`;
  };
  pair(
    out,
    removed.filter((r) => r.type === 'binding' && out.has(String(r['connectorId']))),
    added.filter((r) => r.type === 'binding'),
    bound,
  );
  return out;
}

// ---- ids ---------------------------------------------------------------------------------------------------------------------------------------

/** `recs` with every id in `map` replaced, in the keys, the own ids and the references. */
function rekey(recs: Recs, map: ReadonlyMap<string, string>): Work {
  if (map.size === 0) return { ...recs };
  const out: Work = {};
  for (const r of Object.values(recs)) {
    const moved = remapRecord(r, map);
    out[moved.id] = moved;
  }
  return out;
}

/** Document id to base id, for the records of the document that have another id than the record of the base they are. */
function toBaseIds(alias: ReadonlyMap<string, string> | undefined, current: Recs, base: Recs): Map<string, string> {
  const out = new Map<string, string>();
  for (const [baseId, docId] of alias ?? []) if (docId !== baseId && docId in current && baseId in base && !(baseId in current)) out.set(docId, baseId);
  return out;
}

/** Each document id that changes, to its final id: through the alias to the base id, then through the rename to the next id. */
function remapOf(current: Recs, toBase: ReadonlyMap<string, string>, renames: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of Object.keys(current)) {
    const baseId = toBase.get(id) ?? id;
    const final = renames.get(baseId) ?? baseId;
    if (final !== id) out.set(id, final);
  }
  return out;
}

// ---- one record --------------------------------------------------------------------------------------------------------------------------------

const labelOf = (r: Rec): string => {
  const slug = (r['semantic'] as Obj | undefined)?.['slug'] ?? (r['meta'] as Obj | undefined)?.['slug'];
  return typeof slug === 'string' ? slug : r.id;
};

/** A record of the new compile, the base compile's record of it (if it had one) and the document's (if it still has one). */
type Row = { readonly b: Rec | undefined; readonly n: Rec; readonly c: Rec | undefined };

/** What the record of the new compile becomes in the document. `undefined`: nothing to write. */
function mergeOne({ b, n, c }: Row, work: Work, conflicts: MergeConflict[]): Rec | undefined {
  if (c === undefined) {
    if (b !== undefined && sameValue(b, n)) return undefined; // the canvas deleted it and the text did not touch it
    if (b !== undefined) conflicts.push({ label: labelOf(n), fields: ['*'] });
    return onTop(n, work);
  }
  const fields: string[] = [];
  const merged = mergeFields({ b: b ?? c, n, c }, '', fields) as Rec;
  if (fields.length > 0) conflicts.push({ label: labelOf(n), fields });
  return merged['parentId'] === c['parentId'] ? merged : onTop(merged, work);
}

// ---- deletion ----------------------------------------------------------------------------------------------------------------------------------

/** The nearest ancestor of `id` that is not gone (`undefined`: the screen). */
function survivingParent(id: string, gone: ReadonlySet<string>, before: Work): string | undefined {
  let at: string | undefined = id;
  while (at !== undefined && gone.has(at)) at = before[at]?.['parentId'] as string | undefined;
  return at;
}

/** Move the records that sat in a deleted group (kept ones, and owned ones the canvas had put there) up to the group's parent. */
function reparent(work: Work, gone: ReadonlySet<string>, before: Work): void {
  for (const r of Object.values(work)) {
    if (typeof r['parentId'] !== 'string' || !gone.has(r['parentId'])) continue;
    const { parentId: _old, ...rest } = r;
    const parent = survivingParent(r['parentId'], gone, before);
    work[r.id] = onTop((parent === undefined ? rest : { ...rest, parentId: parent }) as Rec, work);
  }
}

/** Delete or clean every record that points at a gone id, until none does (nothing is left to dangle, which the store would refuse). Returns how many records it touched. */
function scrubDependents(work: Work, gone: Set<string>): number {
  let touched = 0;
  for (let pending: ReadonlySet<string> = gone; pending.size > 0; ) {
    const deleted = new Set<string>();
    for (const r of Object.values(work)) {
      const scrubbed = scrubRecord(r, pending);
      if (!scrubbed.changed) continue;
      touched++;
      if (scrubbed.record === undefined) {
        delete work[r.id];
        deleted.add(r.id);
      } else work[r.id] = scrubbed.record;
    }
    pending = deleted;
  }
  return touched;
}

/** The slugs of the ambiguous removed nodes whose record the canvas changed, or that records outside the block point at: what the delete will take with it. */
function unpairedLosses(work: Work, base: Recs, next: Recs, ambiguous: readonly string[]): string[] {
  const lost = ambiguous.filter((id) => id in work && !(id in next) && isNode(base[id] as Rec));
  if (lost.length === 0) return [];
  const outside = Object.values(work).filter((r) => !(r.id in base) && !(r.id in next));
  const losing = lost.filter((id) => !sameValue(work[id], base[id]) || outside.some((r) => JSON.stringify(r).includes(`"${id}"`)));
  return losing.map((id) => labelOf(base[id] as Rec)).sort();
}

/** Delete the owned records the new compile lacks (not a screen), and see to what pointed at them. Returns how many records outside the block that touched. */
function removeGone(work: Work, base: Recs, next: Recs): number {
  const gone = new Set(
    Object.values(base)
      .filter((b) => !(b.id in next) && b.type !== 'screen' && b.id in work)
      .map((b) => b.id),
  );
  const before = { ...work };
  for (const id of gone) delete work[id];
  reparent(work, gone, before);
  return scrubDependents(work, gone);
}

// ---- the merge ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Merge the text's change into the document (see the top of this file).
 *
 * @param input - the base and new compile, the document and the aliases
 * @returns the puts and deletes of one apply, the conflicts, the dependents touched and the ids that moved
 */
export function mergeOwned(input: MergeInput): MergeResult {
  const { next, current } = input;
  const renames = detectRenames(input.base, next);
  const toBase = toBaseIds(input.alias, current, input.base);
  const remap = remapOf(current, toBase, renames);
  const work = rekey(current, remap);
  const base = rekey(input.base, renames);
  const conflicts: MergeConflict[] = [];
  for (const n of Object.values(next)) {
    const merged = mergeOne({ b: base[n.id], n, c: work[n.id] }, work, conflicts);
    if (merged !== undefined) work[n.id] = merged;
  }
  const unpaired = unpairedLosses(work, base, next, AMBIGUOUS.get(renames) ?? []);
  const dependents = removeGone(work, base, next);
  const { puts, gone: deletes } = diffRecords(current as RecordsById, work as RecordsById);
  return { puts: puts as Rec[], deletes, conflicts, dependents, unpaired, remap };
}

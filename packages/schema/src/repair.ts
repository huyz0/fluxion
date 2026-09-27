// Lenient repair (02-document-model §4): after migration, fix recoverable problems and report each
// as a warning, so a slightly broken file still opens. Pure: returns a new document.
//   dangling binding (connector or element missing) → binding removed, the end becomes free
//   dangling or cyclic parentId → the element moves to the screen root
//   missing, invalid or duplicate sibling index → appended after its siblings
import { type Diagnostic, diagnostic } from './diagnostics.js';
import { type IndexKey, isIndexKey, keyBetween } from './fractional-index.js';
import type { RawDocument } from './migrate.js';
import { DEFAULT_SCREEN_SIZE } from './records/screen.js';

type Fields = { readonly [key: string]: unknown };
type Mutable = { [key: string]: unknown };

/**
 * Result of {@link repair}: the repaired document and one warning per change.
 *
 * @public
 */
export type Repaired = {
  /** The document after repair. */
  readonly document: RawDocument;
  /** What was changed, as `FLX_REPAIRED_*` warnings. */
  readonly diagnostics: readonly Diagnostic[];
};

const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Where a freed connector end is put: the centre of the connector's screen, or of its viewport on
 * an infinite screen (M2.12 review r2 F1).
 */
function screenCentre(records: Map<string, Mutable>, connector: Fields | undefined): { x: number; y: number } {
  const screen = records.get(String(connector?.['screenId']));
  const view = screen?.['kind'] === 'infinite' && isObject(screen['viewport']) ? screen['viewport'] : undefined;
  const size = isObject(screen?.['size']) ? screen['size'] : DEFAULT_SCREEN_SIZE;
  const [x, y, w, h] = view ? [view['x'], view['y'], view['w'], view['h']] : [0, 0, size['w'], size['h']];
  return { x: Number(x ?? 0) + Number(w ?? DEFAULT_SCREEN_SIZE.w) / 2, y: Number(y ?? 0) + Number(h ?? DEFAULT_SCREEN_SIZE.h) / 2 };
}

/** A binding whose connector is a connector element and whose element exists. */
function isSound(records: Map<string, Mutable>, b: Fields): boolean {
  const connector = records.get(String(b['connectorId']));
  const element = records.get(String(b['elementId']));
  return connector?.['type'] === 'element' && connector['kind'] === 'connector' && element?.['type'] === 'element';
}

/** Key of one connector end: connector id and `source` or `target`. */
const endKey = (b: Fields): string => `${String(b['connectorId'])}\u0000${String(b['end'])}`;

/** Make the connector end a removed binding held into a free point, unless another binding still holds it (M2.12 review r2 F2). */
function freeEnd(records: Map<string, Mutable>, b: Fields, held: ReadonlyMap<string, number>): void {
  const connector = records.get(String(b['connectorId']));
  if (connector?.['kind'] !== 'connector' || (held.get(endKey(b)) ?? 0) > 0) return;
  const free = b['end'] === 'target' ? 'freeTarget' : 'freeSource';
  if (connector[free] === undefined) connector[free] = screenCentre(records, connector);
}

function repairBindings(records: Map<string, Mutable>, out: Diagnostic[]): void {
  // bindings per connector end, counted once: O(records), not a scan per removal (M2.14 review F1)
  const held = new Map<string, number>();
  for (const r of records.values()) if (r['type'] === 'binding') held.set(endKey(r), (held.get(endKey(r)) ?? 0) + 1);
  for (const id of [...records.keys()].sort(byId)) {
    const b = records.get(id);
    if (b?.['type'] !== 'binding' || isSound(records, b)) continue;
    records.delete(id);
    held.set(endKey(b), (held.get(endKey(b)) ?? 1) - 1);
    freeEnd(records, b, held);
    out.push(diagnostic('FLX_REPAIRED_BINDING', ['records', id], `binding "${id}" pointed at a missing record; removed and the connector end made free`));
  }
}

/** Why element `id`'s parent chain is broken: its end is not an element, or it returns to `id`. */
function parentProblem(records: Map<string, Mutable>, id: string): 'missing' | 'loop' | null {
  const seen = new Set<unknown>([id]);
  let next: unknown = records.get(id)?.['parentId'];
  while (typeof next === 'string' && records.get(next)?.['type'] === 'element' && !seen.has(next)) {
    seen.add(next);
    next = records.get(next)?.['parentId'];
  }
  if (next === id) return 'loop';
  return typeof next === 'string' && !seen.has(next) ? 'missing' : null;
}

function repairParents(records: Map<string, Mutable>, out: Diagnostic[]): void {
  for (const id of [...records.keys()].sort(byId)) {
    const el = records.get(id);
    if (el?.['type'] !== 'element' || el['parentId'] === undefined) continue;
    const problem = parentProblem(records, id);
    if (problem === null) continue;
    delete el['parentId'];
    const why = problem === 'missing' ? 'parent is missing' : 'parent chain looped';
    out.push(diagnostic('FLX_REPAIRED_PARENT', ['records', id, 'parentId'], `${why}; moved to the screen root`));
  }
}

const siblingGroup = (r: Fields): string | undefined => {
  if (r['type'] === 'screen') return 'screen';
  if (r['type'] === 'element') return `element/${String(r['screenId'])}/${String(r['parentId'] ?? '')}`;
  if (r['type'] === 'timeline') return `timeline/${String(r['screenId'])}`;
  if (r['type'] === 'step') return `step/${String(r['timelineId'])}`;
  return undefined;
};

/** Record ids by sibling group, each group in id order. */
function siblingGroups(records: Map<string, Mutable>): string[][] {
  const groups = new Map<string, string[]>();
  for (const id of [...records.keys()].sort(byId)) {
    const g = siblingGroup(records.get(id) ?? {});
    if (g !== undefined) groups.set(g, [...(groups.get(g) ?? []), id]);
  }
  return [...groups.values()];
}

/** Give each record of one sibling group with a missing, invalid or repeated index a new key after the others. */
function repairGroup(records: Map<string, Mutable>, ids: readonly string[], out: Diagnostic[]): void {
  const seen = new Set<IndexKey>();
  const broken: string[] = [];
  for (const id of ids) {
    const index = records.get(id)?.['index'];
    if (isIndexKey(index) && !seen.has(index)) seen.add(index);
    else broken.push(id);
  }
  let last: IndexKey | null = [...seen].sort().at(-1) ?? null;
  for (const id of broken) {
    // appending after a valid key always succeeds (ADR-0012: the key space never runs out)
    const key = keyBetween(last, null);
    if (!key.ok) return;
    const rec = records.get(id);
    if (rec !== undefined) rec['index'] = key.value;
    last = key.value;
    out.push(diagnostic('FLX_REPAIRED_INDEX', ['records', id, 'index'], `index was missing, invalid or shared; appended after its siblings as "${key.value}"`));
  }
}

/**
 * Repair what can be repaired without guessing intent, reporting each change as a warning.
 * Records that are not objects are left for `validate` to report.
 *
 * @public
 */
export function repair(doc: RawDocument): Repaired {
  const records = new Map<string, Mutable>();
  for (const [id, r] of Object.entries(doc.records)) if (isObject(r)) records.set(id, JSON.parse(JSON.stringify(r)) as Mutable);
  const out: Diagnostic[] = [];
  repairBindings(records, out);
  repairParents(records, out);
  for (const ids of siblingGroups(records)) repairGroup(records, ids, out);
  const repaired: { [id: string]: unknown } = {};
  for (const [id, r] of Object.entries(doc.records)) {
    const fixed = records.get(id);
    if (fixed !== undefined) repaired[id] = fixed;
    else if (!isObject(r)) repaired[id] = r;
  }
  return { document: { ...doc, records: repaired }, diagnostics: out };
}

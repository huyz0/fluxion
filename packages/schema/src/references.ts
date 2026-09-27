// Referential validation (02-document-model §5 layer 2, FR-DOC-004): every ID a record points at
// exists and has the right type; parents form trees on one screen; connector ends are bound or free;
// sibling indices and slugs are unique. Runs over records that passed their schemas.
import { type Diagnostic, type DiagnosticCode, diagnostic } from './diagnostics.js';

type Fields = { readonly [key: string]: unknown };
type Records = ReadonlyMap<string, Fields>;
type Path = readonly (string | number)[];

const CONTAINERS = new Set(['group', 'frame', 'component']);
const isContainerKind = (kind: unknown): boolean => typeof kind === 'string' && (CONTAINERS.has(kind) || kind.includes(':') || !CORE_LEAVES.has(kind));
const CORE_LEAVES = new Set(['shape', 'connector', 'text', 'image']);

class References {
  readonly out: Diagnostic[] = [];

  readonly records: Records;
  // every present record, valid or not: a reference to a record that failed its schema is that
  // record's problem, not a second "missing" error here
  readonly present: Records;

  constructor(records: Records, present: Records) {
    this.records = records;
    this.present = present;
  }

  push(code: DiagnosticCode, path: Path, message: string, hint?: string): void {
    this.out.push(diagnostic(code, path, message, hint));
  }

  /** `from.field` must name an existing record of one of `types` (any type when empty). */
  ref(from: Fields, field: Path, types: readonly string[]): Fields | undefined {
    const target = field.reduce<unknown>((v, k) => (typeof v === 'object' && v !== null ? (v as Fields)[k] : undefined), from);
    if (typeof target !== 'string') return undefined;
    const path = ['records', String(from['id']), ...field];
    const rec = this.present.get(target);
    if (rec === undefined) {
      this.push('FLX_REF_MISSING', path, `no record "${target}"`, this.suggest(types));
      return undefined;
    }
    if (types.length > 0 && !types.includes(String(rec['type']))) {
      this.push('FLX_REF_WRONG_TYPE', path, `"${target}" is a ${String(rec['type'])}, expected ${types.join(' or ')}`);
      return undefined;
    }
    return rec;
  }

  /** A hint listing a few existing IDs of the expected types. */
  suggest(types: readonly string[]): string | undefined {
    if (types.length === 0) return undefined;
    const ids = [...this.present.values()].filter((r) => types.includes(String(r['type']))).map((r) => String(r['id']));
    if (ids.length === 0) return `the document has no ${types.join(' or ')} record`;
    return `existing ${types.join('/')} ids: ${ids.sort().slice(0, 5).join(', ')}${ids.length > 5 ? ', …' : ''}`;
  }

  /** Records of `type` that passed their schemas: their own fields are checked. */
  of(type: string): Fields[] {
    return [...this.records.values()].filter((r) => r['type'] === type);
  }

  /** Every present record of `type`, valid or not: for counts and existence (M2.10 review r2). */
  anyOf(type: string): Fields[] {
    return [...this.present.values()].filter((r) => r['type'] === type);
  }
}

function checkDocument(c: References): void {
  // counted over every present record: a document record that fails its schema is not also "missing"
  const docs = c.anyOf('document').sort(byId);
  if (docs.length === 0) c.push('FLX_DOCUMENT_MISSING', ['records'], 'the document has no "document" record', 'add { "id": "doc", "type": "document" }');
  for (const extra of docs.slice(1)) c.push('FLX_DOCUMENT_DUPLICATE', ['records', String(extra['id'])], 'a document has exactly one "document" record');
  for (const d of c.of('document')) c.ref(d, ['themeId'], ['theme']);
}

function checkScreens(c: References): void {
  for (const s of c.of('screen')) {
    c.ref(s, ['masterId'], ['screen']);
    c.ref(s, ['parentElementId'], ['element']);
    c.ref(s, ['background', 'assetId'], ['asset']);
  }
}

function checkParent(c: References, el: Fields): void {
  const parent = c.ref(el, ['parentId'], ['element']);
  if (parent === undefined) return;
  const path = ['records', String(el['id']), 'parentId'];
  if (parent['screenId'] !== el['screenId']) c.push('FLX_PARENT_INVALID', path, `parent "${String(parent['id'])}" is on another screen`);
  else if (!isContainerKind(parent['kind']))
    c.push('FLX_PARENT_INVALID', path, `a ${String(parent['kind'])} cannot contain elements`, 'use a group or frame as the parent');
}

/** Elements whose parent chain returns to themselves. */
function checkCycles(c: References, elements: readonly Fields[]): void {
  for (const el of elements) {
    const seen = new Set<unknown>([el['id']]);
    let next = el['parentId'];
    while (typeof next === 'string' && !seen.has(next)) {
      seen.add(next);
      next = c.present.get(next)?.['parentId'];
    }
    if (next === el['id']) c.push('FLX_PARENT_CYCLE', ['records', String(el['id']), 'parentId'], 'the parent chain loops back to this element');
  }
}

function checkElements(c: References): void {
  const elements = c.of('element');
  for (const el of elements) {
    c.ref(el, ['screenId'], ['screen']);
    checkParent(c, el);
    c.ref(el, ['assetId'], ['asset']);
    c.ref(el, ['snapshotAssetId'], ['asset']);
    c.ref(el, ['style', 'fill', 'assetId'], ['asset']);
  }
  checkCycles(c, elements);
}

function checkBindingRefs(c: References, b: Fields): void {
  const connector = c.ref(b, ['connectorId'], ['element']);
  const path = ['records', String(b['id'])];
  if (connector !== undefined && connector['kind'] !== 'connector')
    c.push('FLX_REF_WRONG_TYPE', [...path, 'connectorId'], `"${String(connector['id'])}" is a ${String(connector['kind'])}, not a connector`);
  c.ref(b, ['elementId'], ['element']);
  if (b['elementId'] === b['connectorId']) c.push('FLX_REF_WRONG_TYPE', [...path, 'elementId'], 'a connector cannot bind to itself');
}

/** Bound connector ends, from every present binding: an invalid binding still binds its end (M2.10 review r2 F2). */
function checkBindings(c: References): Map<string, Fields> {
  for (const b of [...c.of('binding')].sort(byId)) checkBindingRefs(c, b);
  const ends = new Map<string, Fields>();
  for (const b of c.anyOf('binding').sort(byId)) {
    const key = `${String(b['connectorId'])}\u0000${String(b['end'])}`;
    const first = ends.get(key);
    if (first !== undefined)
      c.push(
        'FLX_BINDING_DUPLICATE',
        ['records', String(b['id'])],
        `the ${String(b['end'])} end of "${String(b['connectorId'])}" is already bound by "${String(first['id'])}"`,
      );
    else ends.set(key, b);
  }
  return ends;
}

function checkConnectorEnds(c: References, bound: ReadonlyMap<string, Fields>): void {
  for (const el of c.of('element').filter((e) => e['kind'] === 'connector')) {
    for (const [end, free] of [
      ['source', 'freeSource'],
      ['target', 'freeTarget'],
    ] as const) {
      const isBound = bound.has(`${String(el['id'])}\u0000${end}`);
      const path = ['records', String(el['id']), free];
      if (!isBound && el[free] === undefined)
        c.push('FLX_CONNECTOR_END_MISSING', path, `the ${end} end is neither bound nor free`, `add a binding record or ${free}: { "x": …, "y": … }`);
      if (isBound && el[free] !== undefined) c.push('FLX_CONNECTOR_END_CONFLICT', path, `the ${end} end is bound; ${free} is ignored`);
    }
  }
}

function checkBehaviour(c: References): void {
  for (const t of c.of('timeline')) c.ref(t, ['screenId'], ['screen']);
  for (const s of c.of('step')) c.ref(s, ['timelineId'], ['timeline']);
  for (const i of c.of('interaction')) c.ref(i, ['ownerId'], []);
  for (const m of c.of('comment')) c.ref(m, ['targetId'], []);
}

const byId = (a: Fields, b: Fields): number => (String(a['id']) < String(b['id']) ? -1 : String(a['id']) > String(b['id']) ? 1 : 0);

/** Report every record after the first (by id) that shares `key(record)` with another. */
function duplicates(c: References, recs: readonly Fields[], key: (r: Fields) => string | undefined, report: (r: Fields) => void): void {
  const seen = new Set<string>();
  for (const r of [...recs].sort(byId)) {
    const k = key(r);
    if (k === undefined) continue;
    if (seen.has(k)) report(r);
    seen.add(k);
  }
}

function checkUniqueness(c: References): void {
  const sibling = (r: Fields): string => {
    const group =
      r['type'] === 'element'
        ? `${String(r['screenId'])}/${String(r['parentId'] ?? '')}`
        : r['type'] === 'step'
          ? String(r['timelineId'])
          : r['type'] === 'timeline'
            ? String(r['screenId'])
            : '';
    return `${String(r['type'])}\u0000${group}\u0000${String(r['index'])}`;
  };
  const ordered = [...c.records.values()].filter((r) => ['screen', 'element', 'timeline', 'step'].includes(String(r['type'])));
  duplicates(c, ordered, sibling, (r) =>
    c.push(
      'FLX_INDEX_DUPLICATE',
      ['records', String(r['id']), 'index'],
      `index "${String(r['index'])}" is shared with a sibling`,
      'repair appends it after its siblings',
    ),
  );
  const slug = (r: Fields): string | undefined => {
    const s = (r['semantic'] as Fields | undefined)?.['slug'];
    return typeof s === 'string' ? s : undefined;
  };
  duplicates(c, c.of('element'), slug, (r) =>
    c.push('FLX_SLUG_DUPLICATE', ['records', String(r['id']), 'semantic', 'slug'], `slug "${String(slug(r))}" is used by another element`),
  );
}

/**
 * Referential diagnostics for records that passed their schemas, in a deterministic order.
 *
 * @param records - records that passed their schemas, keyed by id
 * @param present - every record object in the document (for resolving references)
 */
export function checkReferences(records: Records, present: Records = records): Diagnostic[] {
  const c = new References(records, present);
  checkDocument(c);
  checkScreens(c);
  checkElements(c);
  checkConnectorEnds(c, checkBindings(c));
  checkBehaviour(c);
  checkUniqueness(c);
  return c.out;
}

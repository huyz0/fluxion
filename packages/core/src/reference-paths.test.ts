import { type AnyRecord, RECORD_TYPES, type RecordId, validateReferences } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { describe, expect, it } from 'vitest';
import { checkDiff, type Diff, REFERENCE_PATHS, referencesUnchanged } from './transaction.js';

// A document with a record of every type, the fields each carries set, some references broken. A field none of them carries is not covered:
// a check added on one needs it added here.
const RECORDS: Record<string, Record<string, unknown>> = {
  doc: { id: 'doc', type: 'document', themeId: 'theme', title: 'T' },
  theme: { id: 'theme', type: 'theme', name: 'n', tokens: { color: { a: '#000' } } },
  asset: { id: 'asset', type: 'asset', mime: 'image/png', name: 'a' },
  section: { id: 'section', type: 'section', index: 'a0', name: 's' },
  master: { id: 'master', type: 'screen', index: 'a0', size: { w: 10, h: 10 } },
  screen: {
    id: 'screen',
    type: 'screen',
    index: 'a1',
    masterId: 'master',
    sectionId: 'section',
    themeId: 'theme',
    parentElementId: 'group',
    background: { assetId: 'asset', fit: 'cover' },
    size: { w: 800, h: 600 },
    notes: 'n',
  },
  group: { id: 'group', type: 'element', kind: 'group', screenId: 'screen', index: 'a0', transform: { x: 0, y: 0, w: 10, h: 10 } },
  shape: {
    id: 'shape',
    type: 'element',
    kind: 'shape',
    screenId: 'screen',
    parentId: 'group',
    index: 'a1',
    assetId: 'asset',
    snapshotAssetId: 'asset',
    transform: { x: 1, y: 2, w: 3, h: 4, rotation: 0 },
    style: { fill: { assetId: 'asset', color: '#fff' }, stroke: { width: 1 } },
    semantic: { slug: 'one', label: 'L' },
    name: 'shape',
  },
  other: { id: 'other', type: 'element', kind: 'shape', screenId: 'screen', index: 'a1', semantic: { slug: 'one' }, parentId: 'missing' },
  line: {
    id: 'line',
    type: 'element',
    kind: 'connector',
    screenId: 'screen',
    index: 'a2',
    freeTarget: { x: 5, y: 6 },
    route: { type: 'orthogonal', cornerRadius: 2 },
    labels: [{ position: 0.5, text: { type: 'doc' } }],
  },
  bind: { id: 'bind', type: 'binding', connectorId: 'line', elementId: 'shape', end: 'source', anchor: { kind: 'center' } },
  timeline: { id: 'timeline', type: 'timeline', screenId: 'screen', index: 'a0' },
  step: { id: 'step', type: 'step', timelineId: 'timeline', index: 'a0', duration: 1 },
  act: { id: 'act', type: 'interaction', ownerId: 'shape', trigger: 'click' },
  note: { id: 'note', type: 'comment', targetId: 'shape', body: 'b' },
  count: { id: 'count', type: 'variable', name: 'n', value: 1 },
  pack: { id: 'pack', type: 'plugin-ref', pluginId: 'p', version: '1.0.0' },
};

const map = (records: Record<string, Record<string, unknown>>) => new Map(Object.entries(records) as [RecordId, AnyRecord][]);

/** Every leaf path of `value` (objects and arrays walked into). */
function leaves(value: unknown, path: readonly (string | number)[] = []): (readonly (string | number)[])[] {
  if (typeof value !== 'object' || value === null) return [path];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, [...path, Array.isArray(value) ? Number(k) : k]));
}

/** `record` with the leaf at `path` replaced by `to`. */
function set(record: unknown, path: readonly (string | number)[], to: unknown): unknown {
  if (path.length === 0) return to;
  const [head, ...rest] = path as [string | number, ...(string | number)[]];
  const copy = (Array.isArray(record) ? [...record] : { ...(record as object) }) as Record<string | number, unknown>;
  copy[head] = set(copy[head], rest, to);
  return copy;
}

const covered = (path: readonly (string | number)[]) =>
  ['freeSource', 'freeTarget'].includes(String(path[0])) || REFERENCE_PATHS.some((p) => p.every((k, i) => path[i] === k));

describe('the fields referential validation reads (FR-RTE-002, M18.131)', () => {
  const baseline = validateReferences(map(RECORDS));

  it('FR-RTE-002: the document has references, errors and every kind of record', () => {
    expect(baseline.length).toBeGreaterThan(0);
    expect(new Set(Object.values(RECORDS).map((r) => r['type']))).toEqual(new Set(RECORD_TYPES));
  });

  it('FR-RTE-002: a change to any field off REFERENCE_PATHS leaves the referential diagnostics as they were, and is unchanged to referencesUnchanged', () => {
    for (const [id, record] of Object.entries(RECORDS))
      for (const path of leaves(record).filter((p) => !covered(p))) {
        // a value that would be a missing id, a wrong type and a duplicate all at once if anything read it
        const changed = set(record, path, 'zz-changed') as AnyRecord;
        expect(validateReferences(map({ ...RECORDS, [id]: changed as Record<string, unknown> })), `${id}.${path.join('.')}`).toEqual(baseline);
        expect(referencesUnchanged(record as AnyRecord, changed), `${id}.${path.join('.')}`).toBe(true);
      }
  });

  it('FR-RTE-002: a change on any REFERENCE_PATHS field, or a free end set or cleared, is a change', () => {
    for (const [id, record] of Object.entries(RECORDS))
      for (const path of leaves(record).filter(covered)) {
        if (['freeSource', 'freeTarget'].includes(String(path[0]))) continue;
        expect(referencesUnchanged(record as AnyRecord, set(record, path, 'zz-changed') as AnyRecord), `${id}.${path.join('.')}`).toBe(false);
      }
    const line = RECORDS['line'] as AnyRecord;
    expect(referencesUnchanged(line, { ...line, freeTarget: { x: 9, y: 9 } } as AnyRecord)).toBe(true);
    expect(referencesUnchanged(line, { ...line, freeSource: { x: 9, y: 9 } } as AnyRecord)).toBe(false);
    const { freeTarget: _, ...unset } = line as unknown as Record<string, unknown>;
    expect(referencesUnchanged(line, unset as AnyRecord)).toBe(false);
  });

  it('FR-RTE-002: a diff that changes no reference reads neither the post-state nor the known errors; one that does reads both and finds its new errors', () => {
    const b = documentBuilder({ seed: 145 });
    const screen = b.screen();
    const rect = b.rect(screen, { x: 0, y: 0, w: 10, h: 10 });
    const other = b.rect(screen, { x: 50, y: 0, w: 10, h: 10 });
    b.connect(rect, other);
    const records = b.build().records as unknown as Record<string, Record<string, unknown>>;
    const shape = records[rect] as AnyRecord;
    const counted = () => {
      const reads = { post: 0, before: 0 };
      const post = (changed: Record<string, Record<string, unknown>>) => () => {
        reads.post += 1;
        return map(changed);
      };
      const before = () => {
        reads.before += 1;
        return new Map();
      };
      return { reads, post, before };
    };
    const put = (after: AnyRecord, prior: AnyRecord | undefined = shape): Diff => ({
      puts: new Map([[after.id as RecordId, prior === undefined ? { after } : { before: prior, after }]]),
      deletes: new Map(),
    });
    const as = (r: AnyRecord) => r as unknown as Record<string, unknown>;
    // a move and a rename
    const transform = (shape as unknown as { transform: object }).transform;
    for (const after of [
      { ...shape, transform: { ...transform, x: 9 } },
      { ...shape, name: 'renamed' },
    ] as AnyRecord[]) {
      const c = counted();
      expect(checkDiff(put(after), c.post({ ...records, [rect]: as(after) }), c.before)).toEqual({ problems: [], after: undefined });
      expect(c.reads).toEqual({ post: 0, before: 0 });
    }
    // a re-reference, an added record and a deleted one each take the full pass, and a broken reference is a problem
    const moved = { ...shape, parentId: 'nowhere' } as AnyRecord;
    const added = { ...shape, id: 'added', index: 'a9' } as AnyRecord;
    const { [other]: _, ...without } = records;
    for (const [diff, post, broken] of [
      [put(moved), { ...records, [rect]: as(moved) }, true],
      [put(added, undefined), { ...records, added: as(added) }, false],
      [{ puts: new Map(), deletes: new Map([[other, records[other] as AnyRecord]]) }, without, true],
    ] as [Diff, Record<string, Record<string, unknown>>, boolean][]) {
      const c = counted();
      const result = checkDiff(diff, c.post(post), c.before);
      expect(c.reads, JSON.stringify(result.problems)).toEqual({ post: 1, before: 1 });
      expect(result.after).toBeDefined();
      expect(result.problems.length > 0).toBe(broken);
    }
  });
});

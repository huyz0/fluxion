// 1.7 -> 1.8 (ADR-0054): master screens and placeholders, the `table` element, text regions and icon slots, aspect and selection locks,
// the `path` field. Records are loose, so a 1.7 file may already carry any of the new field names with values the 1.8 schema refuses; the
// step removes those rather than make the migrated file invalid. A 1.7 `table` was an unknown kind (envelope only): one that does not
// validate as a 1.8 table, or that some element names as its parent (a 1.8 table is a leaf), becomes `legacy-table`, an unqualified
// unknown kind, so it keeps its envelope-only schema and its children. `fills` and an icon's `assetId` are new references: one naming no
// record of the right type is removed. `masterId` is a typed field since 1.0 and is left alone.
import { z } from 'zod';
import type { Migration, RawDocument } from '../migration-types.js';
import { recordIdSchema } from '../primitives.js';
import { elementKindSchemas, iconFillSchema, pathDataSchema } from '../records/element-schemas.js';
import { tableStyleSchema } from '../records/resources.js';
import { richTextSchema } from '../rich-text.js';

type Fields = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const conforms = (schema: z.ZodType, value: unknown): boolean => schema.safeParse(value).success;

/** `record` without `key`. */
const without = (record: Fields, key: string): Fields => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** `record` with `key` removed when its value does not pass `ok`. */
const keepIf = (record: Fields, key: string, ok: (v: unknown) => boolean): Fields => (key in record && !ok(record[key]) ? without(record, key) : record);

/** `record` with `key`, a map, kept only when it is an object, and its entries that fail `ok` removed. */
function keepEntries(record: Fields, key: string, ok: (v: unknown) => boolean): Fields {
  if (!(key in record)) return record;
  const map = record[key];
  if (!isObject(map)) return without(record, key);
  const kept = Object.fromEntries(Object.entries(map).filter(([, v]) => ok(v)));
  return Object.keys(kept).length === Object.keys(map).length ? record : { ...record, [key]: kept };
}

const isBool = (v: unknown): boolean => typeof v === 'boolean';
const name = z.string().min(1);

function cleanScreen(record: Fields): Fields {
  return keepIf(
    keepIf(record, 'role', (v) => v === 'master'),
    'hideMasterElements',
    isBool,
  );
}

function cleanLocks(record: Fields): Fields {
  const locks = record['locks'];
  if (!isObject(locks)) return record;
  const kept = keepIf(keepIf(locks, 'aspect', isBool), 'select', isBool);
  return kept === locks ? record : { ...record, locks: kept };
}

function cleanElement(record: Fields): Fields {
  let next = cleanLocks(record);
  next = keepIf(next, 'placeholder', (v) => conforms(name, v));
  next = keepIf(next, 'fills', (v) => conforms(recordIdSchema, v));
  if (next['kind'] === 'shape') {
    next = keepEntries(next, 'texts', (v) => conforms(richTextSchema, v));
    next = keepEntries(next, 'icons', (v) => conforms(iconFillSchema, v));
    next = keepIf(next, 'path', (v) => conforms(pathDataSchema, v));
  }
  if (next['kind'] === 'table') next = keepIf(next, 'tableStyle', (v) => conforms(name, v));
  return next;
}

function cleanTheme(record: Fields): Fields {
  return keepEntries(record, 'tableStyles', (v) => conforms(tableStyleSchema, v));
}

function clean(record: unknown): unknown {
  if (!isObject(record)) return record;
  if (record['type'] === 'screen') return cleanScreen(record);
  if (record['type'] === 'element') return cleanElement(record);
  if (record['type'] === 'theme') return cleanTheme(record);
  return record;
}

/** Ids of elements some element names as its parent. */
function parents(records: readonly unknown[]): ReadonlySet<unknown> {
  return new Set(records.filter((r) => isObject(r) && r['type'] === 'element').map((r) => (r as Fields)['parentId']));
}

/** A 1.7 table that is not a valid 1.8 table, or that holds elements, renamed to the unknown kind `legacy-table`. */
function retype(record: unknown, holders: ReadonlySet<unknown>): unknown {
  if (!isObject(record) || record['type'] !== 'element' || record['kind'] !== 'table') return record;
  return holders.has(record['id']) || !conforms(elementKindSchemas.table, record) ? { ...record, kind: 'legacy-table' } : record;
}

/** `record` with a `fills` or an icon `assetId` that names no record of the right type removed. */
function dropDangling(record: unknown, byId: ReadonlyMap<string, unknown>): unknown {
  if (!isObject(record) || record['type'] !== 'element') return record;
  const typed = (id: unknown, type: string): boolean => typeof id === 'string' && isObject(byId.get(id)) && (byId.get(id) as Fields)['type'] === type;
  let next = keepIf(record, 'fills', (v) => typed(v, 'element'));
  if (isObject(next['icons'])) next = keepEntries(next, 'icons', (v) => !(isObject(v) && 'assetId' in v) || typed(v['assetId'], 'asset'));
  return next;
}

/** The step. */
export const migrate17to18: Migration = {
  from: '1.7',
  to: '1.8',
  up: (doc: RawDocument): RawDocument => {
    const cleaned = Object.entries(doc.records).map(([id, record]) => [id, clean(record)] as const);
    const holders = parents(cleaned.map(([, r]) => r));
    const retyped = cleaned.map(([id, record]) => [id, retype(record, holders)] as const);
    const byId = new Map<string, unknown>(retyped);
    return { ...doc, schemaVersion: '1.8', records: Object.fromEntries(retyped.map(([id, record]) => [id, dropDangling(record, byId)])) };
  },
};

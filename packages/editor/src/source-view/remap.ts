// Ids that change under the source view's apply (FR-EDT-022, ADR-0032, ADR-0031): a slug renamed in the text, or a record made by hand whose random id is
// replaced by the one its slug derives. Every record that held the old id is rewritten, whatever its type, so no comment, interaction, step or
// binding is left pointing at nothing (ADR-0032 review r3 F1). References are found by value, not by field: the open payloads of steps and interactions
// (animation targets, action targets) hold element ids in fields the schema does not name, and ids are 22-character hashes, so a whole string equal to
// an id is that id. Pure.
import type { AnyRecord } from '@fluxion/schema';

/** A record read loosely. */
export type Rec = AnyRecord & { readonly id: string; readonly type: string; readonly [key: string]: unknown };

const isObject = (v: unknown): v is { readonly [key: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `value` with every string that is a key of `map` replaced; the same object when none is. */
function mapped(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return map.get(value) ?? value;
  if (Array.isArray(value)) {
    const items = value.map((v) => mapped(v, map));
    return items.some((v, i) => v !== value[i]) ? items : value;
  }
  if (!isObject(value)) return value;
  const entries = Object.entries(value).map(([k, v]) => [k, mapped(v, map)] as const);
  return entries.some(([k, v]) => v !== value[k]) ? Object.fromEntries(entries) : value;
}

/**
 * The record with its own id and every id it holds rewritten through `map`.
 *
 * @param record - the record
 * @param map - old id to new id
 * @returns a new record, or `record` itself when it holds none of the old ids
 */
export function remapRecord<T extends Rec>(record: T, map: ReadonlyMap<string, string>): T {
  const { id, ...rest } = record;
  const body = mapped(rest, map) as { readonly [key: string]: unknown };
  const own = map.get(id) ?? id;
  return body === rest && own === id ? record : ({ id: own, ...body } as T);
}

/** Taken out of the value it was in. */
const DROP = Symbol('drop');

/** `value` without the gone ids: a string that is gone is DROP; a list loses its dropped items; an object holding a dropped value is dropped itself. */
function scrubbed(value: unknown, gone: ReadonlySet<string>): unknown {
  if (typeof value === 'string') return gone.has(value) ? DROP : value;
  if (Array.isArray(value)) {
    const items = value.map((v) => scrubbed(v, gone)).filter((v) => v !== DROP);
    return items.length === value.length && items.every((v, i) => v === value[i]) ? value : items;
  }
  if (!isObject(value)) return value;
  const entries = Object.entries(value).map(([k, v]) => [k, scrubbed(v, gone)] as const);
  if (entries.some(([, v]) => v === DROP)) return DROP;
  return entries.some(([k, v]) => v !== value[k]) ? Object.fromEntries(entries) : value;
}

/**
 * A record without the references to gone ids: a record that belongs to one (a comment on it, an interaction it owns, a binding to it) is deleted, a gone
 * id is taken out of a list (the targets of a step's animation or of an action), an action or other list item that needs one is dropped, and anything
 * else that cannot work without it (an interaction's trigger) deletes the record. The record's own id is not looked at.
 *
 * @param record - the record
 * @param gone - the ids of the deleted records
 * @returns the record to keep (`undefined`: delete it) and whether it changed
 */
export function scrubRecord(record: Rec, gone: ReadonlySet<string>): { readonly record: Rec | undefined; readonly changed: boolean } {
  const { id, ...rest } = record;
  const body = scrubbed(rest, gone);
  if (body === DROP) return { record: undefined, changed: true };
  return body === rest ? { record, changed: false } : { record: { id, ...(body as object) } as Rec, changed: true };
}

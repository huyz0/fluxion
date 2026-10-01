// The inspector's model (FR-EDT-008, ADR-0149, M7.15): what the selection's properties are, with no widgets.
// Each element kind's fields come from its schema's `.meta` (`elementFields`); a selection of several shows
// the fields every element has in common, with a value where they agree and `mixed` where they differ; applying
// a value is one `element.updateMany`, so it is one undo step whatever the selection. A plugin replaces the
// fields of its kind with an `inspectors` entry (the same path built-in kinds could take).
import type { ReadView } from '@fluxion/core';
import { type AnyRecord, elementFields, type FieldDef, type RecordId } from '@fluxion/schema';

/**
 * Replaces the fields the schema gives a kind: the plugin's own list, or the schema's with changes.
 *
 * @public
 */
export type InspectorOverride = (fields: readonly FieldDef[]) => readonly FieldDef[];

/**
 * The `inspectors` of a document's plugins: an override by element kind.
 *
 * @public
 */
export type Inspectors = {
  /** The override of the element kind `kind`, if a plugin registered one. */
  get(kind: string): InspectorOverride | undefined;
};

/**
 * One field of the selection.
 *
 * @public
 */
export type InspectorField = {
  /** The field. */
  readonly def: FieldDef;
  /** The value every selected element has; undefined where they differ or none sets it. */
  readonly value: unknown;
  /** The elements differ (some set it and some not, or set it differently). */
  readonly mixed: boolean;
};

/**
 * A section of the inspector.
 *
 * @public
 */
export type InspectorGroup = {
  /** Its name. */
  readonly name: string;
  /** Its fields, in order. */
  readonly fields: readonly InspectorField[];
};

/**
 * What the inspector shows for a selection.
 *
 * @public
 */
export type InspectorModel = {
  /** The selected elements. */
  readonly ids: readonly RecordId[];
  /** The sections, in order. */
  readonly groups: readonly InspectorGroup[];
};

/**
 * A command to run.
 *
 * @public
 */
export type InspectorCommand = {
  /** The command id. */
  readonly id: string;
  /** Its arguments. */
  readonly args: unknown;
};

type Json = { readonly [key: string]: unknown };

/** The value of `record` at `path`, undefined where a step is missing. */
function valueAt(record: unknown, path: readonly string[]): unknown {
  let at = record;
  for (const key of path) {
    if (typeof at !== 'object' || at === null) return undefined;
    at = (at as Json)[key];
  }
  return at;
}

/** `current` with the value at `path` set (removed when undefined), siblings kept; objects are made where missing. */
function withValue(current: unknown, path: readonly string[], value: unknown): unknown {
  const [key, ...rest] = path;
  if (key === undefined) return value;
  const base: Json = typeof current === 'object' && current !== null && !Array.isArray(current) ? (current as Json) : {};
  const next = withValue(base[key], rest, value);
  const { [key]: _removed, ...others } = base;
  return next === undefined ? others : { ...others, [key]: next };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (f: FieldDef): string => `${f.ui}:${f.path.join('/')}`;

/** The fields of the element kind `kind`, as a plugin's override has them. */
function fieldsOf(kind: string, overrides: Inspectors | undefined): readonly FieldDef[] {
  const fields = elementFields(kind);
  return overrides?.get(kind)?.(fields) ?? fields;
}

/** The elements among `ids` (a selection may also hold a record that has since gone). */
function elementsOf(view: ReadView, ids: readonly RecordId[]): readonly AnyRecord[] {
  return ids.flatMap((id) => {
    const record = view.get(id);
    return record?.type === 'element' ? [record] : [];
  });
}

/**
 * The inspector's model for `ids`: the fields every selected element has (the same path and widget), by
 * section, each with the value they share or `mixed`. Undefined when no element is selected.
 *
 * @public
 */
export function inspect(view: ReadView, ids: readonly RecordId[], overrides?: Inspectors): InspectorModel | undefined {
  const elements = elementsOf(view, ids);
  const [first, ...others] = elements.map((e) => fieldsOf(String((e as Json)['kind']), overrides));
  if (first === undefined) return undefined;
  const shared = first.filter((f) => others.every((fields) => fields.some((g) => keyOf(g) === keyOf(f))));
  const fields = shared.map((def): InspectorField => {
    const values = elements.map((e) => valueAt(e, def.path));
    const mixed = values.some((v) => !same(v, values[0]));
    return { def, value: mixed ? undefined : values[0], mixed };
  });
  const names = [...new Set(fields.map((f) => f.def.group))];
  return {
    ids: elements.map((e) => e.id as RecordId),
    groups: names.map((name) => ({ name, fields: fields.filter((f) => f.def.group === name) })),
  };
}

/**
 * The command that sets the field at `path` to `value` on every element of `ids`: one `element.updateMany`,
 * so one undo step. An undefined `value` removes the field. Undefined when no element is selected or the path is empty.
 *
 * @public
 */
export function applyField(view: ReadView, ids: readonly RecordId[], path: readonly string[], value: unknown): InspectorCommand | undefined {
  const [top] = path;
  const elements = elementsOf(view, ids);
  if (top === undefined || elements.length === 0) return undefined;
  const updates = elements.map((e) => ({ id: e.id, fields: { [top]: withValue((e as Json)[top], path.slice(1), value) } }));
  return { id: 'element.updateMany', args: { updates } };
}

// Field metadata for generated editors (FR-EDT-008, ADR-0149): the inspector is generated from the Zod
// schemas of the element kinds, which carry `.meta({ ui, group, order, label })` on the fields a user may
// edit. This walks a schema and lists them with their paths; a field without a `ui` is not editable by
// hand (the inspector shows only what the schema marks). Pure: the editor draws, this only describes.
import { z } from 'zod';

/**
 * What a schema says about how to edit a field (`.meta(…)`).
 *
 * @public
 */
export type FieldMeta = {
  /** The widget: `number`, `slider`, `text`, `toggle`, `select`, `paint` or a plugin's own name. */
  readonly ui: string;
  /** The inspector section, e.g. `Layout`. */
  readonly group?: string;
  /** Position within its section, ascending. */
  readonly order?: number;
  /** The label (default: the last path segment). */
  readonly label?: string;
};

/**
 * A field of a schema, ready for an editor.
 *
 * @public
 */
export type FieldDef = {
  /** Where the field is in the record, e.g. `['transform', 'x']`. */
  readonly path: readonly string[];
  /** The widget. */
  readonly ui: string;
  /** The section. */
  readonly group: string;
  /** Position within its section. */
  readonly order: number;
  /** The label. */
  readonly label: string;
  /** The values of an enum field. */
  readonly options?: readonly string[];
  /** A number field's lower bound. */
  readonly min?: number;
  /** A number field's upper bound. */
  readonly max?: number;
};

/** The inspector's sections in the order they are shown. */
const SECTIONS = ['Element', 'Layout', 'Fill', 'Stroke', 'Appearance', 'Text'] as const;

/** The wrappers that hold the schema of an optional or defaulted field. */
const WRAPPERS = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly']);

type Zod = z.ZodType;
type Def = {
  readonly type: string;
  readonly innerType?: Zod;
  readonly shape?: { readonly [key: string]: Zod };
  readonly entries?: { readonly [key: string]: unknown };
};
const defOf = (schema: Zod): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** The meta of `schema` or of a wrapper layer around it, innermost last. */
function metaOf(schema: Zod): { readonly meta: Partial<FieldMeta> | undefined; readonly inner: Zod } {
  let meta = z.globalRegistry.get(schema) as Partial<FieldMeta> | undefined;
  let inner = schema;
  for (let d = defOf(inner); WRAPPERS.has(d.type) && d.innerType !== undefined; d = defOf(inner)) {
    inner = d.innerType;
    meta ??= z.globalRegistry.get(inner) as Partial<FieldMeta> | undefined;
  }
  return { meta, inner };
}

/** The members of a union schema (none for any other). */
const membersOf = (schema: Zod): readonly Zod[] => (defOf(schema) as Def & { readonly options?: readonly Zod[] }).options ?? [];

/** The values of an enum schema, or of the enum member of a union (a built-in name or a plugin's). */
function entriesOf(schema: Zod): { readonly [key: string]: unknown } | undefined {
  const own = defOf(schema).entries;
  if (own !== undefined) return own;
  const member = membersOf(schema).find((m) => defOf(m).entries !== undefined);
  return member === undefined ? undefined : defOf(member).entries;
}

/** A union's number member, for the bounds of a number that may also be a token reference. */
function numeric(schema: Zod): (Zod & { readonly minValue?: number | null; readonly maxValue?: number | null }) | undefined {
  const d = defOf(schema) as Def & { readonly options?: readonly Zod[] };
  if (d.type === 'number') return schema;
  return d.options?.find((o) => defOf(o).type === 'number');
}

/** The field a leaf schema with a `ui` makes. */
function leaf(path: readonly string[], meta: Partial<FieldMeta>, inner: Zod): FieldDef {
  const entries = entriesOf(inner);
  const number = numeric(inner);
  const [min, max] = [number?.minValue, number?.maxValue];
  return {
    path,
    ui: meta.ui as string,
    group: meta.group ?? 'General',
    order: meta.order ?? 1000,
    label: meta.label ?? (path.at(-1) as string),
    ...(entries === undefined ? {} : { options: Object.values(entries).map(String) }),
    ...(typeof min === 'number' && Number.isFinite(min) ? { min } : {}),
    ...(typeof max === 'number' && Number.isFinite(max) ? { max } : {}),
  };
}

/** The fields under `schema` at `path`, depth first in declaration order. */
function walk(schema: Zod, path: readonly string[], out: FieldDef[]): void {
  const { meta, inner } = metaOf(schema);
  if (meta?.ui !== undefined) {
    out.push(leaf(path, meta, inner));
    return;
  }
  const shape = defOf(inner).shape;
  if (shape !== undefined) for (const [key, child] of Object.entries(shape)) walk(child, [...path, key], out);
}

/**
 * The editable fields of `schema` (an object schema of a record): every field whose schema carries a `ui`
 * in its `.meta`, nested objects included, with its path, section, order and label, sorted by section
 * (first appearance) then order. A field that is a leaf is not walked into (a `paint` is one field).
 *
 * @public
 */
export function describeFields(schema: z.ZodType): readonly FieldDef[] {
  const found: FieldDef[] = [];
  walk(schema, [], found);
  // the usual sections first in the usual order, any other in the order it first appears
  const groups = [...new Set([...SECTIONS, ...found.map((f) => f.group)])];
  return found.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.order - b.order);
}

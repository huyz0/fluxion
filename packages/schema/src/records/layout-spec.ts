// A layout spec (schema 1.3, ADR-0031, FR-DSL-005): how a screen, a group or a frame lays out its `auto` children. `type` names a
// `layouts` registry entry, a built-in (`stack`) or a pack's (`pack:name`); the options belong to that layout and are checked by it.
// `live` (schema 1.6, ADR-0046, FR-LAY-010) asks for the container to be re-laid out after edits. A spec of type `template` (schema 1.7,
// ADR-0047, FR-LAY-014) names a `templates` registry entry (`id`) and the items it was built from, so it can be built again.
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { Extensible } from '../primitives.js';

/**
 * One item a template is built from: a label, an optional detail line and, for the templates that nest (`hierarchy.org`), children.
 *
 * @public
 */
export type TemplateItem = Extensible<{
  /** The item's text. */
  readonly label: string;
  /** A second, smaller line. */
  readonly detail?: string;
  /** Nested items. */
  readonly children?: readonly TemplateItem[];
}>;

/**
 * A layout to apply to a container's `auto` children.
 *
 * @public
 */
export type LayoutSpec = Extensible<{
  /** A `layouts` registry name: a built-in (`stack`) or `<pack>:<name>`; `template` for a template (schema 1.7, ADR-0047). */
  readonly type: string;
  /** The layout's own options, validated by the layout. */
  readonly options?: { readonly [key: string]: unknown };
  /** Re-lay this container out automatically after edits (schema 1.6, ADR-0046). The schema only stores it. */
  readonly live?: boolean;
  /** The template the container was built from, a `templates` registry id (`process.chevron`, `<pack>:<name>`); required by `template`. */
  readonly id?: string;
  /** The items the template was built from; required by `template`. */
  readonly items?: readonly TemplateItem[];
}>;

const LAYOUT_TYPE = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9.-]*)?$/;
const TEMPLATE_ID = /^(?:[a-z][a-z0-9-]*:)?[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/;

/** The layout type of a template spec. */
const TEMPLATE = 'template';

const base = {
  type: z.string().regex(LAYOUT_TYPE, 'expected a layout name such as "stack" or "<pack>:<name>"'),
  options: z.record(z.string(), z.unknown()).optional(),
};

/**
 * How deep template items may nest through `children`; deeper is an error, so a hostile value cannot exhaust the stack (as rich text's limit).
 *
 * @public
 */
export const MAX_TEMPLATE_DEPTH: number = 64;

/** Whether some item in `items` (a list, or one item) is nested deeper than {@link MAX_TEMPLATE_DEPTH}: level by level, without recursion. */
function tooDeep(items: unknown): boolean {
  let level: unknown[] = Array.isArray(items) ? items : [items];
  for (let depth = 0; level.length > 0; depth++) {
    if (depth === MAX_TEMPLATE_DEPTH) return true;
    // each object once per level, so a cyclic value costs its size per level and stops at the limit
    level = [...new Set(level.flatMap((item) => (item as { children?: unknown } | null)?.children ?? []))];
  }
  return false;
}

const itemSchema: z.ZodType<TemplateItem> = checkedSchema<TemplateItem>()(
  z.looseObject({
    label: z.string(),
    detail: z.string().optional(),
    get children() {
      return z.array(itemSchema).optional();
    },
  }),
);

/**
 * Schema of a {@link TemplateItem}, its nesting limited to {@link MAX_TEMPLATE_DEPTH}.
 *
 * @public
 */
export const templateItemSchema: z.ZodType<TemplateItem> = z.preprocess((value, ctx) => {
  if (tooDeep(value)) ctx.issues.push({ code: 'custom', input: value, message: `items nest deeper than ${MAX_TEMPLATE_DEPTH} levels` });
  return value;
}, itemSchema);

/** A layout spec as schema 1.3 wrote it: a type and options, every other key untyped. The 1.2 → 1.3 step checks layouts with it. */
export const layoutSpecShapeSchema: z.ZodType = z.looseObject(base);

/**
 * Schema of a {@link LayoutSpec}.
 *
 * @public
 */
export const layoutSpecSchema: z.ZodType<LayoutSpec> = checkedSchema<LayoutSpec>()(
  // checked before the fields: a template's id and items are there, and its items are not too deep to recurse into (one issue, never a stack overflow)
  z.preprocess(
    (value, ctx) => {
      const spec = value as { readonly [key: string]: unknown } | null;
      for (const key of ['id', 'items'])
        if ((spec?.['type'] === TEMPLATE && spec[key] === undefined) || (key === 'items' && tooDeep(spec?.[key])))
          ctx.issues.push({
            code: 'custom',
            input: value,
            path: [key],
            message: key === 'id' ? 'a template layout needs an id' : `a template layout needs items, nested at most ${MAX_TEMPLATE_DEPTH} deep`,
          });
      return value;
    },
    z.looseObject({
      ...base,
      live: z.boolean().optional(),
      id: z.string().regex(TEMPLATE_ID, 'expected a template id such as "process.chevron" or "<pack>:<name>"').optional(),
      items: z.array(itemSchema).optional(),
    }),
  ),
);

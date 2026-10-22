// A layout spec (schema 1.3, ADR-0031, FR-DSL-005): how a screen, a group or a frame lays out its `auto` children. `type` names a
// `layouts` registry entry, a built-in (`stack`) or a pack's (`pack:name`); the options belong to that layout and are checked by it.
// `live` (schema 1.6, ADR-0046, FR-LAY-010) asks for the container to be re-laid out after edits.
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { Extensible } from '../primitives.js';

/**
 * A layout to apply to a container's `auto` children.
 *
 * @public
 */
export type LayoutSpec = Extensible<{
  /** A `layouts` registry name: a built-in (`stack`) or `<pack>:<name>`. */
  readonly type: string;
  /** The layout's own options, validated by the layout. */
  readonly options?: { readonly [key: string]: unknown };
  /** Re-lay this container out automatically after edits (schema 1.6, ADR-0046). The schema only stores it. */
  readonly live?: boolean;
}>;

const LAYOUT_TYPE = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9.-]*)?$/;

/**
 * Schema of a {@link LayoutSpec}.
 *
 * @public
 */
export const layoutSpecSchema: z.ZodType<LayoutSpec> = checkedSchema<LayoutSpec>()(
  z.looseObject({
    type: z.string().regex(LAYOUT_TYPE, 'expected a layout name such as "stack" or "<pack>:<name>"'),
    options: z.record(z.string(), z.unknown()).optional(),
    live: z.boolean().optional(),
  }),
);

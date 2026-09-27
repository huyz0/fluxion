// The `binding` record (02-document-model §2 "Anchors", FR-CON-001): one connector end attached to
// an element. Bindings are separate records so moving or deleting shapes updates them cleanly.
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import type { RecordId } from '../ids.js';
import { type Extensible, type Meta, metaSchema, recordIdSchema } from '../primitives.js';

/**
 * The engine picks the best anchor (FR-ANC-004).
 *
 * @public
 */
export type AutoAnchor = Extensible<{
  /** Anchor intent. */
  readonly kind: 'auto';
}>;

/**
 * The nearest perimeter point toward the other end (FR-ANC-001).
 *
 * @public
 */
export type FloatingAnchor = Extensible<{
  /** Anchor intent. */
  readonly kind: 'floating';
}>;

/**
 * A named anchor of the shape definition or instance (FR-ANC-002).
 *
 * @public
 */
export type NamedAnchor = Extensible<{
  /** Anchor intent. */
  readonly kind: 'named';
  /** Anchor name. */
  readonly name: string;
}>;

/**
 * A point on one side of the element.
 *
 * @public
 */
export type SideAnchor = Extensible<{
  /** Anchor intent. */
  readonly kind: 'side';
  /** Which side. */
  readonly side: 'n' | 'e' | 's' | 'w';
  /** Position along the side, 0–1; omitted = distributed by the router. */
  readonly t?: number;
}>;

/**
 * A fixed point inside the element box.
 *
 * @public
 */
export type PointAnchor = Extensible<{
  /** Anchor intent. */
  readonly kind: 'point';
  /** Horizontal position, 0–1. */
  readonly x: number;
  /** Vertical position, 0–1. */
  readonly y: number;
}>;

/**
 * Where on the element a connector end attaches (anchor intent; positions are derived by routing).
 *
 * @public
 */
export type AnchorRef = AutoAnchor | FloatingAnchor | NamedAnchor | SideAnchor | PointAnchor;

/**
 * One end of a connector bound to an element.
 *
 * @public
 */
export type BindingRecord = Extensible<{
  /** Record ID. */
  readonly id: RecordId;
  /** Discriminator. */
  readonly type: 'binding';
  /** Free-form metadata. */
  readonly meta?: Meta;
  /** The connector element. */
  readonly connectorId: RecordId;
  /** Which end of the connector. */
  readonly end: 'source' | 'target';
  /** The element the end attaches to. */
  readonly elementId: RecordId;
  /** Where on that element. */
  readonly anchor: AnchorRef;
}>;

const unit = z.number().min(0).max(1);

/** Schema of an anchor reference. */
export const anchorRefSchema: z.ZodType<AnchorRef> = checkedSchema<AnchorRef>()(
  z.discriminatedUnion('kind', [
    z.looseObject({ kind: z.literal('auto') }),
    z.looseObject({ kind: z.literal('floating') }),
    z.looseObject({ kind: z.literal('named'), name: z.string().min(1) }),
    z.looseObject({ kind: z.literal('side'), side: z.enum(['n', 'e', 's', 'w']), t: unit.optional() }),
    z.looseObject({ kind: z.literal('point'), x: unit, y: unit }),
  ]),
);

/** Schema of the `binding` record. */
export const bindingRecordSchema: z.ZodType<BindingRecord> = checkedSchema<BindingRecord>()(
  z.looseObject({
    id: recordIdSchema,
    type: z.literal('binding'),
    meta: metaSchema.optional(),
    connectorId: recordIdSchema,
    end: z.enum(['source', 'target']),
    elementId: recordIdSchema,
    anchor: anchorRefSchema,
  }),
);

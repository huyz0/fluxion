// Schemas of the element kinds (types in element.ts and element-base.ts; ADR-0140 checks each).
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import { indexKeySchema, metaSchema, recordIdSchema } from '../primitives.js';
import { richTextSchema } from '../rich-text.js';
import { styleSchema, transformSchema } from '../style.js';
import type {
  ComponentElement,
  ConnectorElement,
  FrameElement,
  GroupElement,
  ImageElement,
  Marker,
  PluginElement,
  ShapeElement,
  TextElement,
  UnknownElement,
} from './element.js';
import { type AnchorDef, pointSchema, qualifiedNameSchema } from './element-base.js';

const props = z.record(z.string(), z.unknown());
const base = {
  id: recordIdSchema,
  type: z.literal('element'),
  meta: metaSchema.optional(),
  screenId: recordIdSchema,
  parentId: recordIdSchema.optional(),
  index: indexKeySchema,
  name: z.string().optional(),
  style: styleSchema.optional(),
  semantic: z
    .looseObject({
      slug: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/)
        .optional(),
      label: z.string().optional(),
      role: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  locks: z
    .looseObject({
      position: z.boolean().optional(),
      size: z.boolean().optional(),
      rotation: z.boolean().optional(),
      delete: z.boolean().optional(),
      edit: z.boolean().optional(),
    })
    .optional(),
  matchKey: z.string().min(1).optional(),
  placement: z.enum(['auto', 'pinned']).optional(),
  hidden: z.boolean().optional(),
};
const boxed = { ...base, transform: transformSchema, text: richTextSchema.optional() };
const unit = z.number().min(0).max(1);
/**
 * Schema of a named anchor (fractions of the box).
 *
 * @public
 */
export const anchorDefSchema: z.ZodType<AnchorDef> = checkedSchema<AnchorDef>()(
  z.looseObject({
    name: z.string().min(1),
    x: unit,
    y: unit,
    dir: pointSchema.optional(),
    role: z.enum(['in', 'out', 'any']).optional(),
    max: z.number().int().min(1).optional(),
  }),
);
const markerSchema: z.ZodType<Marker> = z.union([z.enum(['none', 'arrow', 'triangle', 'circle', 'diamond', 'bar']), qualifiedNameSchema]);

/** Schemas of the core element kinds and of plugin kinds, by kind. */
export const elementKindSchemas: {
  readonly shape: z.ZodType<ShapeElement>;
  readonly connector: z.ZodType<ConnectorElement>;
  readonly group: z.ZodType<GroupElement>;
  readonly frame: z.ZodType<FrameElement>;
  readonly text: z.ZodType<TextElement>;
  readonly image: z.ZodType<ImageElement>;
  readonly component: z.ZodType<ComponentElement>;
  readonly plugin: z.ZodType<PluginElement>;
  readonly unknown: z.ZodType<UnknownElement>;
} = {
  shape: checkedSchema<ShapeElement>()(
    z.looseObject({ ...boxed, kind: z.literal('shape'), defId: qualifiedNameSchema, params: props.optional(), anchors: z.array(anchorDefSchema).optional() }),
  ),
  connector: checkedSchema<ConnectorElement>()(
    z.looseObject({
      ...base,
      kind: z.literal('connector'),
      route: z.looseObject({
        type: z.union([z.enum(['straight', 'curved', 'orthogonal', 'polyline']), qualifiedNameSchema]),
        waypoints: z.array(pointSchema).optional(),
        cornerRadius: z.number().min(0).optional(),
      }),
      markers: z.looseObject({ start: markerSchema.optional(), end: markerSchema.optional(), mid: markerSchema.optional() }).optional(),
      labels: z.array(z.looseObject({ text: richTextSchema, position: unit, offset: pointSchema.optional() })).optional(),
      freeSource: pointSchema.optional(),
      freeTarget: pointSchema.optional(),
    }),
  ),
  group: checkedSchema<GroupElement>()(z.looseObject({ ...boxed, kind: z.literal('group') })),
  frame: checkedSchema<FrameElement>()(
    z.looseObject({ ...boxed, kind: z.literal('frame'), clip: z.boolean().optional(), padding: z.number().min(0).optional() }),
  ),
  text: checkedSchema<TextElement>()(
    z.looseObject({ ...boxed, kind: z.literal('text'), text: richTextSchema, autoSize: z.enum(['none', 'width', 'height']).optional() }),
  ),
  image: checkedSchema<ImageElement>()(
    z.looseObject({
      ...boxed,
      kind: z.literal('image'),
      assetId: recordIdSchema,
      crop: z.looseObject({ x: unit, y: unit, w: unit, h: unit }).optional(),
      fit: z.enum(['cover', 'contain', 'fill']).optional(),
      maskDefId: qualifiedNameSchema.optional(),
    }),
  ),
  component: checkedSchema<ComponentElement>()(
    z.looseObject({ ...boxed, kind: z.literal('component'), componentId: qualifiedNameSchema, props, snapshotAssetId: recordIdSchema.optional() }),
  ),
  plugin: checkedSchema<PluginElement>()(z.looseObject({ ...boxed, kind: qualifiedNameSchema, props: props.optional() })),
  unknown: checkedSchema<UnknownElement>()(
    z.looseObject({
      id: recordIdSchema,
      type: z.literal('element'),
      meta: metaSchema.optional(),
      screenId: recordIdSchema,
      parentId: recordIdSchema.optional(),
      index: indexKeySchema,
      kind: z.string().min(1),
    }),
  ),
};

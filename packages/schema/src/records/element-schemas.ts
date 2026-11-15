// Schemas of the element kinds (types in element.ts and element-base.ts; ADR-0140 checks each).
import { z } from 'zod';
import { checkedSchema } from '../checked-schema.js';
import { indexKeySchema, metaSchema, recordIdSchema } from '../primitives.js';
import { richTextSchema } from '../rich-text.js';
import { assetFreeStyleSchema, styleSchema, transformSchema } from '../style.js';
import type {
  ComponentElement,
  ConnectorElement,
  FrameElement,
  GroupElement,
  IconFill,
  ImageElement,
  Marker,
  PathData,
  PluginElement,
  ShapeElement,
  TableCell,
  TableElement,
  TextElement,
  TextFit,
  UnknownElement,
} from './element.js';
import { type AnchorDef, pointSchema, qualifiedNameSchema } from './element-base.js';
import { layoutSpecSchema } from './layout-spec.js';

const props = z.record(z.string(), z.unknown());
const base = {
  id: recordIdSchema,
  type: z.literal('element'),
  meta: metaSchema.optional(),
  screenId: recordIdSchema,
  parentId: recordIdSchema.optional(),
  index: indexKeySchema,
  name: z.string().meta({ ui: 'text', group: 'Element', order: 1, label: 'Name' }).optional(),
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
      aspect: z.boolean().optional(),
      select: z.boolean().optional(),
    })
    .optional(),
  matchKey: z.string().min(1).optional(),
  placement: z.enum(['auto', 'pinned']).optional(),
  hidden: z.boolean().meta({ ui: 'toggle', group: 'Element', order: 2, label: 'Hidden' }).optional(),
  placeholder: z.string().min(1).optional(),
  fills: recordIdSchema.optional(),
};
const boxed = { ...base, transform: transformSchema, text: richTextSchema.optional() };
const unit = z.number().min(0).max(1);
/**
 * Schema of a named anchor (fractions of the box).
 *
 * @public
 */
export const anchorDefSchema: z.ZodType<AnchorDef> = checkedSchema<AnchorDef>()(
  z
    .looseObject({
      name: z.string().min(1),
      kind: z.enum(['fixed', 'side', 'perimeter', 'center']).optional(),
      x: unit.optional(),
      y: unit.optional(),
      side: z.enum(['n', 'e', 's', 'w']).optional(),
      t: unit.optional(),
      dir: pointSchema.optional(),
      role: z.enum(['in', 'out', 'any']).optional(),
      max: z.number().int().min(1).optional(),
    })
    .superRefine((value, ctx) => {
      // a fixed anchor (the default kind) is a point; a side anchor names its side
      if (value.kind === undefined || value.kind === 'fixed') {
        for (const axis of ['x', 'y'] as const)
          if (value[axis] === undefined) ctx.addIssue({ code: 'custom', path: [axis], message: `a fixed anchor needs ${axis}` });
      }
      if (value.kind === 'side' && value.side === undefined) ctx.addIssue({ code: 'custom', path: ['side'], message: 'a side anchor needs side' });
    }),
);
const textFitSchema = checkedSchema<TextFit>()(
  z.looseObject({
    mode: z.enum(['none', 'shrink', 'grow']).meta({ ui: 'select', group: 'Text', order: 10, label: 'Fit' }).optional(),
    padding: z.number().min(0).meta({ ui: 'number', group: 'Text', order: 11, label: 'Padding' }).optional(),
    minSize: z.number().positive().optional(),
    overflow: z.enum(['visible', 'clip']).optional(),
  }),
);
/** Schema of an icon slot fill (ADR-0054). @internal */
export const iconFillSchema: z.ZodType<IconFill> = checkedSchema<IconFill>()(
  z
    .union([z.looseObject({ defId: qualifiedNameSchema }), z.looseObject({ assetId: recordIdSchema })])
    .refine((v) => !('defId' in v && 'assetId' in v), { message: 'an icon is a definition or an asset, not both' }),
);
/**
 * Schema of a shape's own path (ADR-0053).
 *
 * @public
 */
export const pathDataSchema: z.ZodType<PathData> = checkedSchema<PathData>()(
  z.looseObject({
    d: z.string().min(1).max(1_000_000),
    w: z.number().positive(),
    h: z.number().positive(),
    fillRule: z.enum(['nonzero', 'evenodd']).optional(),
  }),
);
const tableCellSchema = checkedSchema<TableCell>()(
  z.looseObject({
    text: richTextSchema.optional(),
    rowSpan: z.number().int().min(1).optional(),
    colSpan: z.number().int().min(1).optional(),
    style: assetFreeStyleSchema.optional(),
  }),
);
const CELL_KEY = /^(0|[1-9]\d*):(0|[1-9]\d*)$/;
/** The most rows, and the most columns, a table holds; bounds the grid check's work by the grid's area (ADR-0054). */
const MAX_TABLE_LINES = 500;
type Area = { r: number; c: number; h: number; w: number };
/** A cell's top-left slot and span, or why it has none: a malformed key or a span past the grid's edge. */
function cellArea(key: string, cell: TableCell, rows: number, cols: number): Area | string {
  const match = CELL_KEY.exec(key);
  if (!match) return 'a cell key is "row:col", zero-based';
  const r = Number(match[1]);
  const c = Number(match[2]);
  const h = cell.rowSpan ?? 1;
  const w = cell.colSpan ?? 1;
  if (r + h > rows || c + w > cols) return 'the cell or its span lies outside the grid';
  return { r, c, h, w };
}
/** Which cell (index + 1, 0 for none) covers each slot, row-major, and the cell keys by index. */
type Occupancy = { readonly slots: Int32Array; readonly cols: number; readonly keys: readonly string[] };
/** The key and slot of the first cell already covering a slot of `area`, else undefined with `area` marked as cell `index`'s. */
function claim(grid: Occupancy, area: Area, index: number): string | undefined {
  const { slots, cols, keys } = grid;
  for (let i = area.r; i < area.r + area.h; i++)
    for (let j = area.c; j < area.c + area.w; j++) {
      const at = slots[i * cols + j] ?? 0;
      if (at !== 0) return `${keys[at - 1]} at ${i}:${j}`;
    }
  for (let i = area.r; i < area.r + area.h; i++) slots.fill(index + 1, i * cols + area.c, i * cols + area.c + area.w);
  return undefined;
}
/**
 * Refuses a cell key outside the grid, a span past its edge, and two cells covering one slot (ADR-0054). The check stops at the
 * first overlap: until then the cells it scanned are disjoint, so the work is at most twice the grid's area plus the cell count.
 */
function checkTableGrid(
  table: { rows: readonly unknown[]; cols: readonly unknown[]; cells: { readonly [key: string]: TableCell } },
  ctx: z.RefinementCtx,
): void {
  const rows = table.rows.length;
  const cols = table.cols.length;
  if (rows > MAX_TABLE_LINES || cols > MAX_TABLE_LINES) return;
  const keys = Object.keys(table.cells);
  const grid: Occupancy = { slots: new Int32Array(rows * cols), cols, keys };
  for (const [index, key] of keys.entries()) {
    const area = cellArea(key, table.cells[key] as TableCell, rows, cols);
    if (typeof area === 'string') {
      ctx.addIssue({ code: 'custom', path: ['cells', key], message: area });
      continue;
    }
    const other = claim(grid, area, index);
    if (other !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['cells', key], message: `the cell overlaps cell ${other}` });
      return;
    }
  }
}
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
  readonly table: z.ZodType<TableElement>;
  readonly plugin: z.ZodType<PluginElement>;
  readonly unknown: z.ZodType<UnknownElement>;
} = {
  shape: checkedSchema<ShapeElement>()(
    z.looseObject({
      ...boxed,
      kind: z.literal('shape'),
      defId: qualifiedNameSchema,
      params: props.optional(),
      anchors: z.array(anchorDefSchema).optional(),
      textFit: textFitSchema.optional(),
      texts: z.record(z.string().min(1), richTextSchema).optional(),
      icons: z.record(z.string().min(1), iconFillSchema).optional(),
      path: pathDataSchema.optional(),
    }),
  ),
  connector: checkedSchema<ConnectorElement>()(
    z.looseObject({
      ...base,
      kind: z.literal('connector'),
      route: z.looseObject({
        type: z
          .union([z.enum(['straight', 'curved', 'orthogonal', 'polyline']), qualifiedNameSchema])
          .meta({ ui: 'select', group: 'Route', order: 1, label: 'Route' }),
        waypoints: z.array(pointSchema).optional(),
        cornerRadius: z.number().min(0).optional(),
        tangents: z.record(z.string().regex(/^(0|[1-9]\d*)$/), pointSchema).optional(),
        jumps: z.enum(['arc', 'gap', 'none']).optional(),
      }),
      markers: z.looseObject({ start: markerSchema.optional(), end: markerSchema.optional(), mid: markerSchema.optional() }).optional(),
      labels: z.array(z.looseObject({ text: richTextSchema, position: unit, offset: pointSchema.optional() })).optional(),
      freeSource: pointSchema.optional(),
      freeTarget: pointSchema.optional(),
    }),
  ),
  group: checkedSchema<GroupElement>()(z.looseObject({ ...boxed, kind: z.literal('group'), layout: layoutSpecSchema.optional() })),
  frame: checkedSchema<FrameElement>()(
    z.looseObject({
      ...boxed,
      kind: z.literal('frame'),
      clip: z.boolean().meta({ ui: 'toggle', group: 'Frame', order: 1, label: 'Clip contents' }).optional(),
      padding: z.number().min(0).meta({ ui: 'number', group: 'Frame', order: 2, label: 'Padding' }).optional(),
      layout: layoutSpecSchema.optional(),
    }),
  ),
  text: checkedSchema<TextElement>()(
    z.looseObject({
      ...boxed,
      kind: z.literal('text'),
      text: richTextSchema,
      autoSize: z.enum(['none', 'width', 'height']).meta({ ui: 'select', group: 'Text', order: 12, label: 'Auto size' }).optional(),
    }),
  ),
  image: checkedSchema<ImageElement>()(
    z.looseObject({
      ...boxed,
      kind: z.literal('image'),
      assetId: recordIdSchema,
      crop: z.looseObject({ x: unit, y: unit, w: unit, h: unit }).optional(),
      fit: z.enum(['cover', 'contain', 'fill']).meta({ ui: 'select', group: 'Image', order: 1, label: 'Fit' }).optional(),
      maskDefId: qualifiedNameSchema.optional(),
    }),
  ),
  component: checkedSchema<ComponentElement>()(
    z.looseObject({ ...boxed, kind: z.literal('component'), componentId: qualifiedNameSchema, props, snapshotAssetId: recordIdSchema.optional() }),
  ),
  table: checkedSchema<TableElement>()(
    z
      .looseObject({
        ...boxed,
        kind: z.literal('table'),
        rows: z
          .array(z.looseObject({ h: z.number().positive() }))
          .min(1)
          .max(MAX_TABLE_LINES),
        cols: z
          .array(z.looseObject({ w: z.number().positive() }))
          .min(1)
          .max(MAX_TABLE_LINES),
        cells: z.record(z.string(), tableCellSchema),
        tableStyle: z.string().min(1).optional(),
      })
      .superRefine(checkTableGrid),
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

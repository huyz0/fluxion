// The AI patch format v1 (ADR-0035) as Zod schemas: the source of the generated JSON Schemas in specs/schema/ (FR-AI-001, FR-AI-003).
// Payloads use FluxScript vocabulary (ADR-0030): a node is the keys the reader compiles, an edge is the shorthand `a -> b: label`.
import { z } from 'zod';

/**
 * At most this many ops in one patch (ADR-0035).
 *
 * @public
 */
export const MAX_PATCH_OPS = 200;

/** A reference: `#<RecordId>`, an edge key (`a->b`, `a~>b`) or a slug (ADR-0035). */
const refSchema = z.string().min(1).describe('a slug, #<RecordId>, or an edge key a->b / a~>b');
const slugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .describe('a new slug: lowercase letters, digits and hyphens, starting with a letter');

/** A style: a stroke preset name, or token names by key. */
const styleSchema = z.record(z.string(), z.string()).describe('token names by key, e.g. { fill: "surface", stroke: "accent" }');
const pinSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive().optional(), h: z.number().positive().optional() }).strict();

/** The node keys the FluxScript reader compiles (ADR-0030), as one payload. */
const nodeSpecSchema = z
  .object({
    shape: z.string().optional().describe('a shape id, short (rect) or qualified (basic:rect)'),
    text: z.string().optional(),
    label: z.string().optional(),
    tone: z.string().optional().describe('a theme variant, e.g. accent'),
    style: styleSchema.optional(),
    pin: pinSchema.optional().describe('a box in screen units; the layout leaves it alone'),
    alt: z.string().optional(),
  })
  .strict();

/** The layout intents of the built-in layouts (`layered`, `grid`, `stack`); a plugin layout's own options travel in the plain schema and the CLI only. */
const layoutIntentSchema = z
  .object({
    type: z.string().describe('a layouts registry name: layered, grid, stack, or a plugin layout'),
    direction: z.enum(['down', 'right', 'up', 'left']).optional().describe('layered: all four; stack: down or right'),
    spacing: z.enum(['compact', 'comfortable', 'spacious']).optional().describe('layered: the gap preset'),
    nodeGap: z.number().min(0).optional().describe('layered: space between boxes of one rank, px'),
    rankGap: z.number().min(0).optional().describe('layered: space between ranks, px'),
    gap: z.number().min(0).optional().describe('grid and stack: space between boxes, px'),
    columns: z.number().int().positive().optional().describe('grid: the number of columns'),
    align: z.enum(['start', 'center', 'end']).optional().describe('grid and stack: alignment in the cell or the line'),
    padding: z.number().min(0).optional().describe('the space around the laid-out boxes, px'),
    wrap: z.number().min(0).optional().describe('stack: length after which a box starts a new line, px (0: never)'),
  })
  .strict();

/** The edge options after the shorthand's `:`. */
const edgeSpecSchema = z
  .object({ label: z.string().optional(), style: styleSchema.optional(), route: z.enum(['straight', 'curved', 'orthogonal', 'polyline']).optional() })
  .strict();

/** Picks elements without naming them. */
const selectorSchema = z
  .object({ screen: refSchema.optional(), shape: z.string().optional(), tone: z.string().optional(), kind: z.string().optional() })
  .strict();

/** A step of a screen (applied once steps compile, M18). */
const stepSpecSchema = z.object({ label: z.string().optional(), reveal: z.array(refSchema).optional() }).strict();
/** An interaction rule (applied once interactions compile, M18). */
const interactionSpecSchema = z.object({ on: z.enum(['click', 'hover']), do: z.enum(['goto', 'step']), to: z.string() }).strict();

const op = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) => z.object({ op: z.literal(kind), ...shape }).strict();

/** The nine ops of ADR-0035. */
const patchOpSchema = z.discriminatedUnion('op', [
  op('add', { screen: refSchema, slug: slugSchema, node: nodeSpecSchema, parent: refSchema.optional() }),
  op('update', { target: refSchema, set: nodeSpecSchema }),
  op('remove', { target: refSchema, cascade: z.boolean().optional() }),
  op('connect', { edge: z.string().min(1).describe('the edge shorthand: a.e -> b: label'), spec: edgeSpecSchema.optional() }),
  op('disconnect', { target: refSchema }),
  op('setLayout', { scope: refSchema, layout: layoutIntentSchema, relayout: z.boolean().optional() }),
  op('restyle', { targets: z.union([z.array(refSchema).min(1), z.object({ select: selectorSchema }).strict()]), style: styleSchema }),
  op('addStep', { screen: refSchema, at: z.union([z.number().int().min(0), z.literal('end')]).optional(), step: stepSpecSchema }),
  op('addInteraction', { owner: refSchema, rule: interactionSpecSchema }),
]);

const patchSchema = z
  .object({
    flux: z.literal(1),
    baseRevision: z
      .string()
      .regex(/^r\d+$/)
      .optional()
      .describe('the document revision r<N>; a different revision rejects the patch'),
    ops: z.array(patchOpSchema).min(1).max(MAX_PATCH_OPS),
  })
  .strict();

/**
 * The keys of a node payload: those the FluxScript reader knows (ADR-0030).
 *
 * @public
 */
export const NODE_SPEC_KEYS: readonly string[] = Object.keys(nodeSpecSchema.shape);

/**
 * Token names by key.
 *
 * @public
 */
export type StyleSpec = { readonly [key: string]: string };

/**
 * A node payload.
 *
 * @public
 */
export type NodeSpec = {
  /** A shape id, short (`rect`) or qualified (`basic:rect`). */
  readonly shape?: string | undefined;
  /** Text content. */
  readonly text?: string | undefined;
  /** The label shown in the shape. */
  readonly label?: string | undefined;
  /** A theme variant. */
  readonly tone?: string | undefined;
  /** Token names by key. */
  readonly style?: StyleSpec | undefined;
  /** A box in screen units. */
  readonly pin?:
    | {
        /** Left edge. */
        readonly x: number;
        /** Top edge. */
        readonly y: number;
        /** Width, when pinned. */
        readonly w?: number | undefined;
        /** Height, when pinned. */
        readonly h?: number | undefined;
      }
    | undefined;
  /** Alternative text. */
  readonly alt?: string | undefined;
};

/**
 * The edge options after the shorthand's `:`.
 *
 * @public
 */
export type EdgeSpec = {
  /** Its label. */
  readonly label?: string | undefined;
  /** Its style. */
  readonly style?: StyleSpec | undefined;
  /** Its route type. */
  readonly route?: 'straight' | 'curved' | 'orthogonal' | 'polyline' | undefined;
};

/**
 * A layout intent.
 *
 * @public
 */
export type LayoutIntent = {
  /** A `layouts` registry name. */
  readonly type: string;
  /** The direction: layered takes all four, stack `down` or `right`. */
  readonly direction?: 'down' | 'right' | 'up' | 'left' | undefined;
  /** Layered: the gap preset. */
  readonly spacing?: 'compact' | 'comfortable' | 'spacious' | undefined;
  /** Layered: space between boxes of one rank, px. */
  readonly nodeGap?: number | undefined;
  /** Layered: space between ranks, px. */
  readonly rankGap?: number | undefined;
  /** Grid and stack: space between boxes, px. */
  readonly gap?: number | undefined;
  /** Grid: the number of columns. */
  readonly columns?: number | undefined;
  /** Grid and stack: alignment. */
  readonly align?: 'start' | 'center' | 'end' | undefined;
  /** The space around the laid-out boxes, px. */
  readonly padding?: number | undefined;
  /** Stack: length after which a box starts a new line, px. */
  readonly wrap?: number | undefined;
};

/**
 * A selector of elements.
 *
 * @public
 */
export type Selector = {
  /** Only in this screen. */
  readonly screen?: string | undefined;
  /** Only this shape. */
  readonly shape?: string | undefined;
  /** Only this tone. */
  readonly tone?: string | undefined;
  /** Only this element kind. */
  readonly kind?: string | undefined;
};

/**
 * One op of a patch (ADR-0035).
 *
 * @public
 */
export type PatchOp =
  | {
      /** Add a node. */
      readonly op: 'add';
      /** The screen it goes in. */
      readonly screen: string;
      /** Its new slug. */
      readonly slug: string;
      /** Its payload. */
      readonly node: NodeSpec;
      /** The container it goes in. */
      readonly parent?: string | undefined;
    }
  | {
      /** Update a node. */
      readonly op: 'update';
      /** The node. */
      readonly target: string;
      /** The keys to set. */
      readonly set: NodeSpec;
    }
  | {
      /** Remove an element. */
      readonly op: 'remove';
      /** The element. */
      readonly target: string;
      /** Also remove the connectors attached to it. */
      readonly cascade?: boolean | undefined;
    }
  | {
      /** Connect two nodes. */
      readonly op: 'connect';
      /** The edge shorthand. */
      readonly edge: string;
      /** Options for the edge. */
      readonly spec?: EdgeSpec | undefined;
    }
  | {
      /** Remove a connector. */
      readonly op: 'disconnect';
      /** The edge key or connector id. */
      readonly target: string;
    }
  | {
      /** Set a screen's or container's layout. */
      readonly op: 'setLayout';
      /** The screen or container. */
      readonly scope: string;
      /** The layout intent. */
      readonly layout: LayoutIntent;
      /** Lay out again (default true). */
      readonly relayout?: boolean | undefined;
    }
  | {
      /** Restyle elements. */
      readonly op: 'restyle';
      /** The elements, by reference or by selector. */
      readonly targets:
        | readonly string[]
        | {
            /** The selector. */
            readonly select: Selector;
          };
      /** The style to set. */
      readonly style: StyleSpec;
    }
  | {
      /** Add a step. */
      readonly op: 'addStep';
      /** The screen. */
      readonly screen: string;
      /** Where: an index or the end. */
      readonly at?: number | 'end' | undefined;
      /** The step. */
      readonly step: {
        /** Its label. */
        readonly label?: string | undefined;
        /** The elements it reveals. */
        readonly reveal?: readonly string[] | undefined;
      };
    }
  | {
      /** Add an interaction rule. */
      readonly op: 'addInteraction';
      /** The element that owns it. */
      readonly owner: string;
      /** The rule. */
      readonly rule: {
        /** The event. */
        readonly on: 'click' | 'hover';
        /** The action. */
        readonly do: 'goto' | 'step';
        /** The target screen or step. */
        readonly to: string;
      };
    };

/**
 * An AI patch as written.
 *
 * @public
 */
export type AiPatch = {
  /** The patch format version. */
  readonly flux: 1;
  /** The document revision `r<N>` the patch was written against. */
  readonly baseRevision?: string | undefined;
  /** The ops, applied in order. */
  readonly ops: readonly PatchOp[];
};

/**
 * An AI patch (ADR-0035): `flux: 1`, an optional `r<N>` base revision, and 1 to {@link MAX_PATCH_OPS} ops.
 *
 * @public
 */
export const aiPatchSchema: z.ZodType<AiPatch> = patchSchema;

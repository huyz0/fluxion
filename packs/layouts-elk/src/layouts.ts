// The ELK layouts (FR-LAY-003, ADR-0045): `layouts-elk:layered`, `layouts-elk:stress` and `layouts-elk:rectpacking`, each a layout algorithm
// of the layout registry's shape (id, version, Zod options schema, capabilities, parseOptions, synchronous run) over one ELK engine. Packs import
// only the SDK, so the shapes the registry reads are written out here.
import { z } from 'zod';
import type { ElkEdge, ElkEngine, ElkNode } from './engine.js';

/**
 * A box: position and size.
 *
 * @public
 */
export type ElkBox = {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width. */
  readonly w: number;
  /** Height. */
  readonly h: number;
};

/**
 * What an ELK layout runs on: the layout registry's input, as far as ELK reads it.
 *
 * @public
 */
export type ElkLayoutInput = {
  /** The nodes. */
  readonly nodes: readonly {
    /** The record id. */
    readonly id: string;
    /** The current box; its size is kept. */
    readonly box: ElkBox;
    /** Model order; ties are broken by id. */
    readonly order: number;
    /** A pinned node keeps its box. */
    readonly pinned?: boolean;
  }[];
  /** The frame the result is placed in (its top-left is the origin). */
  readonly frame: ElkBox;
  /** Connections between the nodes. */
  readonly edges?: readonly {
    /** The connector's record id. */
    readonly id: string;
    /** The node it starts at. */
    readonly source: string;
    /** The node it ends at. */
    readonly target: string;
    /** Model order; ties are broken by id. */
    readonly order: number;
  }[];
};

/**
 * Options read from a layout spec: the value, or why it is refused.
 *
 * @public
 */
export type ElkOptionsResult<O> =
  | {
      /** Accepted. */
      readonly ok: true;
      /** The options, defaults filled in. */
      readonly value: O;
    }
  | {
      /** Refused. */
      readonly ok: false;
      /** Why, naming the option. */
      readonly message: string;
    };

/**
 * An ELK layout, in the shape the layout registry accepts (`registerLayout`).
 *
 * @public
 */
export type ElkLayout<O> = {
  /** The registry name, `layouts-elk:<name>`. */
  readonly id: string;
  /** One line for the AI catalog. */
  readonly describe: string;
  /** Bumped when the output for the same input changes. */
  readonly version: string;
  /** The options. */
  readonly schema: z.ZodType<O>;
  /** What it can do: no pins or nesting of its own; runs wherever ELK is loaded. */
  readonly capabilities: {
    /** Pinned nodes keep their box only through the pipeline. */
    readonly pins: false;
    /** Nested containers are laid out by the pipeline, bottom-up. */
    readonly compound: false;
    /** On the page's thread or in the layout worker. */
    readonly runsIn: 'either';
  };
  /** Read a layout spec's `options`. */
  parseOptions(raw: unknown): ElkOptionsResult<O>;
  /** Lay out `input`: a box for every node, pinned ones unchanged. */
  run(
    input: ElkLayoutInput,
    options: O,
  ): {
    /** Boxes by node id. */
    readonly boxes: { readonly [id: string]: ElkBox };
  };
};

/** The version of every ELK layout: elkjs's, as the output follows it. */
const VERSION = 'elk-0.12.0';

const DIRECTION = { down: 'DOWN', right: 'RIGHT', up: 'UP', left: 'LEFT' } as const;

const layeredOptions = z.object({
  direction: z.enum(['down', 'right', 'up', 'left']).default('down').describe('Which way the layers run'),
  gap: z.number().min(0).default(40).describe('Space between nodes, px'),
});
const stressOptions = z.object({ edgeLength: z.number().min(1).default(120).describe('Desired length of an edge, px') });
const packingOptions = z.object({ gap: z.number().min(0).default(16).describe('Space between boxes, px') });

/** Options parsed by `schema`, a refusal naming the first bad option. */
function parser<O>(schema: z.ZodType<O>): (raw: unknown) => ElkOptionsResult<O> {
  return (raw) => {
    const r = schema.safeParse(raw ?? {});
    if (r.success) return { ok: true, value: r.data };
    const issue = r.error.issues[0];
    return { ok: false, message: `${issue?.path.join('.') || 'options'}: ${issue?.message ?? 'invalid'}` };
  };
}

const byOrder = <T extends { readonly order: number; readonly id: string }>(a: T, b: T) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The ELK graph of `input` (nodes and edges in model order, ties by id), with `layoutOptions`. */
export function elkGraph(input: ElkLayoutInput, layoutOptions: { readonly [key: string]: string }): ElkNode {
  const nodes = [...input.nodes].sort(byOrder);
  const ids = new Set(nodes.map((n) => n.id));
  const edges: ElkEdge[] = [...(input.edges ?? [])]
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .sort(byOrder)
    .map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] }));
  const children = nodes.map((n) => ({ id: n.id, width: n.box.w, height: n.box.h, x: n.box.x - input.frame.x, y: n.box.y - input.frame.y }));
  return { id: 'root', layoutOptions, children, edges };
}

/** The boxes ELK placed, moved into the frame; pinned nodes and nodes ELK left out keep their boxes. */
export function boxesOf(input: ElkLayoutInput, laid: ElkNode): { readonly [id: string]: ElkBox } {
  const placed = new Map((laid.children ?? []).map((c) => [c.id, c] as const));
  const boxes: { [id: string]: ElkBox } = {};
  for (const n of input.nodes) {
    const c = placed.get(n.id);
    boxes[n.id] =
      n.pinned || c === undefined || c.x === undefined || c.y === undefined
        ? n.box
        : { x: input.frame.x + Math.round(c.x * 2) / 2, y: input.frame.y + Math.round(c.y * 2) / 2, w: n.box.w, h: n.box.h };
  }
  return boxes;
}

/** What one ELK layout is made of: its name after `layouts-elk:`, its catalog line, options and the ELK options they give. */
type Spec<O> = {
  readonly name: string;
  readonly describe: string;
  readonly schema: z.ZodType<O>;
  readonly optionsOf: (o: O) => { readonly [key: string]: string };
};

/** One ELK layout over `engine`. */
function elkLayout<O>(engine: ElkEngine, { name, describe, schema, optionsOf }: Spec<O>): ElkLayout<O> {
  return {
    id: `layouts-elk:${name}`,
    describe,
    version: VERSION,
    schema,
    capabilities: { pins: false, compound: false, runsIn: 'either' },
    parseOptions: parser(schema),
    run: (input, options) => ({ boxes: boxesOf(input, engine(elkGraph(input, optionsOf(options)))) }),
  };
}

/**
 * The three ELK layouts over `engine`: layered (Sugiyama, with ports-free edges), stress (edge lengths kept close to one length) and
 * rectpacking (boxes packed into rows).
 *
 * @public
 */
export function elkLayouts(engine: ElkEngine): readonly ElkLayout<never>[] {
  return [
    elkLayout(engine, {
      name: 'layered',
      describe: 'ELK layered: nodes in layers along the edges, few crossings',
      schema: layeredOptions,
      optionsOf: (o) => ({
        'elk.algorithm': 'layered',
        'elk.direction': DIRECTION[o.direction],
        'elk.spacing.nodeNode': String(o.gap),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(o.gap),
      }),
    }),
    elkLayout(engine, {
      name: 'stress',
      describe: 'ELK stress: every edge close to one length, for undirected graphs',
      schema: stressOptions,
      optionsOf: (o) => ({ 'elk.algorithm': 'stress', 'elk.stress.desiredEdgeLength': String(o.edgeLength) }),
    }),
    elkLayout(engine, {
      name: 'rectpacking',
      describe: 'ELK rectpacking: boxes packed into rows in model order',
      schema: packingOptions,
      optionsOf: (o) => ({ 'elk.algorithm': 'rectpacking', 'elk.spacing.nodeNode': String(o.gap) }),
    }),
  ] as unknown as readonly ElkLayout<never>[];
}

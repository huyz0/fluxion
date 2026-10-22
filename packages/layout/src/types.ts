// The layout contract as far as M12 needs it (05-layout-and-routing.md §2, ADR-0030): a pure, synchronous algorithm over boxes. M13
// extends it (edges, constraints, measured text, the engine and its worker); what is here stays.
import type { TextMeasurer } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import type { ZodType } from 'zod';

/**
 * A node to lay out: its id, its current box (size already known), its model order, and whether it is pinned (never moved).
 *
 * @public
 */
export type LayoutNode = {
  /** The record id. */
  readonly id: string;
  /** The current box; `w` and `h` are its size. */
  readonly box: Box;
  /** Model order (fractional-index rank); ties are broken by id. */
  readonly order: number;
  /** A pinned node keeps its box. */
  readonly pinned?: boolean;
  /** The container this node sits in, for nested layouts (laid out bottom-up, FR-LAY-005). */
  readonly parentId?: string;
  /** What the snapshot read from the element's `semantic` data for the algorithm (rank, lane, partition, ...). */
  readonly hints?: { readonly [key: string]: unknown };
};

/**
 * A connection between two nodes, for algorithms that follow edges (`layered`).
 *
 * @public
 */
export type LayoutEdge = {
  /** The connector's record id. */
  readonly id: string;
  /** The node the edge starts at. */
  readonly source: string;
  /** The node the edge ends at. */
  readonly target: string;
  /** Model order; ties are broken by id. */
  readonly order: number;
};

/**
 * Which part of a screen a layout runs on: all of it, the selected nodes, or the children of one container (ADR-0033).
 *
 * @public
 */
export type LayoutScope = 'screen' | 'selection' | ContainerScope;

/**
 * A layout run on the children of one container.
 *
 * @public
 */
export type ContainerScope = {
  /** The record id of the container. */
  readonly containerId: string;
};

/**
 * What a layout runs on.
 *
 * @public
 */
export type LayoutInput = {
  /** The nodes. */
  readonly nodes: readonly LayoutNode[];
  /** The container's box. */
  readonly frame: Box;
  /** Connections between the nodes; empty when omitted. */
  readonly edges?: readonly LayoutEdge[];
  /** What the run covers (default `screen`). */
  readonly scope?: LayoutScope;
  /** Relations the `constraints` post-pass keeps, applied in this order (ADR-0045); none when omitted. */
  readonly constraints?: readonly LayoutConstraint[];
};

/**
 * A relation between boxes that the `constraints` post-pass keeps whatever the algorithm did (FR-LAY-006, ADR-0045). Ids that are not
 * nodes of the input are ignored.
 *
 * - `align`: the nodes share one coordinate on `axis`: their left or top edge (`start`), centre (`center`, the default) or far edge (`end`).
 * - `sameRank`: the nodes are on one rank: `align` on `axis` (default `y`, the rows of a `down` flow) at the centre.
 * - `order`: `after` starts at least `gap` px (default 0) past the end of `before` on `axis`.
 * - `spacing`: the gap between neighbouring boxes in a row or column is at least `min` and at most `max` px.
 *
 * @public
 */
export type LayoutConstraint =
  | {
      /** Line the nodes up. */
      readonly type: 'align';
      /** The axis of the shared coordinate. */
      readonly axis: 'x' | 'y';
      /** The node ids. */
      readonly nodes: readonly string[];
      /** The point of each box on that coordinate (default `center`). */
      readonly at?: 'start' | 'center' | 'end';
    }
  | {
      /** Put the nodes on one rank. */
      readonly type: 'sameRank';
      /** The node ids. */
      readonly nodes: readonly string[];
      /** The axis of the shared centre (default `y`). */
      readonly axis?: 'x' | 'y';
    }
  | {
      /** Keep one node after another. */
      readonly type: 'order';
      /** The axis along which `after` follows `before`. */
      readonly axis: 'x' | 'y';
      /** The id of the node that comes first. */
      readonly before: string;
      /** The id of the node that comes after it. */
      readonly after: string;
      /** The least space between them, px (default 0). */
      readonly gap?: number;
    }
  | {
      /** Bound the gaps between neighbouring boxes. */
      readonly type: 'spacing';
      /** The least gap, px; it also raises the overlap pass's margin. */
      readonly min?: number;
      /** The largest gap, px. */
      readonly max?: number;
    };

/**
 * What a layout gives back: a box for every node, pinned ones unchanged.
 *
 * @public
 */
export type LayoutOutput = {
  /** Boxes by node id. */
  readonly boxes: { readonly [id: string]: Box };
  /** How good the result is; filled by the pipeline when the algorithm does not know it. */
  readonly metrics?: LayoutMetrics;
  /** The fingerprint of the run (ADR-0033); filled by the pipeline. */
  readonly fingerprint?: string;
};

/**
 * Measures of a layout result.
 *
 * @public
 */
export type LayoutMetrics = {
  /** Pairs of boxes that overlap (pinned pairs included, ADR-0034). */
  readonly overlaps: number;
  /** Pairs of edges that cross, as straight lines between box centres (edges that share a node do not count). */
  readonly crossings: number;
  /** Edges that are neither horizontal nor vertical, each needing a bend in an orthogonal route. */
  readonly bends: number;
  /** Milliseconds the run took, 0 when no clock is injected. */
  readonly ms: number;
};

/**
 * What the pipeline returns: the output with both `metrics` and `fingerprint` set.
 *
 * @public
 */
export type LaidOut = {
  /** Boxes by node id. */
  readonly boxes: { readonly [id: string]: Box };
  /** How good the result is. */
  readonly metrics: LayoutMetrics;
  /** The fingerprint of the run (ADR-0033). */
  readonly fingerprint: string;
};

/**
 * The part of an `AbortSignal` a layout reads.
 *
 * @public
 */
export type AbortSignalLike = {
  /** True once the run was asked to stop. */
  readonly aborted: boolean;
};

/**
 * What a run may use besides its input (ADR-0033): a seeded random stream, the text measurer and an abort signal.
 *
 * @public
 */
export type LayoutCtx = {
  /** The seeded stream (sfc32, ADR-0034): numbers in [0, 1). The only randomness an algorithm may use. */
  readonly rng: () => number;
  /** Sizes text. */
  readonly measure: TextMeasurer;
  /** Tells a cooperative run to stop (the host's `AbortSignal`; this package has no DOM types). */
  readonly signal: AbortSignalLike;
};

/**
 * What an algorithm can do; read by the engine and the inspector.
 *
 * @public
 */
export type LayoutCapabilities = {
  /** Keeps pinned nodes where they are. */
  readonly pins: boolean;
  /** Lays out nested containers itself. */
  readonly compound: boolean;
  /** Constraint types it honours itself (`align`, `order`, ...); the `constraints` post-pass applies them to every algorithm's result. */
  readonly constraints?: readonly string[];
  /** Where it may run: `main` thread only, `worker` only, or `either`. */
  readonly runsIn: 'main' | 'worker' | 'either';
};

/**
 * Options read from a layout spec: the value, or why it is refused.
 *
 * @public
 */
export type OptionsResult<O> =
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
 * A layout algorithm, registered in the `layouts` registry under its `id`.
 *
 * @public
 */
export interface LayoutAlgorithm<O> {
  /** The registry name, e.g. `stack`. */
  readonly id: string;
  /** One line saying what the layout does, for the AI catalog (FR-AI-002); required by a dev host's registries. */
  readonly describe?: string;
  /** Bumped when the output for the same input changes. */
  readonly version: string;
  /** The options as a Zod schema: the source of the inspector form, the catalog and MCP metadata (FR-LAY-001); required from M13.5. */
  readonly schema: ZodType<O>;
  /** What the algorithm can do. */
  readonly capabilities: LayoutCapabilities;
  /** Read a layout spec's `options` (undefined means the defaults). */
  parseOptions(raw: unknown): OptionsResult<O>;
  /** Lay out `input`; pure, synchronous and deterministic. `ctx` is optional: an algorithm that needs no randomness or text ignores it. */
  run(input: LayoutInput, options: O, ctx?: LayoutCtx): LayoutOutput;
}

// The layout contract as far as M12 needs it (05-layout-and-routing.md §2, ADR-0030): a pure, synchronous algorithm over boxes. M13
// extends it (edges, constraints, measured text, the engine and its worker); what is here stays.
import type { Box } from '@fluxion/geometry';

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
};

/**
 * What a layout gives back: a box for every node, pinned ones unchanged.
 *
 * @public
 */
export type LayoutOutput = {
  /** Boxes by node id. */
  readonly boxes: { readonly [id: string]: Box };
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
  /** Bumped when the output for the same input changes. */
  readonly version: string;
  /** Read a layout spec's `options` (undefined means the defaults). */
  parseOptions(raw: unknown): OptionsResult<O>;
  /** Lay out `input`; pure and deterministic. */
  run(input: LayoutInput, options: O): LayoutOutput;
}

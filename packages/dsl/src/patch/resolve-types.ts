// The shapes the patch resolver returns (ADR-0035): ops with every reference resolved.
import type { CoreRegistries } from '@fluxion/core';
import type { AnyRecord, Diagnostic } from '@fluxion/schema';
import type { EdgeSpec, LayoutIntent, NodeSpec, StyleSpec } from './schema.js';
import type { RefKind } from './working-index.js';

/**
 * What a patch is resolved against.
 *
 * @public
 */
export type PatchContext = {
  /** The document's records, keyed by id. */
  readonly records: { readonly [id: string]: AnyRecord };
  /** The document revision as `r<N>` (ADR-0035); a patch with a different `baseRevision` is stale. */
  readonly revision?: string;
  /** Shape and layout lookups; without them a shape or layout name is not checked. */
  readonly registries?: CoreRegistries;
};

/**
 * A resolved reference: a record id, or the slug of an element an earlier op of the patch adds.
 *
 * @public
 */
export type ResolvedRef = {
  /** The record id, or the slug of an element added earlier in the same patch. */
  readonly id: string;
  /** What the reference points at (screen, element, connector, ...). */
  readonly kind: RefKind;
  /** Set when the reference names an element that an earlier op of the same patch adds. */
  readonly added?: true;
};

/**
 * One op with its references resolved; `index` is the op's position in the patch.
 *
 * @public
 */
export type ResolvedOp =
  | {
      /** Discriminator. */
      readonly op: 'add';
      /** Position of the op in the patch. */
      readonly index: number;
      /** The screen the element is added to. */
      readonly screen: ResolvedRef;
      /** The new element's slug. */
      readonly slug: string;
      /** The container the element goes into, when the op names one. */
      readonly parent?: ResolvedRef;
      /** The element payload. */
      readonly node: NodeSpec;
    }
  | {
      /** Discriminator. */
      readonly op: 'update';
      /** Position of the op in the patch. */
      readonly index: number;
      /** The element to change. */
      readonly target: ResolvedRef;
      /** The fields to set. */
      readonly set: NodeSpec;
    }
  | {
      /** Discriminator. */
      readonly op: 'remove';
      /** Position of the op in the patch. */
      readonly index: number;
      /** The record to remove. */
      readonly target: ResolvedRef;
      /** Ids of the connectors removed with it (`cascade`). */
      readonly connectors: readonly string[];
    }
  | {
      /** Discriminator. */
      readonly op: 'connect';
      /** Position of the op in the patch. */
      readonly index: number;
      /** The screen the connector is added to. */
      readonly screen: ResolvedRef;
      /** The source element. */
      readonly from: ResolvedRef;
      /** The target element. */
      readonly to: ResolvedRef;
      /** The arrow text of the edge shorthand. */
      readonly arrow: string;
      /** Anchors named on either end. */
      readonly anchors: {
        /** Anchor named on the source end. */
        readonly from?: string;
        /** Anchor named on the target end. */
        readonly to?: string;
      };
      /** The remaining edge payload (label, style). */
      readonly spec: EdgeSpec;
    }
  | {
      /** Discriminator. */
      readonly op: 'disconnect';
      /** Position of the op in the patch. */
      readonly index: number;
      /** The connector to remove. */
      readonly target: ResolvedRef;
    }
  | {
      /** Discriminator. */
      readonly op: 'setLayout';
      /** Position of the op in the patch. */
      readonly index: number;
      /** The screen or container whose layout changes. */
      readonly scope: ResolvedRef;
      /** The new layout intent. */
      readonly layout: LayoutIntent;
      /** Whether the touched containers are re-laid out. */
      readonly relayout: boolean;
    }
  | {
      /** Discriminator. */
      readonly op: 'restyle';
      /** Position of the op in the patch. */
      readonly index: number;
      /** The records to restyle (explicit targets plus any selector matches). */
      readonly targets: readonly ResolvedRef[];
      /** The style to apply. */
      readonly style: StyleSpec;
    };

/**
 * A patch with every reference resolved.
 *
 * @public
 */
export type ResolvedPatch = {
  /** The ops in patch order. */
  readonly ops: readonly ResolvedOp[];
};

/**
 * The outcome of {@link resolvePatch}: the resolved ops, or every problem found (the whole patch is rejected).
 *
 * @public
 */
export type PatchResolution =
  | {
      /** The patch resolved. */
      readonly ok: true;
      /** The resolved patch. */
      readonly value: ResolvedPatch;
    }
  | {
      /** The patch is rejected. */
      readonly ok: false;
      /** Every problem found, with pointers into the patch. */
      readonly diagnostics: readonly Diagnostic[];
    };

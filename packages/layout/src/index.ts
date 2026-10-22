/**
 * `@fluxion/layout` — Layout interface, built-in algorithms, worker host, constraint/overlap pass, text-measure port.
 *
 * @packageDocumentation
 */
import type { Registry } from '@fluxion/core';
import { circularLayout } from './circular.js';
import { forceLayout } from './force.js';
import { gridLayout } from './grid.js';
import { layeredLayout } from './layered.js';
import { mindmapLayout } from './mindmap.js';
import { packingLayout } from './packing.js';
import { radialLayout } from './radial.js';
import { stackLayout } from './stack.js';
import { orgchartLayout, treeLayout } from './tree.js';

export {
  type AlgorithmByName,
  APPLY_BOXES_COMMAND_ID,
  ARRANGE_COMMAND_ID,
  arrangeCommand,
  type Reader,
  registerArrangeCommand,
} from './arrange.js';
export {
  type ArrangeCommandError,
  type ArrangeCommandResult,
  type ArrangeMoved,
  type ArrangeWriteOptions,
  type AsyncArrangeDeps,
  type AsyncArrangeResult,
  createAsyncArranger,
} from './arrange-async.js';
export { type CircularOptions, circularLayout } from './circular.js';
export { type Err, err, type LayoutError, type LayoutErrorCode, type Ok, ok, type Result } from './errors.js';
export { type ForceOptions, forceLayout } from './force.js';
export { type GridOptions, gridLayout } from './grid.js';
export { type LayeredOptions, layeredLayout } from './layered.js';
export { type MindmapOptions, mindmapLayout } from './mindmap.js';
export { layoutNested, type NestedOptions, type NestedRunner } from './nested.js';
export { type OverlapOptions, overlapCount, removeOverlap } from './overlap.js';
export { type PackingOptions, packingLayout } from './packing.js';
export { applyPins, type Boxes, type PostPassId, snapBoxes } from './passes.js';
export { createLayoutCache, fingerprintOf, type LayoutCache, type LayoutRequest, layoutSync } from './pipeline.js';
export { type RadialOptions, radialLayout } from './radial.js';
export { layoutOptionsJsonSchema, listLayouts, type RegisterLayoutResult, registerLayout } from './registry.js';
export { createRng } from './rng.js';
export { type Scorecard, scoreLayout } from './scorecard.js';
export { buildSnapshot, type SnapshotInput, type SnapshotRecord, type SnapshotRequest } from './snapshot.js';
export { type StackOptions, stackLayout } from './stack.js';
export { orgchartLayout, type TreeOptions, treeLayout } from './tree.js';
export type {
  AbortSignalLike,
  ContainerScope,
  LaidOut,
  LayoutAlgorithm,
  LayoutCapabilities,
  LayoutCtx,
  LayoutEdge,
  LayoutInput,
  LayoutMetrics,
  LayoutNode,
  LayoutOutput,
  LayoutScope,
  OptionsResult,
} from './types.js';
export type { AbortSignalWithEvents, HostJob, LayoutHost } from './worker/host.js';
export type { LayoutJobMessage } from './worker/protocol.js';

/**
 * Register the built-in layouts in a host's `layouts` registry, as source `core` (built-ins use the plugin API, 03 §4).
 *
 * @public
 */
export function registerBuiltInLayouts(layouts: Registry<string, unknown>): ReturnType<Registry<string, unknown>['register']> {
  // every built-in is tried; the first refusal is what comes back (the others stay registered), else the last success
  const results = [
    stackLayout,
    gridLayout,
    layeredLayout,
    treeLayout,
    orgchartLayout,
    radialLayout,
    mindmapLayout,
    forceLayout,
    circularLayout,
    packingLayout,
  ].map((layout) => layouts.register(layout.id, layout, 'core'));
  return results.find((r) => !r.ok) ?? (results[results.length - 1] as (typeof results)[number]);
}

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

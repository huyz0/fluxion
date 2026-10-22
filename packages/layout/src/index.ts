/**
 * `@fluxion/layout` — Layout interface, built-in algorithms, worker host, constraint/overlap pass, text-measure port.
 *
 * @packageDocumentation
 */
import type { Registry } from '@fluxion/core';
import { circularLayout } from './circular.js';
import { fitLayout } from './fit.js';
import { forceLayout } from './force.js';
import { gridLayout } from './grid.js';
import { layeredLayout } from './layered.js';
import { mindmapLayout } from './mindmap.js';
import { packingLayout } from './packing.js';
import { radialLayout } from './radial.js';
import { stackLayout } from './stack.js';
import { swimlaneLayout } from './swimlane.js';
import { tidyLayout } from './tidy.js';
import { timelineLayout } from './timeline.js';
import { orgchartLayout, treeLayout } from './tree.js';
import type { LayoutAlgorithm } from './types.js';

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
export { applyConstraints } from './constraints.js';
export { type Err, err, type LayoutError, type LayoutErrorCode, type Ok, ok, type Result } from './errors.js';
export { type FitLayoutOptions, fitLayout } from './fit.js';
export { type ForceOptions, forceLayout } from './force.js';
export { type GridOptions, gridLayout } from './grid.js';
export { movedPercent, reconcile } from './incremental.js';
export { type LayeredOptions, layeredLayout } from './layered.js';
export { type MindmapOptions, mindmapLayout } from './mindmap.js';
export { layoutNested, type NestedOptions, type NestedRunner } from './nested.js';
export { type OverlapOptions, overlapCount, removeOverlap } from './overlap.js';
export { type PackingOptions, packingLayout } from './packing.js';
export { applyPins, type Boxes, type FitOptions, fitBoxes, type PostPassId, safeAreaOf, snapBoxes } from './passes.js';
export { createLayoutCache, fingerprintOf, type LayoutCache, type LayoutRequest, layoutSync } from './pipeline.js';
export { type RadialOptions, radialLayout } from './radial.js';
export { layoutOptionsJsonSchema, listLayouts, type RegisterLayoutResult, registerLayout } from './registry.js';
export { createRng } from './rng.js';
export { type Scorecard, scoreLayout } from './scorecard.js';
export { buildSnapshot, type SnapshotInput, type SnapshotRecord, type SnapshotRequest } from './snapshot.js';
export { type StackOptions, stackLayout } from './stack.js';
export { type SwimlaneOptions, swimlaneLayout } from './swimlane.js';
export { type ComparisonOptions, comparisonTemplate } from './templates/comparison.js';
export { type CycleOptions, cycleBasicTemplate } from './templates/cycle.js';
export { type FunnelOptions, funnelTemplate } from './templates/funnel.js';
export { hierarchyOrgTemplate, type OrgOptions } from './templates/hierarchy.js';
export { type MatrixOptions, matrix2x2Template } from './templates/matrix.js';
export { type ChevronOptions, type ProcessOptions, processBasicTemplate, processChevronTemplate } from './templates/process.js';
export { type PyramidOptions, pyramidTemplate } from './templates/pyramid.js';
export {
  type BuildTemplateResult,
  buildTemplate,
  builtInTemplates,
  listTemplates,
  registerBuiltInTemplates,
  registerTemplate,
  templateOptionsJsonSchema,
} from './templates/registry.js';
export { type MilestonesOptions, timelineMilestonesTemplate } from './templates/timeline.js';
export type {
  TemplateConnectorDraft,
  TemplateContext,
  TemplateDef,
  TemplateItem,
  TemplateResult,
  TemplateShapeDraft,
  TemplateSlot,
  TemplateStyle,
} from './templates/types.js';
export { type VennOptions, vennTemplate } from './templates/venn.js';
export { type TidyOptions, tidyLayout } from './tidy.js';
export { type TimelineOptions, timelineLayout } from './timeline.js';
export { orgchartLayout, type TreeOptions, treeLayout } from './tree.js';
export type {
  AbortSignalLike,
  ContainerScope,
  LaidOut,
  LayoutAlgorithm,
  LayoutCapabilities,
  LayoutConstraint,
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
 * The built-in layouts, in registration order: what `registerBuiltInLayouts` registers and what a layout worker serves.
 *
 * @public
 */
export const builtInLayouts: readonly LayoutAlgorithm<never>[] = [
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
  timelineLayout,
  swimlaneLayout,
  tidyLayout,
  fitLayout,
] as unknown as readonly LayoutAlgorithm<never>[];

/**
 * Register the built-in layouts in a host's `layouts` registry, as source `core` (built-ins use the plugin API, 03 §4).
 *
 * @public
 */
export function registerBuiltInLayouts(layouts: Registry<string, unknown>): ReturnType<Registry<string, unknown>['register']> {
  // every built-in is tried; the first refusal is what comes back (the others stay registered), else the last success
  const results = builtInLayouts.map((layout) => layouts.register(layout.id, layout, 'core'));
  return results.find((r) => !r.ok) ?? (results[results.length - 1] as (typeof results)[number]);
}

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

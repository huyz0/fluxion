// The layout pipeline (ADR-0033, ADR-0034): validate and canonicalize the input, run the algorithm with a seeded stream, then the post-passes in
// the fixed order pins, constraints, overlap, snap, and fill `metrics` and `fingerprint`. It is synchronous and pure, so the DSL compiler, the worker and the
// CLI run the same code and get the same bytes. The fingerprint is the first 128 bits of the SHA-256 of the canonical request (core's
// synchronous hash), so equal requests have equal fingerprints and the engine can cache by it.
import { sha256Hash128 } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { applyConstraints, constraintProblem } from './constraints.js';
import { err, type LayoutError, ok, type Result } from './errors.js';
import { movedPercent, reconcile } from './incremental.js';
import { type OverlapOptions, overlapCount, removeOverlap } from './overlap.js';
import { applyPins, type Boxes, type FitOptions, fitBoxes, type PostPassId, snapBoxes } from './passes.js';
import { createRng } from './rng.js';
import { bendCount, crossingCount } from './scorecard.js';
import type { LaidOut, LayoutAlgorithm, LayoutCtx, LayoutInput, LayoutNode } from './types.js';

/**
 * A layout request: what to lay out and how.
 *
 * @public
 */
export type LayoutRequest<O> = {
  /** The nodes, edges, frame and scope. */
  readonly input: LayoutInput;
  /** The algorithm to run. */
  readonly algorithm: LayoutAlgorithm<O>;
  /** The algorithm's options as written (undefined means the defaults). */
  readonly options?: unknown;
  /** The seed of the random stream (default 0). */
  readonly seed?: number;
  /** A hash of the fonts the sizes in `input` were measured with; part of the fingerprint (default empty: not measured). */
  readonly fontHash?: string;
  /** The post-passes to run, always in the order pins, constraints, overlap, fit, snap (default pins, constraints, overlap and snap). */
  readonly post?: readonly PostPassId[];
  /** Options of the fit pass. */
  readonly fit?: FitOptions;
  /** Options of the overlap pass. */
  readonly overlap?: OverlapOptions;
  /** Sizes text for algorithms that need it; without it a call to `measure` throws, which the pipeline reports as `LAYOUT_FAILED`. */
  readonly measure?: LayoutCtx['measure'];
};

const ORDER: readonly PostPassId[] = ['pins', 'constraints', 'overlap', 'fit', 'snap'];
/** The post-passes of a request that names none: all but `fit`, which only a caller that asks for it wants. */
const DEFAULT_POST: readonly PostPassId[] = ['pins', 'constraints', 'overlap', 'snap'];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const fail = (code: LayoutError['code'], message: string) => err<LayoutError>({ code, message });

/** Why `box` is not a usable box, or undefined. */
function boxProblem(box: Box): string | undefined {
  if (![box.x, box.y, box.w, box.h].every(finite)) return 'is not finite';
  return box.w < 0 || box.h < 0 ? 'has a negative size' : undefined;
}

/** Why the input cannot be laid out, or undefined: a duplicate node id, a box or the frame that is not finite, a negative size. */
function inputProblem(input: LayoutInput): string | undefined {
  const frame = boxProblem(input.frame);
  if (frame) return `the frame ${frame}`;
  const seen = new Set<string>();
  for (const n of input.nodes) {
    if (seen.has(n.id)) return `node id "${n.id}" appears twice`;
    seen.add(n.id);
    const problem = boxProblem(n.box);
    if (problem) return `the box of node "${n.id}" ${problem}`;
    if (!finite(n.order)) return `the order of node "${n.id}" is not finite`;
  }
  const edge = (input.edges ?? []).find((e) => !finite(e.order));
  if (edge) return `the order of edge "${edge.id}" is not finite`;
  return incrementalProblem(input) ?? constraintProblem(input.constraints ?? []);
}

/** Why `previous` or `changed` cannot be read, or undefined (ADR-0046). */
function incrementalProblem(input: LayoutInput): string | undefined {
  if (input.changed !== undefined && !(Array.isArray(input.changed) && input.changed.every((id) => typeof id === 'string')))
    return 'changed is not a list of node ids';
  if (input.previous === undefined) return undefined;
  if (typeof input.previous !== 'object' || input.previous === null) return 'previous is not a map of boxes';
  for (const [id, box] of Object.entries(input.previous)) {
    const problem = typeof box === 'object' && box !== null ? boxProblem(box) : 'is not a box';
    if (problem) return `the previous box of node "${id}" ${problem}`;
  }
  return undefined;
}

/** The input in canonical order: nodes and edges by (order, id). Values are untouched (ADR-0033). */
function canonicalInput(input: LayoutInput): LayoutInput {
  const nodes = [...input.nodes].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  const edges = [...(input.edges ?? [])].sort((a, b) => a.order - b.order || compare(a.id, b.id));
  return { ...input, nodes, edges };
}

/** JSON with object keys sorted and undefined fields dropped: equal values give equal text whatever the key order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const fields = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => compare(a, b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${fields.join(',')}}`;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('a number that is not finite');
    return Object.is(value, -0) ? '-0' : String(value);
  }
  return JSON.stringify(value) ?? 'null';
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The post-passes to run, in pipeline order. */
const passesOf = (post: readonly PostPassId[] | undefined): PostPassId[] => ORDER.filter((p) => (post ?? DEFAULT_POST).includes(p));

const NO_MEASURER: LayoutCtx['measure'] = {
  measure: () => {
    throw new Error('this layout request has no text measurer');
  },
};

/** A prepared request: validated, canonical, with its fingerprint. */
type Prepared<O> = { readonly input: LayoutInput; readonly options: O; readonly fingerprint: string; readonly passes: PostPassId[] };

/**
 * Validate a request and compute its fingerprint without running it: the key the engine's cache uses.
 *
 * @public
 */
export function fingerprintOf<O>(req: LayoutRequest<O>): Result<string> {
  const prepared = prepare(req);
  return prepared.ok ? ok(prepared.value.fingerprint) : prepared;
}

function prepare<O>(req: LayoutRequest<O>): Result<Prepared<O>> {
  const problem = inputProblem(req.input);
  if (problem) return fail('LAYOUT_INPUT_INVALID', problem);
  try {
    const options = req.algorithm.parseOptions(req.options);
    if (!options.ok) return fail('LAYOUT_OPTIONS_INVALID', options.message);
    const input = canonicalInput(req.input);
    const passes = passesOf(req.post);
    const request = {
      algorithm: `${req.algorithm.id}@${req.algorithm.version}`,
      options: options.value,
      seed: req.seed ?? 0,
      input,
      post: passes.map((p) => (p === 'overlap' ? { pass: p, ...req.overlap } : p === 'fit' ? { pass: p, ...req.fit } : { pass: p })),
      fontHash: req.fontHash ?? '',
    };
    return ok({ input, options: options.value, passes, fingerprint: hex(sha256Hash128.hash128(canonicalJson(request))) });
  } catch (e) {
    return fail('LAYOUT_OPTIONS_INVALID', `the options or seed cannot be fingerprinted: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The boxes after the post-passes. */
function afterPasses(input: LayoutInput, boxes: Boxes, passes: readonly PostPassId[], req: Pick<LayoutRequest<unknown>, 'overlap' | 'fit'>): Boxes {
  let out = boxes;
  if (passes.includes('pins')) out = applyPins(input, out);
  if (passes.includes('constraints')) out = applyConstraints(input, out);
  if (passes.includes('overlap')) out = removeOverlap(input, out, req.overlap);
  if (passes.includes('fit')) out = fitBoxes(input, out, req.fit);
  if (passes.includes('snap')) out = snapBoxes(input, out);
  return out;
}

/** The result with every level frozen: a cached result is shared, so no caller can change it for the next. */
function frozen(laid: LaidOut): LaidOut {
  // copies: the boxes of pinned nodes are the caller's own objects, and freezing those would change the caller's input
  const boxes = Object.fromEntries(Object.entries(laid.boxes).map(([id, b]) => [id, Object.freeze({ ...b })]));
  return Object.freeze({ boxes: Object.freeze(boxes), metrics: Object.freeze({ ...laid.metrics }), fingerprint: laid.fingerprint });
}

/** True when every node of the input has a finite box in `boxes`. */
function complete(nodes: readonly LayoutNode[], boxes: Boxes): string | undefined {
  for (const n of nodes) {
    const box = Object.hasOwn(boxes, n.id) ? (boxes[n.id] as Box) : undefined;
    if (!box) return `the algorithm gave no box for node "${n.id}"`;
    if (boxProblem(box)) return `the algorithm gave node "${n.id}" a box that ${boxProblem(box)}`;
  }
  return undefined;
}

/**
 * Lay out a request: validate, run the algorithm, run the post-passes (pins, constraints, overlap, snap), and return the boxes with `metrics` and a
 * `fingerprint`. Expected failures (bad input, bad options, an algorithm that throws or returns a box that is not finite) are a `LayoutError`.
 *
 * @public
 */
export function layoutSync<O>(req: LayoutRequest<O>): Result<LaidOut> {
  const prepared = prepare(req);
  return prepared.ok ? execute(req, prepared.value) : prepared;
}

/** Run a prepared request. */
function execute<O>(req: LayoutRequest<O>, prepared: Prepared<O>): Result<LaidOut> {
  const { input, options, fingerprint, passes } = prepared;
  const ctx: LayoutCtx = { rng: createRng(req.seed ?? 0), measure: req.measure ?? NO_MEASURER, signal: { aborted: false } };
  let boxes: Boxes;
  try {
    boxes = req.algorithm.run(input, options, ctx).boxes;
  } catch (e) {
    return fail('LAYOUT_FAILED', `the algorithm "${req.algorithm.id}" failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const missing = complete(input.nodes, boxes);
  if (missing) return fail('LAYOUT_FAILED', missing);
  // a full run is moved back to where the unchanged nodes were; an algorithm that warm-starts has done that itself (ADR-0046)
  const kept = req.algorithm.capabilities.incremental ? boxes : reconcile(input, boxes);
  const laid = afterPasses(input, kept, passes, req);
  return ok(
    frozen({
      boxes: laid,
      metrics: {
        overlaps: overlapCount(laid),
        crossings: crossingCount(input.edges ?? [], laid),
        bends: bendCount(input.edges ?? [], laid),
        ms: 0,
        ...(input.previous ? { moved: movedPercent(input.previous, laid) } : {}),
      },
      fingerprint,
    }),
  );
}

/**
 * A cache of laid-out requests by fingerprint (FR-LAY-008): an identical request returns the same result without running the algorithm.
 *
 * @public
 */
export type LayoutCache = {
  /** Lay out `req`, or return the result stored for its fingerprint. */
  layout<O>(req: LayoutRequest<O>): Result<LaidOut>;
  /** How many results are stored. */
  readonly size: () => number;
};

/**
 * Create a cache that keeps the `limit` most recently used results (default 64; anything but a number of 1 or more is read as 64). Results are
 * frozen, so a caller cannot change what the next one receives.
 *
 * @public
 */
export function createLayoutCache(limit = 64): LayoutCache {
  const capacity = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 64;
  const stored = new Map<string, LaidOut>();
  return {
    layout(req) {
      const prepared = prepare(req);
      if (!prepared.ok) return prepared;
      const key = prepared.value.fingerprint;
      const hit = stored.get(key);
      if (hit) {
        stored.delete(key);
        stored.set(key, hit);
        return ok(hit);
      }
      const result = execute(req, prepared.value);
      if (result.ok) {
        stored.set(key, result.value);
        if (stored.size > capacity) stored.delete(stored.keys().next().value as string);
      }
      return result;
    },
    size: () => stored.size,
  };
}

// The layout pipeline (ADR-0033, ADR-0034): validate and canonicalize the input, run the algorithm with a seeded stream, then the post-passes in
// the fixed order pins, overlap, snap, and fill `metrics` and `fingerprint`. It is synchronous and pure, so the DSL compiler, the worker and the
// CLI run the same code and get the same bytes. The fingerprint is the first 128 bits of the SHA-256 of the canonical request (core's
// synchronous hash), so equal requests have equal fingerprints and the engine can cache by it.
import { sha256Hash128 } from '@fluxion/core';
import type { Box } from '@fluxion/geometry';
import { err, type LayoutError, ok, type Result } from './errors.js';
import { type OverlapOptions, overlapCount, removeOverlap } from './overlap.js';
import { applyPins, type Boxes, type PostPassId, snapBoxes } from './passes.js';
import { createRng } from './rng.js';
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
  /** The post-passes to run, always in the order pins, overlap, snap (default all three). */
  readonly post?: readonly PostPassId[];
  /** Options of the overlap pass. */
  readonly overlap?: OverlapOptions;
  /** Sizes text for algorithms that need it; without it a call to `measure` throws, which the pipeline reports as `LAYOUT_FAILED`. */
  readonly measure?: LayoutCtx['measure'];
};

const ORDER: readonly PostPassId[] = ['pins', 'overlap', 'snap'];
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
  return JSON.stringify(value) ?? 'null';
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** The post-passes to run, in pipeline order. */
const passesOf = (post: readonly PostPassId[] | undefined): PostPassId[] => ORDER.filter((p) => (post ?? ORDER).includes(p));

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
  const options = req.algorithm.parseOptions(req.options);
  if (!options.ok) return fail('LAYOUT_OPTIONS_INVALID', options.message);
  const input = canonicalInput(req.input);
  const passes = passesOf(req.post);
  const request = {
    algorithm: `${req.algorithm.id}@${req.algorithm.version}`,
    options: options.value,
    seed: req.seed ?? 0,
    input,
    post: passes.map((p) => (p === 'overlap' ? { pass: p, ...req.overlap } : { pass: p })),
    fontHash: req.fontHash ?? '',
  };
  return ok({ input, options: options.value, passes, fingerprint: hex(sha256Hash128.hash128(canonicalJson(request))) });
}

/** The boxes after the post-passes. */
function afterPasses(input: LayoutInput, boxes: Boxes, passes: readonly PostPassId[], overlap: OverlapOptions | undefined): Boxes {
  let out = boxes;
  if (passes.includes('pins')) out = applyPins(input, out);
  if (passes.includes('overlap')) out = removeOverlap(input, out, overlap);
  if (passes.includes('snap')) out = snapBoxes(input, out);
  return out;
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
 * Lay out a request: validate, run the algorithm, run the post-passes (pins, overlap, snap), and return the boxes with `metrics` and a
 * `fingerprint`. Expected failures (bad input, bad options, an algorithm that throws or returns a box that is not finite) are a `LayoutError`.
 *
 * @public
 */
export function layoutSync<O>(req: LayoutRequest<O>): Result<LaidOut> {
  const prepared = prepare(req);
  if (!prepared.ok) return prepared;
  const { input, options, fingerprint, passes } = prepared.value;
  const ctx: LayoutCtx = { rng: createRng(req.seed ?? 0), measure: req.measure ?? NO_MEASURER, signal: { aborted: false } };
  let boxes: Boxes;
  try {
    boxes = req.algorithm.run(input, options, ctx).boxes;
  } catch (e) {
    return fail('LAYOUT_FAILED', `the algorithm "${req.algorithm.id}" failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const missing = complete(input.nodes, boxes);
  if (missing) return fail('LAYOUT_FAILED', missing);
  const laid = afterPasses(input, boxes, passes, req.overlap);
  return ok({ boxes: laid, metrics: { overlaps: overlapCount(laid), crossings: 0, bends: 0, ms: 0 }, fingerprint });
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
 * Create a cache that keeps the `limit` most recently used results (default 64).
 *
 * @public
 */
export function createLayoutCache(limit = 64): LayoutCache {
  const stored = new Map<string, LaidOut>();
  return {
    layout(req) {
      const key = fingerprintOf(req);
      if (!key.ok) return key;
      const hit = stored.get(key.value);
      if (hit) {
        stored.delete(key.value);
        stored.set(key.value, hit);
        return ok(hit);
      }
      const result = layoutSync(req);
      if (result.ok) {
        stored.set(key.value, result.value);
        if (stored.size > limit) stored.delete(stored.keys().next().value as string);
      }
      return result;
    },
    size: () => stored.size,
  };
}

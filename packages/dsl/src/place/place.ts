// Place stage (ADR-0030 "Pipeline stages in R2", ADR-0031, FR-DSL-005): the 06 §3 layout stage of R2. Pinned elements keep their exact
// boxes; the others are laid out by their container's `layout` from the `layouts` registry, else by `stack`. Groups are laid out bottom-up:
// a group's members first (nested groups before the group around them), then the group, sized to the bounds of its members (02 §3: the box
// the core:5-group-bounds hook keeps), is one node of its own container; moving it moves its members, which stay in screen coordinates. A
// group holding a pin (at any depth) cannot move without moving the pin, so it is pinned in its container. Connectors are not placed:
// their bindings route them.
import type { CoreRegistries } from '@fluxion/core';
import { type LayoutAlgorithm, type LayoutNode, type LayoutOutput, stackLayout } from '@fluxion/layout';
import { type AnyRecord, DIAGNOSTIC_CODES, type LayoutSpec, type RecordId, screenSize } from '@fluxion/schema';
import { nearest } from '../resolve/suggest.js';
import type { DslDiagnostic, SourceRange } from '../types.js';

/**
 * What the place stage runs on: the records of the expand stage, and where their layouts were written (both are fields of an
 * `ExpandResult`).
 *
 * @public
 */
export type PlaceInput = {
  /** The records, keyed by id. */
  readonly records: { readonly [id: string]: AnyRecord };
  /** Where each screen's and group's `layout` type is in the source, by record id; diagnostics point there. */
  readonly layoutSources?: ReadonlyMap<RecordId, SourceRange>;
};

/**
 * How to place: the registries layouts are looked up in.
 *
 * @public
 */
export type PlaceOptions = {
  /** The `layouts` registry of these is where a `layout` type is found. */
  readonly registries: CoreRegistries;
};

/**
 * What {@link placeFlux} gives back.
 *
 * @public
 */
export type PlaceResult = {
  /** The records with every boxed element placed (new objects; the input is not changed). */
  readonly records: { readonly [id: string]: AnyRecord };
  /** Problems found placing: a layout type that is unknown or not compiled yet, options a layout refuses. */
  readonly diagnostics: readonly DslDiagnostic[];
};

/** Layout types the v1 grammar names that R2 does not register: placed with `stack` and `FLX_DSL_NOT_YET` (ADR-0030; `layered` is M13). */
const NOT_YET: ReadonlySet<string> = new Set(['layered']);

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
type El = AnyRecord & {
  readonly id: RecordId;
  readonly kind?: string;
  readonly index?: string;
  readonly parentId?: RecordId;
  readonly screenId?: RecordId;
  readonly placement?: string;
  readonly layout?: LayoutSpec;
  readonly transform?: Box;
  readonly semantic?: { readonly slug?: string };
};
type Algorithm = LayoutAlgorithm<unknown>;
type Ctx = {
  readonly registries: CoreRegistries;
  readonly sources: ReadonlyMap<RecordId, SourceRange>;
  readonly diagnostics: DslDiagnostic[];
  /** Boxed elements by container (a screen id or a group id), in model order. */
  readonly children: ReadonlyMap<string, readonly El[]>;
  /** The working box of every boxed element. */
  readonly boxes: Map<RecordId, Box>;
  /** The parent of every element that has one. */
  readonly parents: ReadonlyMap<RecordId, RecordId>;
};
/** The screen being placed: its diagnostic path, its frame, and the boxes that will not move again (pins, and what pinned groups hold). */
type ScreenCtx = { readonly path: string; readonly frame: Box; readonly settled: Map<RecordId, Box> };
/** A container being laid out: its record (a screen or a group), its diagnostic path, and its screen. */
type Container = { readonly record: El; readonly path: string; readonly screen: ScreenCtx };

const byIndex = (a: El, b: El) => {
  const [x, y] = [String(a.index ?? ''), String(b.index ?? '')];
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
const finite = (b: Box | undefined): b is Box => b !== undefined && [b.x, b.y, b.w, b.h].every((n) => typeof n === 'number' && Number.isFinite(n));
const isAlgorithm = (v: unknown): v is Algorithm =>
  typeof v === 'object' && v !== null && typeof (v as Algorithm).run === 'function' && typeof (v as Algorithm).parseOptions === 'function';

/** The bounds of `boxes`, or undefined when there are none. */
function bounds(boxes: readonly Box[]): Box | undefined {
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

function report(ctx: Ctx, c: Container, d: Omit<DslDiagnostic, 'source'>): void {
  const source = ctx.sources.get(c.record.id);
  ctx.diagnostics.push({ ...d, ...(source ? { source } : {}) });
}

type Chosen = { readonly algorithm: Algorithm; readonly options: unknown };

/** An algorithm with its default options, or undefined when it refuses them. */
function withDefaults(algorithm: Algorithm): Chosen | undefined {
  const defaults = algorithm.parseOptions(undefined);
  return defaults.ok ? { algorithm, options: defaults.value } : undefined;
}

/** `stack` from the registry with its defaults, else the built-in one (which always accepts its defaults). */
function fallback(ctx: Ctx): Chosen {
  const registered = ctx.registries.layouts.get(stackLayout.id);
  return (isAlgorithm(registered) ? withDefaults(registered) : undefined) ?? (withDefaults(stackLayout as Algorithm) as Chosen);
}

/** A layout type no registry entry has: `stack`, with `FLX_DSL_NOT_YET` for one v1 names, `FLX_REF_MISSING` and a did-you-mean otherwise. */
function unknownType(ctx: Ctx, c: Container, type: string): void {
  const path = `${c.path}/layout/type`;
  if (NOT_YET.has(type)) {
    report(ctx, c, {
      code: 'FLX_DSL_NOT_YET',
      severity: 'warning',
      path,
      message: `layout "${type}" is not compiled yet (it comes in M13); placed with "stack"`,
    });
    return;
  }
  const names = [...new Set([...ctx.registries.layouts.list().map(([key]) => key), stackLayout.id])];
  const near = nearest(type, names);
  report(ctx, c, {
    code: 'FLX_REF_MISSING',
    severity: DIAGNOSTIC_CODES.FLX_REF_MISSING,
    path,
    message: `no layout "${type}" is registered; placed with "stack"`,
    ...(near ? { hint: `did you mean "${near}"?` } : {}),
  });
}

/** The algorithm and options a container is laid out with, reporting what keeps it from its own. */
function layoutFor(ctx: Ctx, c: Container): Chosen {
  const spec = c.record.layout;
  if (!spec) return fallback(ctx);
  const algorithm = ctx.registries.layouts.get(spec.type);
  if (!isAlgorithm(algorithm)) {
    unknownType(ctx, c, spec.type);
    return fallback(ctx);
  }
  const parsed = algorithm.parseOptions(spec.options);
  if (parsed.ok) return { algorithm, options: parsed.value };
  report(ctx, c, {
    code: 'FLX_SCHEMA_INVALID',
    severity: DIAGNOSTIC_CODES.FLX_SCHEMA_INVALID,
    path: `${c.path}/layout`,
    message: `layout "${spec.type}": ${parsed.message}`,
  });
  return withDefaults(algorithm) ?? fallback(ctx);
}

/** Move element `id` to `to`'s position, and everything inside it by as much (members keep screen coordinates). */
function moveTo(ctx: Ctx, id: RecordId, to: Box, keepSize: boolean): void {
  const from = ctx.boxes.get(id);
  if (!from) return;
  ctx.boxes.set(id, keepSize ? { ...from, x: to.x, y: to.y } : to);
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  if (dx === 0 && dy === 0) return;
  const queue = [...(ctx.children.get(id) ?? [])];
  for (let m = queue.shift(); m !== undefined; m = queue.shift()) {
    const b = ctx.boxes.get(m.id);
    if (b) ctx.boxes.set(m.id, { ...b, x: b.x + dx, y: b.y + dy });
    queue.push(...(ctx.children.get(m.id) ?? []));
  }
}

/** Whether `id` is `group` or inside it, at any depth. */
function within(ctx: Ctx, id: RecordId, group: RecordId): boolean {
  for (let at: RecordId | undefined = id; at !== undefined; at = ctx.parents.get(at)) if (at === group) return true;
  return false;
}

/** Record every leaf inside `group` as settled: the group holds a pin, so it and everything in it stay where they are now. */
function settle(ctx: Ctx, c: Container, group: RecordId): void {
  for (const m of ctx.children.get(group) ?? []) {
    if (ctx.children.has(m.id)) settle(ctx, c, m.id);
    else c.screen.settled.set(m.id, ctx.boxes.get(m.id) as Box);
  }
}

/** Settled boxes outside `group`, as pinned obstacles its layout steps past (they are not members: their output is ignored). */
function obstacles(ctx: Ctx, c: Container, group: RecordId, from: number): LayoutNode[] {
  return [...c.screen.settled].filter(([id]) => !within(ctx, id, group)).map(([id, box], k) => ({ id, box, order: from + k, pinned: true }));
}

/**
 * The frames to try for `c`: a screen its own frame; a group without pins the origin (it is moved as a whole afterwards); a group with
 * pins the corner of its pins, then the top of the screen above them, then the screen's corner.
 */
function framesFor(c: Container, pins: readonly Box[]): readonly Box[] {
  const at = bounds(pins);
  const f = c.screen.frame;
  if (c.record.type === 'screen') return [f];
  if (!at) return [{ x: 0, y: 0, w: 0, h: 0 }];
  return [at, { ...at, y: f.y }, f];
}

/** Member `m` of `c` as a layout node: a group is laid out inside first and sized to its members; it is pinned when it holds a pin. */
function nodeOf(ctx: Ctx, c: Container, m: El, order: number): LayoutNode {
  let pinned = m.placement === 'pinned';
  if (m.kind === 'group') {
    pinned = arrange(ctx, { record: m, screen: c.screen, path: `${c.screen.path}/groups/${m.semantic?.slug ?? m.id}` });
    const inner = bounds((ctx.children.get(m.id) ?? []).flatMap((x) => ctx.boxes.get(x.id) ?? []));
    if (inner) ctx.boxes.set(m.id, inner);
    if (pinned) settle(ctx, c, m.id);
  }
  return { id: m.id, box: ctx.boxes.get(m.id) as Box, order, ...(pinned ? { pinned: true } : {}) };
}

const contains = (outer: Box, b: Box) => b.x >= outer.x && b.y >= outer.y && b.x + b.w <= outer.x + outer.w && b.y + b.h <= outer.y + outer.h;

/** The layout's boxes for `nodes`: from the first frame that keeps every loose node on the screen, else from the first frame. */
function run(c: Container, chosen: Chosen, nodes: readonly LayoutNode[], frames: readonly Box[]): LayoutOutput['boxes'] {
  let first: LayoutOutput['boxes'] | undefined;
  for (const frame of frames) {
    const out = chosen.algorithm.run({ nodes, frame }, chosen.options).boxes;
    first ??= out;
    if (frames.length === 1 || nodes.every((n) => n.pinned || !finite(out[n.id]) || contains(c.screen.frame, out[n.id] as Box))) return out;
  }
  return first ?? {};
}

/**
 * Lay out the boxed children of `c` (their interiors first); true when any holds a pin. A group with pins stays where they are, so its
 * loose members are laid out among the screen's settled boxes outside it as well (ADR-0030 review: they must not land on a pin that is
 * not theirs) and, when a frame allows it, on the screen.
 */
function arrange(ctx: Ctx, c: Container): boolean {
  const members = ctx.children.get(c.record.id) ?? [];
  const nodes = members.map((m, order) => nodeOf(ctx, c, m, order));
  const pins = nodes.filter((n) => n.pinned).map((n) => n.box);
  const extra = pins.length > 0 && c.record.type !== 'screen' ? obstacles(ctx, c, c.record.id, nodes.length) : [];
  const out = run(c, layoutFor(ctx, c), [...nodes, ...extra], framesFor(c, pins));
  members.forEach((m, k) => {
    const to = out[m.id];
    // a group keeps the size of its members' bounds: only its position is the layout's
    if (!nodes[k]?.pinned && finite(to)) moveTo(ctx, m.id, to, ctx.children.has(m.id));
  });
  return pins.length > 0;
}

/** Boxed elements (connectors have no box) grouped by container (their group, else their screen), each list in model order. */
function childrenOf(records: { readonly [id: string]: AnyRecord }): Map<string, El[]> {
  const out = new Map<string, El[]>();
  for (const r of Object.values(records) as El[]) {
    if (r.type !== 'element' || !finite(r.transform)) continue;
    const key = String(r.parentId ?? r.screenId);
    out.set(key, [...(out.get(key) ?? []), r]);
  }
  for (const list of out.values()) list.sort(byIndex);
  return out;
}

/**
 * Place compiled records (the place stage, ADR-0030): pinned elements keep their boxes; the rest are laid out by their screen's or
 * group's `layout` from the `layouts` registry, else `stack`. A layout type v1 names but R2 does not register (`layered`) is placed with
 * `stack` and `FLX_DSL_NOT_YET`; any other unknown type with `stack` and `FLX_REF_MISSING`. A group's box is the bounds of its members.
 *
 * @public
 */
export function placeFlux(input: PlaceInput, options: PlaceOptions): PlaceResult {
  const children = childrenOf(input.records);
  const boxes = new Map<RecordId, Box>();
  for (const list of children.values()) for (const r of list) boxes.set(r.id, r.transform as Box);
  const parents = new Map<RecordId, RecordId>();
  for (const list of children.values()) for (const r of list) if (r.parentId !== undefined) parents.set(r.id, r.parentId);
  const ctx: Ctx = { registries: options.registries, sources: input.layoutSources ?? new Map(), diagnostics: [], children, boxes, parents };
  const screens = (Object.values(input.records) as El[]).filter((r) => r.type === 'screen').sort(byIndex);
  screens.forEach((s, i) => {
    const size = screenSize(s as Parameters<typeof screenSize>[0]);
    const path = `/screens/${i}`;
    // the screen's pinned leaves (a group's stored box says nothing until it is sized by its members)
    const pins = [...children.values()].flat().filter((r) => r.screenId === s.id && r.placement === 'pinned' && !children.has(r.id));
    const settled = new Map(pins.map((r) => [r.id, r.transform as Box] as const));
    arrange(ctx, { record: s, path, screen: { path, frame: { x: 0, y: 0, w: size.w, h: size.h }, settled } });
  });
  const records: { [id: string]: AnyRecord } = { ...input.records };
  for (const [id, box] of boxes) {
    const r = input.records[id] as El;
    records[id] = { ...r, transform: { ...r.transform, ...box } } as AnyRecord;
  }
  return { records, diagnostics: ctx.diagnostics };
}

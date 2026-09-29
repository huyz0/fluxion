// evaluateOutline (ADR-0016 items 2, 5, 6): a shape definition's outline and decorations for one
// element size and params, as geometry's cubic path. One step budget covers every expression; caps
// on polygon vertices, template segments and points make larger work a diagnostic.
import { arcToCubics, type Path, type PathCommand, pathFromCommands, type Vec2 } from '@fluxion/geometry';
import { type Diagnostic, err, jsonPointer, ok, type Result, type Size } from '@fluxion/schema';
import { type ExprBudget, type ExprScope, evaluateExpr, parseExpr } from '../expr/expr.js';
import { type EnumParam, MAX_POINTS, type NumberParam, type OutlineSpec, type PointsParam, type ShapeDef } from './shape-def.js';
import { MAX_SEGMENTS, parseTemplate, type TemplateArg, type TemplateCommand, TemplateFailure, type TemplateLetter } from './template.js';

/**
 * A shape's evaluated outline: the geometry commands, the normalized path (lines as cubics, closed
 * or open) and the stroke-only decoration paths.
 *
 * @public
 */
export type EvaluatedOutline = {
  /** Absolute commands of the outline (arcs already cubics). */
  readonly commands: readonly PathCommand[];
  /** The outline, one subpath of cubics. */
  readonly path: Path;
  /** Decoration paths, in definition order. */
  readonly decorations: readonly Path[];
};

/**
 * Steps one `evaluateOutline` call may spend on expressions unless the caller passes a budget.
 *
 * @public
 */
export const DEFAULT_OUTLINE_BUDGET = 100_000;
/** Most vertices of a polygon outline (ADR-0016 item 6). */
const MAX_POLYGON = 1024;

type At = ReadonlyArray<string | number>;
type Ctx = { readonly scope: ExprScope; readonly budget: ExprBudget };
type Pair = readonly [number, number];

const fail = (code: Diagnostic['code'], at: At, message: string) => new TemplateFailure({ code, severity: 'error', path: jsonPointer(at), message });
const clamp = (v: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) => Math.min(Math.max(v, min), max);

function numberValue(spec: NumberParam, v: unknown): number {
  const raw = typeof v === 'number' && Number.isFinite(v) ? v : spec.default;
  return clamp(spec.type === 'int' ? Math.round(raw) : raw, spec.min, spec.max);
}

function enumValue(spec: EnumParam, v: unknown): number {
  const i = typeof v === 'string' ? spec.values.indexOf(v) : -1;
  return i >= 0 ? i : spec.values.indexOf(spec.default);
}

const isPair = (p: unknown): p is Pair => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isFinite(n));

/** An element's vertex list clamped into the box, its default when malformed or outside the spec's count. */
function pointsValue(spec: PointsParam, v: unknown, at: At): readonly Pair[] {
  if (!Array.isArray(v)) return spec.default;
  if (v.length > MAX_POINTS) throw fail('FLX_SHAPE_LIMIT', at, `${v.length} points; at most ${MAX_POINTS}`);
  if (!v.every(isPair) || v.length < (spec.min ?? 2) || v.length > (spec.max ?? MAX_POINTS)) return spec.default;
  return v.map(([x, y]) => [clamp(x, 0, 1), clamp(y, 0, 1)] as const);
}

/** The element's own value of `name` (own keys only), else undefined. */
const own = (params: { readonly [key: string]: unknown }, name: string): unknown => (Object.hasOwn(params, name) ? params[name] : undefined);

/** The scope of the expressions: the size, `pi`, and every number, int and enum param. */
function scopeOf(def: ShapeDef, size: Size, params: { readonly [key: string]: unknown }): ExprScope {
  const scope: { [name: string]: number } = { w: size.w, h: size.h, pi: Math.PI };
  for (const [name, spec] of Object.entries(def.params ?? {})) {
    if (spec.type === 'enum') scope[name] = enumValue(spec, own(params, name));
    else if (spec.type !== 'points') scope[name] = numberValue(spec, own(params, name));
  }
  return scope;
}

function value(arg: TemplateArg, ctx: Ctx, at: At): number {
  const r = evaluateExpr(arg.expr, ctx.scope, ctx.budget, { at, src: arg.src });
  if (!r.ok) throw new TemplateFailure(r.error);
  return r.value;
}

function parsed(src: string, at: At): TemplateArg {
  const r = parseExpr(src, at);
  if (!r.ok) throw new TemplateFailure(r.error);
  return { expr: r.value, src };
}

type Pen = { current: Vec2 };
const pt = (x: number, y: number): Vec2 => ({ x, y });

/** Each letter's commands from its evaluated numbers and the pen. */
const STEP: { readonly [L in TemplateLetter]: (v: readonly number[], pen: Pen) => PathCommand[] } = {
  M: (v) => [{ kind: 'M', to: pt(v[0] as number, v[1] as number) }],
  L: (v) => [{ kind: 'L', to: pt(v[0] as number, v[1] as number) }],
  H: (v, pen) => [{ kind: 'L', to: pt(v[0] as number, pen.current.y) }],
  V: (v, pen) => [{ kind: 'L', to: pt(pen.current.x, v[0] as number) }],
  C: (v) => [{ kind: 'C', control1: pt(v[0] as number, v[1] as number), control2: pt(v[2] as number, v[3] as number), to: pt(v[4] as number, v[5] as number) }],
  Q: (v) => [{ kind: 'Q', control: pt(v[0] as number, v[1] as number), to: pt(v[2] as number, v[3] as number) }],
  A: (v, pen) =>
    arcToCubics(pen.current, {
      rx: v[0] as number,
      ry: v[1] as number,
      rotation: v[2] as number,
      largeArc: v[3] !== 0,
      sweep: v[4] !== 0,
      to: pt(v[5] as number, v[6] as number),
    }).map((s) => ({ kind: 'C', control1: s.p1, control2: s.p2, to: s.p3 })),
  Z: () => [{ kind: 'Z' }],
};

/** The pen after `made`: its last end point (an arc between equal points draws nothing; nothing follows Z). */
function moveTo(pen: Pen, made: readonly PathCommand[]): void {
  const last = made.at(-1);
  if (last !== undefined && 'to' in last) pen.current = last.to;
}

/** The geometry commands of a parsed template. */
function run(cmds: readonly TemplateCommand[], ctx: Ctx, at: At): PathCommand[] {
  const out: PathCommand[] = [];
  const pen: Pen = { current: pt(0, 0) };
  for (const c of cmds) {
    const made = STEP[c.letter](
      c.args.map((a) => value(a, ctx, at)),
      pen,
    );
    out.push(...made);
    moveTo(pen, made);
  }
  if (out.length - 1 > MAX_SEGMENTS) throw fail('FLX_SHAPE_LIMIT', at, `the template expands to ${out.length - 1} segments; at most ${MAX_SEGMENTS}`);
  return out;
}

const finitePoint = (p: Vec2): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * The path of commands a template, polygon or points list made (one M first, nothing after Z). Finite
 * numbers can still overflow once combined (a control point between -1e308 and 1e308): a diagnostic.
 */
function toPath(cmds: readonly PathCommand[], at: At): Path {
  const r = pathFromCommands(cmds);
  if (r.ok && r.value.segments.every((s) => [s.p1, s.p2, s.p3].every(finitePoint))) return r.value;
  throw fail('FLX_SHAPE_LIMIT', at, 'a coordinate overflows the number range; keep the numbers of the outline smaller');
}

/** A closed polygon: `n` vertices at `(x, y)` for `i = 0 … n-1`. */
function polygon(spec: { readonly n: string; readonly x: string; readonly y: string }, ctx: Ctx, at: At): PathCommand[] {
  const n = value(parsed(spec.n, [...at, 'n']), ctx, [...at, 'n']);
  if (!Number.isInteger(n) || n < 2 || n > MAX_POLYGON)
    throw fail('FLX_SHAPE_LIMIT', [...at, 'n'], `n is ${n}; it must be an integer from 2 to ${MAX_POLYGON}`);
  const [x, y] = [parsed(spec.x, [...at, 'x']), parsed(spec.y, [...at, 'y'])];
  const vertices = Array.from({ length: n }, (_, i) => {
    const vertex = { scope: { ...ctx.scope, i, n }, budget: ctx.budget };
    return pt(value(x, vertex, [...at, 'x']), value(y, vertex, [...at, 'y']));
  });
  return [...vertices.map((to, i): PathCommand => ({ kind: i === 0 ? 'M' : 'L', to })), { kind: 'Z' }];
}

/**
 * A uniform Catmull-Rom curve through `p` as cubics (ends repeat, a closed curve wraps). Control points
 * are clamped to the `size` box: the vertices are in it, so the curve, inside its control points' hull,
 * stays in it too, where a stroke turning at an edge would otherwise overshoot (M5.11 review F1).
 */
function catmullRom(p: readonly Vec2[], closed: boolean, size: Size): PathCommand[] {
  const inBox = (x: number, y: number) => pt(clamp(x, 0, size.w), clamp(y, 0, size.h));
  const m = p.length;
  const at = (k: number) => (closed ? p[(k + m) % m] : p[clamp(k, 0, m - 1)]) as Vec2;
  const segments = Array.from({ length: closed ? m : m - 1 }, (_, k): PathCommand => {
    const [prev, a, b, next] = [at(k - 1), at(k), at(k + 1), at(k + 2)];
    return {
      kind: 'C',
      control1: inBox(a.x + (b.x - prev.x) / 6, a.y + (b.y - prev.y) / 6),
      control2: inBox(b.x - (next.x - a.x) / 6, b.y - (next.y - a.y) / 6),
      to: b,
    };
  });
  return [{ kind: 'M', to: at(0) }, ...segments];
}

/** The vertices of a points param, scaled to the box; straight or smooth, open or closed. */
function points(
  spec: Extract<OutlineSpec, { points: string }>,
  def: ShapeDef,
  input: { size: Size; params: { readonly [key: string]: unknown } },
): PathCommand[] {
  const param = def.params?.[spec.points] as PointsParam;
  const vertices = pointsValue(param, own(input.params, spec.points), ['params', spec.points]).map(([x, y]) => pt(x * input.size.w, y * input.size.h));
  const open =
    spec.smooth === true ? catmullRom(vertices, spec.closed === true, input.size) : vertices.map((to, i): PathCommand => ({ kind: i === 0 ? 'M' : 'L', to }));
  return spec.closed === true ? [...open, { kind: 'Z' }] : open;
}

function outlineCommands(def: ShapeDef, ctx: Ctx, input: { size: Size; params: { readonly [key: string]: unknown } }): PathCommand[] {
  const o = def.outline;
  if ('path' in o) return run(parseTemplate(o.path, ['outline', 'path']), ctx, ['outline', 'path']);
  if ('polygon' in o) return polygon(o.polygon, ctx, ['outline', 'polygon']);
  return points(o, def, input);
}

/**
 * Evaluate the outline and decorations of `def` (a valid definition: see `parseShapeDef`) for an element of `size` with `params` (clamped into
 * their ranges; missing or invalid ones use their defaults). Every expression spends `budget`
 * (default {@link DEFAULT_OUTLINE_BUDGET} steps). Never throws: an expression, template or cap problem
 * is a diagnostic whose path points into the definition.
 *
 * @public
 */
export function evaluateOutline(
  def: ShapeDef,
  size: Size,
  params: { readonly [key: string]: unknown } = {},
  budget: ExprBudget = { steps: DEFAULT_OUTLINE_BUDGET },
): Result<EvaluatedOutline, Diagnostic> {
  try {
    const ctx = { scope: scopeOf(def, size, params), budget };
    const commands = outlineCommands(def, ctx, { size, params });
    const decorations = (def.decorations ?? []).map((d, k) => {
      const at = ['decorations', k, 'path'];
      return toPath(run(parseTemplate(d.path, at), ctx, at), at);
    });
    return ok({ commands, path: toPath(commands, ['outline']), decorations });
  } catch (e) {
    if (e instanceof TemplateFailure) return err(e.diagnostic);
    throw e;
  }
}

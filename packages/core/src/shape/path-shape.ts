// The path shape (ADR-0053, FR-SHP-010, FR-SHP-011): `core:path` draws the `path` its element owns, `d` in a `w × h` reference box
// scaled to the element's box, under `fillRule`. Its definition is the box (so anything that knows only definitions still sees a
// rectangle with side anchors); what reads the element too (render, routing) takes the owned outline from `ownPath`. Pure.
import { type Path, type PathCommand, parsePathData, pathBounds, pathFromCommands, type Vec2 } from '@fluxion/geometry';
import type { PathData } from '@fluxion/schema';
import type { ShapeDef } from './shape-def.js';

/**
 * The id of the path shape.
 *
 * @public
 */
export const CORE_PATH_ID = 'core:path';

/**
 * The path shape's definition: its box, as `basic:rect`, for whatever reads only definitions; its drawn outline is the element's own.
 *
 * @public
 */
export const CORE_PATH_DEF: ShapeDef = {
  id: CORE_PATH_ID,
  outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' },
  defaultSize: { w: 100, h: 100 },
  describe: 'A path shape: the outline a boolean operation or the path tool made, owned by the element.',
  keywords: ['path', 'vector', 'boolean'],
};

/**
 * The shapes core defines itself, which every host's registries hold and no pack carries or saves.
 *
 * @public
 */
export const CORE_SHAPE_DEFS: readonly ShapeDef[] = [CORE_PATH_DEF];

/**
 * The ids of {@link CORE_SHAPE_DEFS}: built in wherever a saved file's shapes are resolved.
 *
 * @public
 */
export const CORE_SHAPE_IDS: ReadonlySet<string> = new Set(CORE_SHAPE_DEFS.map((def) => def.id));

/**
 * An owned outline placed in its element's box.
 *
 * @public
 */
export type OwnPath = {
  /** Every subpath's commands, in order, in the element's box. */
  readonly commands: readonly PathCommand[];
  /** Each subpath as a path. */
  readonly paths: readonly Path[];
  /** The subpath whose bounds are largest: the perimeter anchors and connectors meet. */
  readonly outline: Path;
  /** How the subpaths fill together. */
  readonly fillRule: 'nonzero' | 'evenodd';
};

/** `p` scaled by `sx` across and `sy` down. */
const scaled = (p: Vec2, sx: number, sy: number): Vec2 => ({ x: p.x * sx, y: p.y * sy });

/** The command `c` scaled by `sx`, `sy`: every point it holds, whatever its letter. */
function scaleCommand(c: PathCommand, sx: number, sy: number): PathCommand {
  const out: Record<string, unknown> = { ...c };
  for (const key of ['to', 'control', 'control1', 'control2'] as const) {
    const p = (c as Partial<Record<typeof key, Vec2>>)[key];
    if (p !== undefined) out[key] = scaled(p, sx, sy);
  }
  return out as PathCommand;
}

const area = (p: Path): number => {
  const b = pathBounds(p);
  return b === null ? 0 : b.w * b.h;
};

/** Owned outlines by path record and size: a drag redraws and reroutes the same path many times. */
const cache = new WeakMap<PathData, Map<string, OwnPath | undefined>>();
const PER_PATH = 32;

/**
 * The outline `path` draws in a box of `size`, or undefined when its data does not read (a reference box of no area, a letter
 * other than M L Q C Z, a subpath that does not make a path).
 *
 * @public
 */
export function ownPath(path: PathData, size: { readonly w: number; readonly h: number }): OwnPath | undefined {
  const kept = cache.get(path) ?? new Map<string, OwnPath | undefined>();
  cache.set(path, kept);
  const key = `${size.w}x${size.h}`;
  if (kept.has(key)) return kept.get(key);
  const own = evaluate(path, size);
  if (kept.size >= PER_PATH) kept.clear();
  kept.set(key, own);
  return own;
}

function evaluate(path: PathData, size: { readonly w: number; readonly h: number }): OwnPath | undefined {
  if (!(path.w > 0 && path.h > 0)) return undefined;
  const read = parsePathData(path.d);
  if (!read.ok) return undefined;
  const [sx, sy] = [size.w / path.w, size.h / path.h];
  const subpaths = read.value.map((s) => s.map((c) => scaleCommand(c, sx, sy)));
  const paths: Path[] = [];
  for (const s of subpaths) {
    const p = pathFromCommands(s);
    if (!p.ok) return undefined;
    paths.push(p.value);
  }
  const outline = paths.reduce((best, p) => (area(p) > area(best) ? p : best));
  return { commands: subpaths.flat(), paths, outline, fillRule: path.fillRule ?? 'nonzero' };
}

/**
 * The owned outline of an element of definition `defId` holding `path`, at `size`: only a `core:path` shape draws its `path`
 * (ADR-0054: on another definition it is ignored, and the editor reports it).
 *
 * @public
 */
export function ownPathOf(
  element: { readonly defId: string; readonly path?: PathData | undefined },
  size: { readonly w: number; readonly h: number },
): OwnPath | undefined {
  return element.defId === CORE_PATH_ID && element.path !== undefined ? ownPath(element.path, size) : undefined;
}

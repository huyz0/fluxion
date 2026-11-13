// A shape's resolved style and evaluated outline (FR-SHP-001, 02 §2). A big screen draws many shapes of one definition at one
// size, so the view evaluates each outline once per definition, size and params, and shapes with no style of their own share
// the style resolved for their definition and theme (M18.288, NFR-PERF-002). Results are only read.

import { evaluateOutline, type ShapeDef } from '@fluxion/core';
import type { ShapeElement } from '@fluxion/schema';
import { resolveStyle, type Theme } from '@fluxion/theme';

/** Outlines evaluated for a definition, by size and params: a big screen draws many shapes of one definition at one size (M18.288). */
const outlines = new WeakMap<ShapeDef, Map<string, ReturnType<typeof evaluateOutline>>>();

/** Most outlines kept per definition: a resize walks through many sizes, which would otherwise pile up. */
const OUTLINES_PER_DEF = 64;

/** The outline of `def` at `size` with `params`, evaluated once per distinct size and params; the result is only read. */
export function outlineOf(def: ShapeDef, size: { readonly w: number; readonly h: number }, params: ShapeElement['params']): ReturnType<typeof evaluateOutline> {
  const kept = outlines.get(def) ?? new Map<string, ReturnType<typeof evaluateOutline>>();
  outlines.set(def, kept);
  const key = `${size.w}x${size.h}:${JSON.stringify(params ?? {})}`;
  const found = kept.get(key);
  if (found !== undefined) return found;
  const evaluated = evaluateOutline(def, size, params);
  if (kept.size >= OUTLINES_PER_DEF) kept.clear();
  kept.set(key, evaluated);
  return evaluated;
}

/** The styles of shapes with no style of their own, by definition and theme: they resolve the same for every such shape (M18.288). */
const unstyled = new WeakMap<Theme, WeakMap<ShapeDef, ReturnType<typeof resolveStyle>['style']>>();

/** The resolved style a view draws with: shapeStyle's, shared by every shape of `def` without a style of its own. */
export function viewStyle(element: ShapeElement, def: ShapeDef | undefined, theme: Theme): ReturnType<typeof resolveStyle>['style'] {
  if (element.style !== undefined || def === undefined) return shapeStyle(element, def, theme).style;
  const byDef = unstyled.get(theme) ?? new WeakMap<ShapeDef, ReturnType<typeof resolveStyle>['style']>();
  unstyled.set(theme, byDef);
  const found = byDef.get(def);
  if (found !== undefined) return found;
  const { style } = shapeStyle(element, def, theme);
  byDef.set(def, style);
  return style;
}

/** The style of a shape: the definition's defaults sit under the element's own (02 §2). */
export function shapeStyle(element: ShapeElement, def: ShapeDef | undefined, theme: Theme): ReturnType<typeof resolveStyle> {
  const defaults = def?.defaultStyle;
  const of = defaults === undefined ? 'shape' : { kind: 'shape', defaults, defaultsAt: ['shapeDefs', element.defId, 'defaultStyle'] };
  return resolveStyle(element.style, of, theme, ['records', element.id, 'style']);
}

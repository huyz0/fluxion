// What a shape view draws (ADR-0053): its outline, a `core:path` shape's own path under its fill rule, and its stroke's SVG
// presentation. Split from shape-view.tsx.
import { ownPathOf, type ShapeDef } from '@fluxion/core';
import type { ShapeElement } from '@fluxion/schema';
import { type CSSProperties, useMemo } from 'react';
import { outlineOf, type viewStyle } from './shape-style.js';

/** A shape's evaluated outline, with the fill rule a path shape's own outline carries (ADR-0053). */
export type Outlined = ReturnType<typeof outlineOf> & { readonly fillRule?: 'nonzero' | 'evenodd' };

/**
 * The outline `element` draws: a `core:path` shape's own `path` scaled to its box (every subpath, under its fill rule), else its
 * definition's outline; undefined without a definition.
 */
export function useOutline(def: ShapeDef | undefined, element: ShapeElement, size: { readonly w: number; readonly h: number }): Outlined | undefined {
  const { w, h } = size;
  const { defId, params, path } = element;
  return useMemo((): Outlined | undefined => {
    if (def === undefined) return undefined;
    const own = ownPathOf({ defId, path }, { w, h });
    if (own === undefined) return outlineOf(def, { w, h }, params);
    return { ok: true, value: { commands: own.commands, path: own.outline, decorations: [] }, fillRule: own.fillRule };
  }, [def, w, h, params, defId, path]);
}

/** The SVG presentation of the resolved stroke `s`. */
export function strokeCss(s: ReturnType<typeof viewStyle>['stroke']): CSSProperties {
  return {
    stroke: s.color,
    strokeWidth: s.width,
    strokeLinecap: s.cap as CSSProperties['strokeLinecap'],
    strokeLinejoin: s.join as CSSProperties['strokeLinejoin'],
    ...(s.dash === undefined ? {} : { strokeDasharray: s.dash }),
  };
}

// The literal colors of an imported batch (M18.175): what the dialog offers to map to theme tokens. Exactly the keys the renderer
// looks up (`artwork-view.tsx`): a fill, stroke or stop-color attribute as written, a style declaration's value trimmed; CSS colors
// only, never `none`, `currentColor` or `url(…)`. At most 64 are offered; the rest are counted, never dropped silently.
import type { ShapeDef } from '@fluxion/core';
import { isCssColor, type SvgArtworkNode } from '@fluxion/schema';

const PAINT = new Set(['fill', 'stroke', 'stop-color']);
/** The most colors offered for mapping. @public */
export const MAX_BATCH_COLORS = 64;

/** The colors of a batch: the offered ones in code-unit order, and how many more there were. @public */
export type SvgBatchColors = {
  /** At most {@link MAX_BATCH_COLORS} distinct literal colors, exactly as the renderer keys them. */
  readonly colors: readonly string[];
  /** Distinct colors past the cap, not offered. */
  readonly colorsOmitted: number;
};

const offered = (value: string): boolean => isCssColor(value) && value.toLowerCase() !== 'currentcolor';

/** The paint literals of a style attribute: each paint declaration's value, trimmed. */
const styleLiterals = (style: string): string[] =>
  style.split(';').flatMap((declaration) => {
    const colon = declaration.indexOf(':');
    return colon >= 0 && PAINT.has(declaration.slice(0, colon).trim()) ? [declaration.slice(colon + 1).trim()] : [];
  });

/** The paint literals of one attribute: a paint attribute's value as written, or a style's paint declarations. */
const literalsOf = (name: string, value: string): string[] => (name === 'style' ? styleLiterals(value) : PAINT.has(name) ? [value] : []);

/** Adds the offered paint values of `node` and its descendants to `found`. */
function collect(node: SvgArtworkNode, found: Set<string>): void {
  const literals = Object.entries(node.attributes).flatMap(([name, value]) => literalsOf(name, value));
  for (const literal of literals.filter(offered)) found.add(literal);
  for (const child of node.children) if (typeof child !== 'string') collect(child, found);
}

/** The literal colors the artwork of `definitions` paints with. @public */
export function svgBatchColors(definitions: readonly ShapeDef[]): SvgBatchColors {
  const found = new Set<string>();
  for (const def of definitions) if (def.artwork) collect(def.artwork.root, found);
  const sorted = [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { colors: sorted.slice(0, MAX_BATCH_COLORS), colorsOmitted: Math.max(0, sorted.length - MAX_BATCH_COLORS) };
}

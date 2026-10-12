// A completion catalog for the tests: the basic pack's shape ids as `packs/basic` registers them (the editor may not import a pack, ADR-0017's
// layering), one shape of another pack, tokens, and slugs.
import type { CompletionCatalog } from './completion.js';

/** A qualified shape id. */
export type ShapeId = `${string}:${string}`;
export const BASIC_IDS: ShapeId[] = [
  'basic:block-arrow', 'basic:callout', 'basic:cloud', 'basic:cylinder', 'basic:diamond', 'basic:document', 'basic:ellipse', 'basic:freehand', 'basic:hexagon',
  'basic:image-frame', 'basic:line', 'basic:note', 'basic:octagon', 'basic:parallelogram', 'basic:polyline', 'basic:rect', 'basic:rounded-rect', 'basic:star',
  'basic:text-box', 'basic:trapezoid', 'basic:triangle',
]; // biome-ignore format: a list

export const catalog = (over: Partial<CompletionCatalog> = {}): CompletionCatalog => ({
  shapes: () => [...BASIC_IDS, 'flowchart:decision'],
  tokens: () => ['color.brand.primary', 'color.text.primary', 'color.text.muted', 'space.4'],
  slugs: () => ['api', 'db', 'cache'],
  packs: () => ['basic', 'flowchart'],
  ...over,
});

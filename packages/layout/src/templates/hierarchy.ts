// The org chart template (FR-LAY-014, ADR-0047): the items and their children as a tree, top down, each parent centred over its children and
// joined to each of them. Every box takes one size that fits the longest label, shrunk (never below the minimum) for the widest level to fit
// the frame; leaves sit side by side in item order. Colours go by level, so a scheme that cycles gives each level its own.
import { z } from 'zod';
import { colorsSchema, commonSize, connectorStyle, detailOf, halfBox, inset, itemsSchema, MIN_SIZE, shapeStyle } from './slot-sizing.js';
import type { TemplateConnectorDraft, TemplateContext, TemplateDef, TemplateItem, TemplateResult, TemplateShapeDraft } from './types.js';

/**
 * Options of `hierarchy.org`.
 *
 * @public
 */
export type OrgOptions = {
  /** Space between neighbouring boxes on a level, px (default 24). */
  readonly gap: number;
  /** Space between levels, px (default 56). */
  readonly levelGap: number;
  /** Space between the frame's edge and the chart, px (default 40). */
  readonly padding: number;
  /** The colour scheme (default `colorful`). */
  readonly colors: 'colorful' | 'primary' | 'outline';
};

/** At most this many top-level items (a forest of org charts side by side). */
const MAX_ROOTS = 8;

const schema = z
  .strictObject({
    gap: z.number().finite().min(0).default(24),
    levelGap: z.number().finite().min(0).default(56),
    padding: z.number().finite().min(0).default(40),
    colors: colorsSchema.default('colorful'),
  })
  .default({ gap: 24, levelGap: 56, padding: 40, colors: 'colorful' });

/** A placed item: its depth-first index, its level, its parent's index and its column (a leaf's is whole, a parent's the middle of its children's). */
type Placed = { readonly item: TemplateItem; readonly index: number; readonly depth: number; readonly parent?: number; column: number };

/** Every item depth first, leaves numbered left to right and each parent centred over its first and last child. */
function place(roots: readonly TemplateItem[]): Placed[] {
  const placed: Placed[] = [];
  let leaves = 0;
  const visit = (item: TemplateItem, depth: number, parent: number | undefined): number => {
    const node: Placed = { item, index: placed.length, depth, ...(parent === undefined ? {} : { parent }), column: 0 };
    placed.push(node);
    const columns = (item.children ?? []).map((child) => visit(child, depth + 1, node.index));
    node.column = columns.length === 0 ? leaves++ : ((columns[0] as number) + (columns.at(-1) as number)) / 2;
    return node.column;
  };
  for (const root of roots) visit(root, 0, undefined);
  return placed;
}

function build(items: readonly TemplateItem[], o: OrgOptions, ctx: TemplateContext): TemplateResult {
  const area = inset(ctx.frame, o.padding);
  const placed = place(items);
  const columns = placed.reduce((most, p) => Math.max(most, p.column), 0) + 1;
  const levels = placed.reduce((most, p) => Math.max(most, p.depth), 0) + 1;
  const need = commonSize(
    placed.map((p) => p.item),
    ctx,
  );
  const w = Math.max(MIN_SIZE.w, Math.min(need.w, (area.w - o.gap * (columns - 1)) / columns));
  const h = Math.max(MIN_SIZE.h, Math.min(need.h, (area.h - o.levelGap * (levels - 1)) / levels));
  const origin = {
    x: area.x + (area.w - (w * columns + o.gap * (columns - 1))) / 2,
    y: area.y + (area.h - (h * levels + o.levelGap * (levels - 1))) / 2,
  };
  const shapes: TemplateShapeDraft[] = placed.map((p) => {
    const slot = p.depth === 0 ? 'root' : 'node';
    return {
      key: `node-${p.index}`,
      slot,
      index: p.index,
      shape: 'basic:rounded-rect',
      box: halfBox({ x: origin.x + p.column * (w + o.gap), y: origin.y + p.depth * (h + o.levelGap), w, h }),
      label: p.item.label,
      ...detailOf(p.item),
      style: shapeStyle(slot, p.depth, o.colors),
    };
  });
  const connectors: TemplateConnectorDraft[] = placed.flatMap((p) =>
    p.parent === undefined ? [] : [{ key: `link-${p.index}`, slot: 'link', from: `node-${p.parent}`, to: `node-${p.index}`, style: connectorStyle('link') }],
  );
  return { shapes, connectors };
}

/**
 * `hierarchy.org`: an org chart, the items' children below them.
 *
 * @public
 */
export const hierarchyOrgTemplate: TemplateDef<OrgOptions> = {
  id: 'hierarchy.org',
  describe: 'An org chart or tree: each item above its children, joined to each of them.',
  version: '1',
  items: itemsSchema(1, MAX_ROOTS),
  schema,
  slots: {
    root: { shape: 'basic:rounded-rect', role: 'root' },
    node: { shape: 'basic:rounded-rect', role: 'node' },
    link: { shape: 'connector', role: 'link' },
  },
  build,
};

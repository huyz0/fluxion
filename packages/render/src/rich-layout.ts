// Rich text as the layout sees it (FR-TXT-002, M7.29): the document's blocks as core's StyledBlocks, so a
// fit and a hit box measure the text RichText draws, not a flat string. The numbers are the same ones the
// planners (rich-marks.ts, rich-blocks.ts) and the content CSS use: a heading's size, a list's indent,
// inline code's size, a block's own line height and spacing, and a mark's weight, style, size and family.
import type { StyledBlock, StyledRun } from '@fluxion/core';
import { MAX_RICH_TEXT_DEPTH, type RichTextDoc, type RichTextNode } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';
import { concreteLength, substitute } from './css-values.js';
import { fieldText, inlineNodes } from './label.js';
import { type BlockPlan, blockAlign, blockSpacing, CODE_EM, HEADING_EM, HEADINGS, LIST_INDENT_EM, planBlock } from './rich-blocks.js';
import { type MarkPlan, planMarks } from './rich-marks.js';

/** What a mark's element does to the run inside it. */
type Effect = (run: StyledRun, plan: MarkPlan, theme: Theme) => StyledRun;

/** A span's size and family marks, in `theme`'s values. */
const spanEffect: Effect = (run, plan, theme) => {
  // tzap disable next-line StringLiteral: text that is no length is no size, as an empty one is
  const px = concreteLength(plan.style?.['fontSize'] ?? '', theme);
  const family = substitute(plan.style?.['fontFamily'] ?? '', theme);
  // a token the theme does not have resolves to nothing, and a run is then drawn in the font around it
  return { ...run, ...(px > 0 ? { size: px } : {}), ...(family === '' ? {} : { family }) };
};

/** The effect of each mark element on the font; the others (links, colour, underline) change none. */
const EFFECTS: { readonly [tag: string]: Effect } = {
  strong: (run) => ({ ...run, weight: 700 }),
  em: (run) => ({ ...run, style: 'italic' }),
  code: (run) => ({ ...run, em: CODE_EM, family: 'ui-monospace, monospace' }),
  span: spanEffect,
};

/** The run an inline node draws as, in `theme`'s values. */
function runOf(node: RichTextNode, theme: Theme): StyledRun {
  if (node.type === 'hardBreak') return { text: '\n' };
  const text = node.type === 'field' ? fieldText(node) : (node.text ?? '');
  return planMarks(node.marks).reduce<StyledRun>((run, plan) => EFFECTS[plan.tag]?.(run, plan, theme) ?? run, { text });
}

/** The block of a text node: its runs, its heading's scale, its own spacing and alignment, and its list's indent. */
function blockOf(node: RichTextNode, plan: BlockPlan | undefined, lists: number, theme: Theme): StyledBlock {
  const level = plan === undefined ? -1 : (HEADINGS as readonly string[]).indexOf(plan.tag);
  // an unknown block's attributes are never read
  const align = plan === undefined ? undefined : blockAlign(node.attrs ?? {});
  return {
    runs: inlineNodes(node).map((n) => runOf(n, theme)),
    ...(level < 0 ? {} : { scale: HEADING_EM[level], weight: 700 }),
    ...(plan === undefined ? {} : blockSpacing(node.attrs ?? {})),
    ...(lists === 0 ? {} : { indentEm: lists * LIST_INDENT_EM }),
    ...(align === undefined ? {} : { align }),
  };
}

/**
 * A list item's marker: a bullet or the item's number, at its list's nesting level (1 for a top-level list).
 *
 * @public
 */
export type ListMarker = { readonly ordered: boolean; readonly n: number; readonly level: number };

/**
 * What a block draws beside its fonts: the marks of each of its runs, outermost first (as RichText nests them), and the marker of
 * the list item it starts.
 *
 * @public
 */
export type BlockPaint = { readonly runs: readonly (readonly MarkPlan[])[]; readonly marker?: ListMarker };

/** How deep a node is: in lists (for the indent) and in nodes (for the depth limit); `marker` waits for an item's first block. */
type Level = { readonly lists: number; readonly depth: number; readonly marker?: ListMarker | undefined };

/** A block with what it draws beside its fonts. */
type Rich = { readonly block: StyledBlock; readonly paint: BlockPaint };

/** The items of a list: each item's blocks, its marker on the first. */
function listItems(list: RichTextNode, plan: BlockPlan, level: Level, theme: Theme): Rich[] {
  const inside = { lists: level.lists + 1, depth: level.depth + 1 };
  const first = plan.start ?? 1;
  return (list.content ?? []).flatMap((item, k) => {
    const marker = { ordered: plan.tag === 'ol', n: first + k, level: inside.lists };
    return walk([item], { ...inside, marker }, theme);
  });
}

/** The blocks under `nodes`: a list nests one level more, an item stays at its list's level. */
function walk(nodes: readonly RichTextNode[], level: Level, theme: Theme): Rich[] {
  let marker = level.marker;
  return nodes.flatMap((node) => {
    const plan = level.depth > MAX_RICH_TEXT_DEPTH ? undefined : planBlock(node);
    const inside = { lists: level.lists, depth: level.depth + 1 };
    if (plan?.tag === 'ul' || plan?.tag === 'ol') {
      marker = undefined;
      return listItems(node, plan, level, theme);
    }
    if (plan?.tag === 'li') return walk(node.content ?? [], { ...inside, lists: level.lists, marker: level.marker }, theme);
    const runs = inlineNodes(node).map((n) => (n.type === 'hardBreak' ? [] : planMarks(n.marks)));
    const paint = marker === undefined ? { runs } : { runs, marker };
    marker = undefined;
    return [{ block: blockOf(node, plan, level.lists, theme), paint }];
  });
}

/**
 * The blocks of `doc` for layout, with what each draws beside its fonts (the svg surface draws marks and markers from it).
 *
 * @public
 */
export function richBlocks(doc: RichTextDoc | undefined, theme: Theme): { readonly blocks: StyledBlock[]; readonly paints: BlockPaint[] } {
  const rich = walk(doc?.content ?? [], { lists: 0, depth: 1 }, theme);
  return { blocks: rich.map((r) => r.block), paints: rich.map((r) => r.paint) };
}

/**
 * The blocks of `doc` for layout: one per paragraph, heading and list item, with their runs.
 *
 * @public
 */
export function styledBlocks(doc: RichTextDoc | undefined, theme: Theme): StyledBlock[] {
  return richBlocks(doc, theme).blocks;
}

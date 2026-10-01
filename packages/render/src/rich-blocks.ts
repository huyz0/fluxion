// What each rich-text block draws as (FR-TXT-001, ADR-0013, M7.9): pure, like rich-marks.ts, so the
// rules for the values a block carries are tested without a DOM. A paragraph is a `p`, a heading an
// `h1` to `h6`, a bullet list a `ul`, a numbered one an `ol`, a list item an `li`; a node this version
// does not know draws as a paragraph of its text (ADR-0013). Alignment, line height and the space
// around a block are checked again here, because a document can arrive unvalidated.
import type { RichTextNode } from '@fluxion/schema';

/**
 * One element a block draws.
 */
export type BlockPlan = {
  /** The tag. */
  readonly tag: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'li';
  /** An `ol`'s first number, when it is not 1. */
  readonly start?: number;
  /** Inline CSS properties (camel-cased, as React takes them). */
  readonly style?: { readonly [property: string]: string };
};

const ALIGN = new Set(['left', 'center', 'right', 'justify']);
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/** `value` when it is a finite number from `min` to `max`. */
const within = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;

/** The CSS of a text block's attributes: alignment, its own line height, the space above and below. */
function textStyle(attrs: { readonly [key: string]: unknown }): { readonly [property: string]: string } | undefined {
  const css: { [property: string]: string } = {};
  const align = attrs['align'];
  if (typeof align === 'string' && ALIGN.has(align)) css['textAlign'] = align;
  const lineHeight = within(attrs['lineHeight'], 0.5, 4);
  if (lineHeight !== undefined) css['lineHeight'] = String(lineHeight);
  const before = within(attrs['spaceBefore'], 0, 400);
  if (before !== undefined) css['marginTop'] = `${before}px`;
  const after = within(attrs['spaceAfter'], 0, 400);
  if (after !== undefined) css['marginBottom'] = `${after}px`;
  return Object.keys(css).length === 0 ? undefined : css;
}

/** `plan` with `style` when there is some. */
const styled = (plan: BlockPlan, style: BlockPlan['style']): BlockPlan => (style === undefined ? plan : { ...plan, style });

/**
 * What the block `node` draws as, or undefined for a node that is no block of this version (it draws
 * as a paragraph of its text).
 */
export function planBlock(node: RichTextNode): BlockPlan | undefined {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph':
    case 'heading': {
      const level = attrs['level'];
      // a heading's level picks h1 to h6; one that is not 1 to 6 (and any paragraph) is a p
      const tag = node.type === 'heading' && Number.isInteger(level) ? HEADINGS[Number(level) - 1] : undefined;
      return styled({ tag: tag ?? 'p' }, textStyle(attrs));
    }
    case 'bulletList':
      return { tag: 'ul' };
    case 'orderedList': {
      const start = attrs['start'];
      return Number.isInteger(start) && Number(start) > 1 ? { tag: 'ol', start: Number(start) } : { tag: 'ol' };
    }
    case 'listItem':
      return { tag: 'li' };
    default:
      return undefined;
  }
}

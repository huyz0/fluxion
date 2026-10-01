// The plain-text view of a label (FR-SHP-001, FR-CON-006, FR-TXT-002): its rich text as the lines it
// draws, for the measurer to fit (rich-text.tsx draws them with their marks), and the label's CSS from
// the resolved font. The lines are the ones drawn: a paragraph or heading is a line, a hard break
// starts another, every item of a list is one, and a field is its `{{name}}`.
import { MAX_RICH_TEXT_DEPTH, type RichTextDoc, type RichTextNode } from '@fluxion/schema';
import type { ResolvedFont } from '@fluxion/theme';
import type { CSSProperties } from 'react';

/**
 * The inline nodes under `node` in reading order: text, line breaks and fields (any other node is
 * flattened to those).
 */
export function inlineNodes(node: RichTextNode): readonly RichTextNode[] {
  // an explicit stack: a document that was never validated may nest as deep as it likes
  const found: RichTextNode[] = [];
  const stack = [node];
  for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
    if (n.type === 'text' || n.type === 'hardBreak' || n.type === 'field') found.push(n);
    else for (const child of [...(n.content ?? [])].reverse()) stack.push(child);
  }
  return found;
}

/** The text a field draws. */
export const fieldText = (node: RichTextNode): string => `{{${String((node.attrs ?? {})['name'])}}}`;

/** The lines of one text block: its text, a new line at each hard break. */
function textLines(node: RichTextNode): string[] {
  const lines = [''];
  for (const n of inlineNodes(node)) {
    if (n.type === 'hardBreak') lines.push('');
    else lines[lines.length - 1] += n.type === 'field' ? fieldText(n) : (n.text ?? '');
  }
  return lines;
}

const LISTS = new Set(['bulletList', 'orderedList', 'listItem']);

/** The lines of `node`: those of a list's items, or its own text when it is a block of text. */
const blockLines = (node: RichTextNode, depth: number): string[] =>
  LISTS.has(node.type) && depth <= MAX_RICH_TEXT_DEPTH ? (node.content ?? []).flatMap((child) => blockLines(child, depth + 1)) : textLines(node);

/**
 * The lines of `doc` as plain strings, one per paragraph, heading and list item and per hard break
 * (none for an absent document): what the measurer fits.
 *
 * @public
 */
export function plainParagraphs(doc: RichTextDoc | undefined): string[] {
  return (doc?.content ?? []).flatMap((node) => blockLines(node, 1));
}

const JUSTIFY: { readonly [align: string]: string } = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

/** The CSS of a label drawn with `font` at `opacity`. */
export function labelStyle(font: ResolvedFont, opacity: string): CSSProperties {
  return {
    fontFamily: font.family,
    fontSize: font.size,
    fontWeight: font.weight as CSSProperties['fontWeight'],
    fontStyle: font.style,
    lineHeight: font.lineHeight,
    color: font.color,
    textAlign: font.align as CSSProperties['textAlign'],
    justifyContent: JUSTIFY[font.verticalAlign] ?? 'center',
    opacity,
  };
}

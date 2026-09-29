// The plain-text label of a boxed element or a connector (FR-SHP-001, FR-CON-006, R0): its rich text
// as paragraphs of plain text, styled with the resolved font. Marks, links and lists arrive with the
// text engine (M7); their text is kept, their styling not.
import type { RichTextDoc, RichTextNode } from '@fluxion/schema';
import type { ResolvedFont } from '@fluxion/theme';
import type { CSSProperties } from 'react';

const textOf = (node: RichTextNode): string => (node.text ?? '') + (node.content ?? []).map(textOf).join('');

/**
 * The paragraphs of `doc` as plain strings (none for an absent document).
 *
 * @public
 */
export function plainParagraphs(doc: RichTextDoc | undefined): string[] {
  return (doc?.content ?? []).map(textOf);
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

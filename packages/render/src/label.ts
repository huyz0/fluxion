// The plain-text label of a boxed element (FR-SHP-001, R0): its rich text as paragraphs of plain
// text. Marks, links and lists arrive with the text engine (M7); their text is kept, their styling not.
import type { RichTextDoc, RichTextNode } from '@fluxion/schema';

const textOf = (node: RichTextNode): string => (node.text ?? '') + (node.content ?? []).map(textOf).join('');

/**
 * The paragraphs of `doc` as plain strings (none for an absent document).
 *
 * @public
 */
export function plainParagraphs(doc: RichTextDoc | undefined): string[] {
  return (doc?.content ?? []).map(textOf);
}

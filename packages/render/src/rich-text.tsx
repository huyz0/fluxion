// Rich text drawn from its ADR-0013 JSON (FR-TXT-001, M7.8): the paragraphs of a document with their
// marks. The same component draws in edit and present mode, so the text is identical in both
// (FR-EDT-010). Blocks other than paragraphs (headings, lists) are drawn as their text for now; they
// arrive with M7.9. The rules for what a mark may draw are rich-marks.ts's.
import type { RichTextDoc, RichTextNode } from '@fluxion/schema';
import { Fragment, type ReactNode } from 'react';
import { type MarkPlan, planMarks } from './rich-marks.js';

/** The inline nodes under `node` in reading order: text, line breaks and fields (any other node is flattened to those). */
function inlines(node: RichTextNode): readonly RichTextNode[] {
  if (node.type === 'text' || node.type === 'hardBreak' || node.type === 'field') return [node];
  return (node.content ?? []).flatMap(inlines);
}

/** `children` wrapped in the element `p` draws. */
function wrap(p: MarkPlan, children: ReactNode): ReactNode {
  switch (p.tag) {
    case 'a': {
      // tzap disable next-line ConditionalExpression: React leaves out an attribute whose value is undefined
      const title = p.title === undefined ? {} : { title: p.title };
      return (
        <a href={p.href} {...title} rel="noopener noreferrer">
          {children}
        </a>
      );
    }
    case 'span':
      return <span style={p.style}>{children}</span>;
    case 'mark':
      return <mark style={p.style}>{children}</mark>;
    default: {
      const Tag = p.tag;
      return <Tag>{children}</Tag>;
    }
  }
}

/** One inline node: its text inside its marks, a line break, or a field's `{{name}}`. */
function inline(node: RichTextNode, key: number): ReactNode {
  if (node.type === 'hardBreak') return <br key={key} />;
  const text = node.type === 'field' ? `{{${String((node.attrs ?? {})['name'])}}}` : (node.text ?? '');
  const plans = planMarks(node.marks);
  // innermost first: the last plan wraps the text, each earlier one wraps that
  const drawn = plans.reduceRight<ReactNode>((inner, p) => wrap(p, inner), text);
  return <Fragment key={key}>{drawn}</Fragment>;
}

/**
 * The paragraphs of `doc`, each block a `<p>` of its inline nodes with their marks (none for an absent
 * document).
 *
 * @public
 */
export function RichText(props: { readonly doc: RichTextDoc | undefined }): ReactNode {
  return (props.doc?.content ?? []).map((block, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity; their position is their key
    <p key={i}>{inlines(block).map(inline)}</p>
  ));
}

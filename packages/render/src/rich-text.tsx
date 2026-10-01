// Rich text drawn from its ADR-0013 JSON (FR-TXT-001, M7.8, M7.9): the blocks of a document with their
// marks. The same component draws in edit and present mode, so the text is identical in both
// (FR-EDT-010). The rules for what a mark may draw are rich-marks.ts's, and for a block rich-blocks.ts's.
import { MAX_RICH_TEXT_DEPTH, type RichTextDoc, type RichTextNode } from '@fluxion/schema';
import { createElement, Fragment, type ReactNode } from 'react';
import { fieldText, inlineNodes } from './label.js';
import { planBlock } from './rich-blocks.js';
import { type MarkPlan, planMarks } from './rich-marks.js';

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
  const text = node.type === 'field' ? fieldText(node) : (node.text ?? '');
  const plans = planMarks(node.marks);
  // innermost first: the last plan wraps the text, each earlier one wraps that
  const drawn = plans.reduceRight<ReactNode>((inner, p) => wrap(p, inner), text);
  return <Fragment key={key}>{drawn}</Fragment>;
}

/** The inline nodes of `node` drawn. */
const runs = (node: RichTextNode) => inlineNodes(node).map(inline);

/**
 * One block: its element, with the blocks of a list or list item inside it. Nesting deeper than the
 * schema allows (a document that was never validated) is drawn as the text it holds, so no input can
 * overflow the stack.
 */
function block(node: RichTextNode, key: number, depth: number): ReactNode {
  const plan = depth > MAX_RICH_TEXT_DEPTH ? undefined : planBlock(node);
  if (plan === undefined) return <p key={key}>{runs(node)}</p>;
  const { tag, style, start } = plan;
  const inside = tag === 'ul' || tag === 'ol' || tag === 'li';
  // tzap disable next-line ConditionalExpression: React leaves out an attribute whose value is undefined
  const attrs = { key, ...(style === undefined ? {} : { style }), ...(start === undefined ? {} : { start }) };
  return createElement(tag, attrs, inside ? (node.content ?? []).map((child, i) => block(child, i, depth + 1)) : runs(node));
}

/**
 * The blocks of `doc`: paragraphs, headings and (nested) lists, each with its alignment and spacing,
 * and its inline nodes with their marks (nothing for an absent document).
 *
 * @public
 */
export function RichText(props: { readonly doc: RichTextDoc | undefined }): ReactNode {
  return (props.doc?.content ?? []).map((node, i) => block(node, i, 1));
}

// The editor's ProseMirror schema for rich text (ADR-0064, M7.12): the nodes and marks of ADR-0013's
// table, the attributes pm-json.ts moves between the stored JSON and ProseMirror's, and the opaque nodes
// and marks that hold what this version does not know. How a node or mark looks in the editing DOM is
// what render draws for it (planBlock, planMarks), so the editor shows the text as the screen does.
import { planBlock, planMarks } from '@fluxion/render';
import type { RichTextMark, RichTextNode } from '@fluxion/schema';
import { type DOMOutputSpec, type Mark, type MarkSpec, type Node, type NodeSpec, Schema } from 'prosemirror-model';

/** A property name in kebab-case (`marginTop` → `margin-top`). */
const kebab = (name: string): string => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Inline CSS properties as a style attribute's text. */
const cssText = (style: { readonly [property: string]: string }): string =>
  Object.entries(style)
    .map(([k, v]) => `${kebab(k)}: ${v}`)
    .join('; ');

/** The text under a stored node (what an opaque node shows). */
function textUnder(node: unknown): string {
  if (typeof node !== 'object' || node === null) return '';
  const n = node as { text?: unknown; content?: unknown };
  const own = typeof n.text === 'string' ? n.text : '';
  return own + (Array.isArray(n.content) ? n.content.map(textUnder).join('') : '');
}

const extra = { default: null };
const blockAttrs = { align: { default: null }, lineHeight: { default: null }, spaceBefore: { default: null }, spaceAfter: { default: null }, extra };

/** A text block's DOM: render's element and style for its node. */
function blockDom(node: Node): DOMOutputSpec {
  const stored: RichTextNode = { type: node.type.name, attrs: Object.fromEntries(Object.entries(node.attrs).filter(([, v]) => v !== null)) };
  const plan = planBlock(stored);
  const style = plan?.style === undefined ? {} : { style: cssText(plan.style) };
  return [plan?.tag ?? 'p', style, 0];
}

/** A mark's DOM: the element render draws for it, or a plain span for one that draws nothing (an unsafe link). */
function markDom(mark: Mark): DOMOutputSpec {
  const stored: RichTextMark = { type: mark.type.name, attrs: Object.fromEntries(Object.entries(mark.attrs).filter(([, v]) => v !== null)) };
  const plan = planMarks([stored])[0];
  if (plan === undefined) return ['span', 0];
  const attrs: { [name: string]: string } = {};
  if (plan.href !== undefined) Object.assign(attrs, { href: plan.href, rel: 'noopener noreferrer' });
  if (plan.title !== undefined) attrs['title'] = plan.title;
  if (plan.style !== undefined) attrs['style'] = cssText(plan.style);
  return [plan.tag, attrs, 0];
}

const mark = (attrs: MarkSpec['attrs'] = {}, rest: MarkSpec = {}): MarkSpec => ({ attrs: { ...attrs, extra }, toDOM: markDom, ...rest });

const nodes: { [name: string]: NodeSpec } = {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'inline*', attrs: blockAttrs, toDOM: blockDom, parseDOM: [{ tag: 'p' }] },
  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: { ...blockAttrs, level: { default: 1 } },
    toDOM: blockDom,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
  },
  bulletList: { group: 'block', content: '(listItem | unknownBlock)+', attrs: { extra }, toDOM: () => ['ul', 0], parseDOM: [{ tag: 'ul' }] },
  orderedList: {
    group: 'block',
    content: '(listItem | unknownBlock)+',
    attrs: { start: { default: null }, extra },
    toDOM: (node) => (typeof node.attrs['start'] === 'number' && node.attrs['start'] > 1 ? ['ol', { start: String(node.attrs['start']) }, 0] : ['ol', 0]),
    parseDOM: [{ tag: 'ol' }],
  },
  listItem: { content: '(paragraph | unknownBlock) block*', defining: true, attrs: { extra }, toDOM: () => ['li', 0], parseDOM: [{ tag: 'li' }] },
  text: { group: 'inline' },
  hardBreak: { group: 'inline', inline: true, selectable: false, attrs: { extra }, toDOM: () => ['br'], parseDOM: [{ tag: 'br' }] },
  field: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { name: { default: 'page' }, extra },
    toDOM: (node) => ['span', { class: 'fx-field' }, `{{${String(node.attrs['name'])}}}`],
  },
  // what this version does not know is kept whole and shown as its text, read-only (FR-DOC-005)
  unknownBlock: {
    group: 'block',
    atom: true,
    attrs: { original: { default: null } },
    toDOM: (node) => ['div', { class: 'fx-chrome-unknown', contenteditable: 'false' }, textUnder(node.attrs['original'])],
  },
  unknownInline: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: { original: { default: null } },
    toDOM: (node) => ['span', { class: 'fx-chrome-unknown', contenteditable: 'false' }, textUnder(node.attrs['original'])],
  },
};

// the order here is ProseMirror's rank: the order marks nest in the DOM, link outermost; unknown marks last
const marks: { [name: string]: MarkSpec } = {
  link: mark({ href: { default: '' }, title: { default: null } }, { inclusive: false }),
  bold: mark(),
  italic: mark(),
  underline: mark(),
  strike: mark(),
  code: mark(),
  highlight: mark({ color: { default: null } }),
  color: mark({ color: { default: null } }),
  size: mark({ size: { default: null } }),
  font: mark({ family: { default: null } }),
  // several unknown marks sit on one text, and none excludes another
  unknownMark: { attrs: { original: { default: null } }, excludes: '', inclusive: false, toDOM: () => ['span', 0] },
};

/** The schema of the rich-text editor. */
export const TEXT_SCHEMA: Schema = new Schema({ nodes, marks });

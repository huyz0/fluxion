// Rich text (ADR-0013): ProseMirror-compatible JSON. The stored shape is generic ProseMirror JSON;
// checkRichText applies the node/mark rules. Unknown node and mark types are kept and reported as
// warnings (a newer minor version may add them); structural errors on known nodes are errors.
import { z } from 'zod';
import type { DiagnosticSeverity } from './diagnostics.js';
import { tokenRefSchema } from './paint.js';
import type { Extensible } from './primitives.js';
import { safeLinkUrl } from './safe-url.js';

/**
 * A mark on a text node (`bold`, `link`, …).
 *
 * @public
 */
export type RichTextMark = Extensible<{
  /** Mark type. */
  readonly type: string;
  /** Mark attributes (e.g. `href` of a link). */
  readonly attrs?: { readonly [key: string]: unknown };
}>;

/**
 * A node of a rich-text document (ProseMirror JSON).
 *
 * @public
 */
export type RichTextNode = Extensible<{
  /** Node type (`paragraph`, `text`, …). */
  readonly type: string;
  /** Node attributes (e.g. `level` of a heading). */
  readonly attrs?: { readonly [key: string]: unknown };
  /** Child nodes. */
  readonly content?: readonly RichTextNode[];
  /** Marks of a text node. */
  readonly marks?: readonly RichTextMark[];
  /** Characters of a text node. */
  readonly text?: string;
}>;

/**
 * A rich-text document: a `doc` node holding blocks.
 *
 * @public
 */
export type RichTextDoc = RichTextNode & {
  /** Always `doc`. */
  readonly type: 'doc';
};

/**
 * A problem found in rich text, with its path below the rich-text value.
 *
 * @public
 */
export type RichTextIssue = {
  /** Stable code. */
  readonly code: 'FLX_TEXT_INVALID' | 'FLX_TEXT_UNKNOWN_NODE' | 'FLX_TEXT_UNKNOWN_MARK' | 'FLX_TEXT_UNSAFE_LINK';
  /** `error` for broken structure or unsafe links, `warning` for unknown (preserved) types. */
  readonly severity: DiagnosticSeverity;
  /** Path segments below the rich-text value. */
  readonly path: readonly (string | number)[];
  /** One-line description. */
  readonly message: string;
};

type Path = readonly (string | number)[];
// `any`: children of an unknown node, whose content rules this version does not know
type Role = 'block' | 'inline' | 'listItem' | 'any';

/**
 * Deepest nesting of rich-text nodes accepted (a list inside a list … counts one level per node).
 *
 * @public
 */
export const MAX_RICH_TEXT_DEPTH: number = 64;

const BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList']);
const INLINES = new Set(['text', 'hardBreak', 'field']);
const KNOWN = new Set([...BLOCKS, ...INLINES, 'listItem', 'doc']);
const ALIGN = new Set(['left', 'center', 'right', 'justify']);
const FIELDS = new Set(['page', 'pageCount', 'screenName', 'date', 'title']);
// ADR-0013 amendment (M7.9): a paragraph's or heading's own line height (a multiple of its size) and the space
// above and below it (px), over the style's
const SPACING: readonly (readonly [name: string, min: number, max: number])[] = [
  ['lineHeight', 0.5, 4],
  ['spaceBefore', 0, 400],
  ['spaceAfter', 0, 400],
];

type Obj = { readonly [key: string]: unknown };
const isObject = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

class Walker {
  readonly issues: RichTextIssue[] = [];

  error(path: Path, message: string, code: RichTextIssue['code'] = 'FLX_TEXT_INVALID'): void {
    this.issues.push({ code, severity: 'error', path, message });
  }

  warn(path: Path, message: string, code: RichTextIssue['code']): void {
    this.issues.push({ code, severity: 'warning', path, message });
  }

  /** Check one node expected in `role`; returns its type when it is an object with a string type. */
  node(value: unknown, role: Role, path: Path): string | undefined {
    // untrusted input: a hostile nesting depth must be an issue, not a stack overflow (M2.7 review F1)
    if (path.length / 2 > MAX_RICH_TEXT_DEPTH) {
      this.error(path, `rich text is nested deeper than ${MAX_RICH_TEXT_DEPTH} levels`);
      return undefined;
    }
    if (!isObject(value) || typeof value['type'] !== 'string') {
      this.error(path, 'rich-text node must be an object with a string "type"');
      return undefined;
    }
    const type = value['type'];
    if (!KNOWN.has(type)) {
      // preserved as is; satisfies any content rule (ADR-0013 amendment, M2.7)
      this.warn(path, `unknown rich-text node "${type}" is kept and shown as plain text`, 'FLX_TEXT_UNKNOWN_NODE');
      this.unknownNode(value, path);
      return type;
    }
    const fits = role === 'any' || (role === 'block' ? BLOCKS.has(type) : role === 'inline' ? INLINES.has(type) : type === 'listItem');
    if (!fits) this.error(path, `"${type}" is not allowed here (expected ${role === 'listItem' ? 'listItem' : `a ${role} node`})`);
    else this.known(value, type, path);
    return type;
  }

  /** An unknown node keeps its data, but renderers walk its content and text: those must be well formed (M2.7 review F2). */
  unknownNode(node: Obj, path: Path): void {
    const content = node['content'];
    if (content !== undefined && !Array.isArray(content)) this.error([...path, 'content'], 'content must be an array');
    if (Array.isArray(content))
      content.forEach((child: unknown, i: number) => {
        this.node(child, 'any', [...path, 'content', i]);
      });
    if (node['text'] !== undefined && typeof node['text'] !== 'string') this.error([...path, 'text'], 'text must be a string');
    if (node['marks'] !== undefined) this.marks(node['marks'], path);
  }

  known(node: Obj, type: string, path: Path): void {
    if (node['attrs'] !== undefined && !isObject(node['attrs'])) this.error([...path, 'attrs'], 'attrs must be an object');
    const attrs = isObject(node['attrs']) ? node['attrs'] : {};
    if (type === 'text') this.text(node, path);
    else if (type === 'hardBreak') this.leaf(node, path);
    else if (type === 'field') this.field(node, attrs, path);
    else {
      if (type === 'paragraph' || type === 'heading') this.textBlock(attrs, type, path);
      if (type === 'orderedList') this.listStart(attrs, path);
      this.children(node, type, path);
    }
  }

  field(node: Obj, attrs: Obj, path: Path): void {
    if (!FIELDS.has(String(attrs['name']))) this.error([...path, 'attrs', 'name'], `field name must be one of ${[...FIELDS].join(', ')}`);
    this.leaf(node, path);
  }

  listStart(attrs: Obj, path: Path): void {
    const start = attrs['start'];
    if (start !== undefined && !(Number.isInteger(start) && Number(start) >= 1))
      this.error([...path, 'attrs', 'start'], 'orderedList start must be an integer of at least 1');
  }

  textBlock(attrs: Obj, type: string, path: Path): void {
    if (attrs['align'] !== undefined && !ALIGN.has(String(attrs['align'])))
      this.error([...path, 'attrs', 'align'], 'align must be left, center, right or justify');
    for (const [name, min, max] of SPACING) {
      const v = attrs[name];
      if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max))
        this.error([...path, 'attrs', name], `${name} must be a number from ${min} to ${max}`);
    }
    if (type === 'heading' && !(Number.isInteger(attrs['level']) && Number(attrs['level']) >= 1 && Number(attrs['level']) <= 6))
      this.error([...path, 'attrs', 'level'], 'heading level must be an integer from 1 to 6');
  }

  /** The child list to walk, after reporting a missing, non-array or wrongly empty `content`. */
  contentOf(node: Obj, type: string, at: Path): readonly unknown[] {
    const content = node['content'];
    const textBlock = type === 'paragraph' || type === 'heading';
    if (content === undefined) {
      if (!textBlock) this.error(at, `${type} needs content`);
      return [];
    }
    if (!Array.isArray(content)) {
      this.error(at, 'content must be an array');
      return [];
    }
    if (content.length === 0 && !textBlock) this.error(at, `${type} needs at least one child`);
    return content;
  }

  children(node: Obj, type: string, path: Path): void {
    const at = [...path, 'content'];
    const role: Role = type === 'bulletList' || type === 'orderedList' ? 'listItem' : type === 'paragraph' || type === 'heading' ? 'inline' : 'block';
    this.contentOf(node, type, at).forEach((child: unknown, i: number) => {
      const childType = this.node(child, role, [...at, i]);
      if (type === 'listItem' && i === 0 && childType !== undefined && KNOWN.has(childType) && childType !== 'paragraph')
        this.error([...at, 0], 'a listItem starts with a paragraph');
    });
  }

  leaf(node: Obj, path: Path): void {
    if (node['content'] !== undefined) this.error([...path, 'content'], `${String(node['type'])} has no content`);
  }

  text(node: Obj, path: Path): void {
    if (typeof node['text'] !== 'string' || node['text'] === '') this.error([...path, 'text'], 'text node needs non-empty text');
    this.leaf(node, path);
    if (node['marks'] !== undefined) this.marks(node['marks'], path);
  }

  marks(marks: unknown, path: Path): void {
    if (!Array.isArray(marks)) {
      this.error([...path, 'marks'], 'marks must be an array');
      return;
    }
    const seen = new Set<string>();
    marks.forEach((mark: unknown, i: number) => {
      const type = this.mark(mark, [...path, 'marks', i]);
      if (type !== undefined && seen.has(type)) this.error([...path, 'marks', i], `mark "${type}" appears twice`);
      if (type !== undefined) seen.add(type);
    });
  }

  mark(mark: unknown, path: Path): string | undefined {
    if (!isObject(mark) || typeof mark['type'] !== 'string') {
      this.error(path, 'mark must be an object with a string "type"');
      return undefined;
    }
    const type = mark['type'];
    const attrs = isObject(mark['attrs']) ? mark['attrs'] : {};
    const check = MARK_ATTRS[type];
    if (check === undefined) this.warn(path, `unknown mark "${type}" is kept and ignored when rendering`, 'FLX_TEXT_UNKNOWN_MARK');
    else check(this, attrs, [...path, 'attrs']);
    return type;
  }
}

type AttrCheck = (w: Walker, attrs: { readonly [key: string]: unknown }, path: Path) => void;
const none: AttrCheck = () => undefined;
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// ADR-0013: a CSS hex colour or a token reference (M2.7 review F2)
const colorAttr: AttrCheck = (w, attrs, path) => {
  const color = attrs['color'];
  if (!((typeof color === 'string' && HEX.test(color)) || tokenRefSchema.safeParse(color).success))
    w.error([...path, 'color'], 'expected a hex colour such as #3355ff or a token reference');
};
const MARK_ATTRS: { readonly [type: string]: AttrCheck } = {
  bold: none,
  italic: none,
  underline: none,
  strike: none,
  code: none,
  link: (w, attrs, path) => {
    const href = attrs['href'];
    if (typeof href !== 'string' || safeLinkUrl(href) === undefined)
      w.error([...path, 'href'], 'link href must be http(s) without user information, mailto or #screen:<id> (NFR-SEC-001)', 'FLX_TEXT_UNSAFE_LINK');
    if (attrs['title'] !== undefined && typeof attrs['title'] !== 'string') w.error([...path, 'title'], 'link title must be a string');
  },
  color: colorAttr,
  highlight: colorAttr,
  font: (w, attrs, path) => {
    const f = attrs['family'];
    // a string starting with "{" is a token reference or a broken one, never a family name (M2.7 review F1)
    const ok = tokenRefSchema.safeParse(f).success || (typeof f === 'string' && f !== '' && !f.startsWith('{'));
    if (!ok) w.error([...path, 'family'], 'font family must be a non-empty name or a token reference');
  },
  size: (w, attrs, path) => {
    const s = attrs['size'];
    if (!((typeof s === 'number' && s > 0) || tokenRefSchema.safeParse(s).success))
      w.error([...path, 'size'], 'size must be a positive number or a token reference');
  },
};

/**
 * Check a rich-text value against ADR-0013: errors for broken structure and unsafe links,
 * warnings for unknown (preserved) node and mark types.
 *
 * @public
 */
export function checkRichText(value: unknown): RichTextIssue[] {
  const w = new Walker();
  if (!isObject(value) || value['type'] !== 'doc') {
    w.error([], 'rich text must be a {"type":"doc"} object');
    return w.issues;
  }
  w.children(value, 'doc', []);
  return w.issues;
}

/** A rich-text field: errors fail the parse (with their paths); warnings are left to `validate`. */
export const richTextSchema: z.ZodType<RichTextDoc> = z.custom<RichTextDoc>(isObject).superRefine((value, ctx) => {
  for (const issue of checkRichText(value))
    if (issue.severity === 'error') ctx.addIssue({ code: 'custom', path: [...issue.path], message: issue.message, params: { flx: issue.code } });
});

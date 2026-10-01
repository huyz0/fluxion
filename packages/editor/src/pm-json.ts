// Rich text between the stored JSON (ADR-0013) and the editor's ProseMirror JSON (ADR-0064, M7.12): the
// thin, pure layer on each side of `Node.fromJSON` / `toJSON`. It moves what ProseMirror's schema cannot
// hold: unknown attributes and extra keys travel in a declared `extra` attribute; a node or mark this
// version does not know travels whole in an opaque `unknownBlock`, `unknownInline` or `unknownMark`
// (FR-DOC-005: a newer file never loses text on an older reader); a text node with extra keys carries
// them on a marker mark. Saving undoes all of it, so load then save is the identity up to the order of a
// text's marks (a set), and a second save is byte-identical. No ProseMirror import: this runs in Node.

/** A JSON object. */
type Json = { readonly [key: string]: unknown };

/** ProseMirror's JSON for a node: what `Node.fromJSON` takes and `toJSON` gives. */
export type PmNode = {
  readonly type: string;
  readonly attrs?: Json;
  readonly content?: readonly PmNode[];
  readonly marks?: readonly PmMark[];
  readonly text?: string;
};

/** ProseMirror's JSON for a mark. */
export type PmMark = { readonly type: string; readonly attrs?: Json };

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The attributes the editor's schema declares for each known node type (besides `extra`). */
const NODE_ATTRS: { readonly [type: string]: readonly string[] } = {
  paragraph: ['align', 'lineHeight', 'spaceBefore', 'spaceAfter'],
  heading: ['level', 'align', 'lineHeight', 'spaceBefore', 'spaceAfter'],
  bulletList: [],
  orderedList: ['start'],
  listItem: [],
  hardBreak: [],
  field: ['name'],
};

/** The attributes declared for each known mark type (besides `extra`). */
const MARK_ATTRS: { readonly [type: string]: readonly string[] } = {
  bold: [],
  italic: [],
  underline: [],
  strike: [],
  code: [],
  link: ['href', 'title'],
  color: ['color'],
  highlight: ['color'],
  font: ['family'],
  size: ['size'],
};

/** The marker mark that carries a text node's extra keys. */
const TEXT_EXTRA = '$extra';

const has = (table: { readonly [type: string]: unknown }, type: string): boolean => Object.hasOwn(table, type);

/** What a node's parent lets it be. */
type Place = 'doc' | 'inline' | 'list' | 'item';

/** `attrs` and the keys of `node` besides those the schema declares, as the `extra` attribute (null when there are none). */
function extraOf(node: Json, declared: readonly string[], own: readonly string[]): Json | null {
  const attrs = isObject(node['attrs']) ? node['attrs'] : {};
  const unknownAttrs = Object.fromEntries(Object.entries(attrs).filter(([k]) => !declared.includes(k)));
  const unknownKeys = Object.fromEntries(Object.entries(node).filter(([k]) => !['type', 'attrs', 'content', 'marks', 'text', ...own].includes(k)));
  const extra: { attrs?: Json; keys?: Json } = {};
  if (Object.keys(unknownAttrs).length > 0) extra.attrs = unknownAttrs;
  if (Object.keys(unknownKeys).length > 0) extra.keys = unknownKeys;
  return Object.keys(extra).length > 0 ? extra : null;
}

/** The declared attributes present on `node`, plus its `extra`. */
function attrsOf(node: Json, declared: readonly string[]): Json {
  const attrs = isObject(node['attrs']) ? node['attrs'] : {};
  const out: { [key: string]: unknown } = {};
  for (const k of declared) if (attrs[k] !== undefined) out[k] = attrs[k];
  const extra = extraOf(node, declared, []);
  if (extra !== null) out['extra'] = extra;
  return out;
}

/** A mark in ProseMirror JSON: a known one by its declared attributes, any other whole. */
function loadMark(mark: unknown): PmMark | undefined {
  if (!isObject(mark) || typeof mark['type'] !== 'string') return undefined;
  const type = mark['type'];
  if (!has(MARK_ATTRS, type)) return { type: 'unknownMark', attrs: { original: mark } };
  const attrs = attrsOf(mark, MARK_ATTRS[type] ?? []);
  return Object.keys(attrs).length > 0 ? { type, attrs } : { type };
}

/** A text node's marks, with the marker for its extra keys. */
function loadMarks(node: Json): PmMark[] {
  const marks = (Array.isArray(node['marks']) ? node['marks'] : []).flatMap((m) => loadMark(m) ?? []);
  const extra = extraOf(node, [], ['text']);
  return extra === null ? marks : [...marks, { type: 'unknownMark', attrs: { original: { type: TEXT_EXTRA, ...extra } } }];
}

/** `node` kept whole where its place has no node of its own for it. */
const opaque = (node: unknown, place: Place): PmNode => ({ type: place === 'inline' ? 'unknownInline' : 'unknownBlock', attrs: { original: node } });

/** The content a known node holds, by the place its children are in. */
const PLACE_OF: { readonly [type: string]: Place } = {
  doc: 'doc',
  paragraph: 'inline',
  heading: 'inline',
  bulletList: 'list',
  orderedList: 'list',
  listItem: 'item',
};

/** The node types each place has a node of its own for. */
const FITS: { readonly [place in Place]: readonly string[] } = {
  doc: ['paragraph', 'heading', 'bulletList', 'orderedList'],
  list: ['listItem'],
  // a list item starts with a paragraph, then any block
  item: ['paragraph', 'heading', 'bulletList', 'orderedList'],
  inline: ['text', 'hardBreak', 'field'],
};

/** A child of a node, in ProseMirror JSON (nothing for text with none). */
function loadChild(node: unknown, place: Place, first: boolean): PmNode[] {
  if (!isObject(node) || typeof node['type'] !== 'string') return [];
  const type = node['type'];
  const fits = FITS[place].includes(type) && !(place === 'item' && first && type !== 'paragraph');
  if (!fits) return [opaque(node, place)];
  if (type === 'text') {
    const text = node['text'];
    if (typeof text !== 'string' || text === '') return [];
    const marks = loadMarks(node);
    return [marks.length > 0 ? { type, text, marks } : { type, text }];
  }
  return [loadKnown(node, type)];
}

/** A known node, with its children. */
function loadKnown(node: Json, type: string): PmNode {
  const attrs = attrsOf(node, NODE_ATTRS[type] ?? []);
  const place = PLACE_OF[type];
  const children = Array.isArray(node['content']) ? node['content'] : [];
  const content = place === undefined ? [] : children.flatMap((c, i) => loadChild(c, place, i === 0));
  return { type, ...(Object.keys(attrs).length > 0 ? { attrs } : {}), ...(content.length > 0 ? { content } : {}) };
}

/**
 * A stored rich-text document as ProseMirror JSON. An absent or empty document gets one empty paragraph
 * (the editor needs a place for the cursor).
 */
export function toPmJson(doc: unknown): PmNode {
  const content = isObject(doc) && Array.isArray(doc['content']) ? doc['content'].flatMap((c, i) => loadChild(c, 'doc', i === 0)) : [];
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

// ── saving ──────────────────────────────────────────────────────────────────────────────────────────

/** `value` is not null or undefined. */
const present = (v: unknown): boolean => v !== null && v !== undefined;

/** The stored attributes: the declared ones that are set, and the extra attributes carried along. */
function storedAttrs(attrs: Json | undefined, declared: readonly string[]): Json | undefined {
  const out: { [key: string]: unknown } = {};
  for (const k of declared) if (present(attrs?.[k])) out[k] = attrs?.[k];
  const extra = isObject(attrs?.['extra']) ? attrs?.['extra'] : undefined;
  if (isObject(extra?.['attrs'])) Object.assign(out, extra?.['attrs']);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The keys carried in an `extra` that belong at the top of the node. */
const extraKeys = (attrs: Json | undefined): Json => {
  const extra = attrs?.['extra'];
  return isObject(extra) && isObject(extra['keys']) ? extra['keys'] : {};
};

/** A mark as stored: unknown ones whole, known ones by their set attributes. */
function saveMark(mark: PmMark): Json {
  const original = mark.attrs?.['original'];
  if (mark.type === 'unknownMark' && isObject(original)) return original;
  const attrs = storedAttrs(mark.attrs, MARK_ATTRS[mark.type] ?? []);
  return { type: mark.type, ...(attrs === undefined ? {} : { attrs }) };
}

/** A text node as stored: its marks, and its extra keys back from their marker. */
function saveText(node: PmNode): Json {
  const stored = (node.marks ?? []).map(saveMark);
  const marker = stored.find((m) => m['type'] === TEXT_EXTRA);
  const marks = stored.filter((m) => m !== marker);
  const { type: _type, ...rest } = marker ?? {};
  const extraAttrs = isObject(rest['attrs']) ? { attrs: rest['attrs'] } : {};
  const extraTop = isObject(rest['keys']) ? rest['keys'] : {};
  return { type: 'text', text: node.text, ...(marks.length > 0 ? { marks } : {}), ...extraAttrs, ...extraTop };
}

/** A node as stored. */
function saveNode(node: PmNode): Json {
  if (node.type === 'text') return saveText(node);
  const original = node.attrs?.['original'];
  if ((node.type === 'unknownBlock' || node.type === 'unknownInline') && isObject(original)) return original;
  const attrs = storedAttrs(node.attrs, NODE_ATTRS[node.type] ?? []);
  const children = (node.content ?? []).map(saveNode);
  return {
    type: node.type,
    ...(attrs === undefined ? {} : { attrs }),
    ...(children.length > 0 || node.type === 'doc' ? { content: children } : {}),
    ...extraKeys(node.attrs),
  };
}

/**
 * ProseMirror JSON as a stored rich-text document: optional attributes that are unset are left out,
 * extra attributes and keys come back, opaque nodes and marks are the originals they held.
 */
export function fromPmJson(pm: PmNode): Json {
  return saveNode(pm);
}

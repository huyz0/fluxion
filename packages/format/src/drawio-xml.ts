// Strict bounded XML reader for draw.io libraries (ADR-0049): elements, attributes and text only. A doctype,
// entity declaration, processing instruction other than the XML declaration, unknown entity or unbalanced tag
// refuses the input; nothing is resolved or expanded beyond the five predefined entities and character references.

/** A read element. */
export type XmlNode = { readonly name: string; readonly attributes: ReadonlyMap<string, string>; readonly children: readonly (XmlNode | string)[] };

/** Reader bounds; exceeding any refuses the input. */
export type XmlLimits = { readonly maxChars: number; readonly maxNodes: number; readonly maxDepth: number; readonly maxAttributes: number };

const ENTITIES: { readonly [name: string]: string } = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const NAME = /^[A-Za-z_][\w:.-]*/;

/** One reference body (between `&` and `;`) as its text; undefined for an unknown entity or invalid code point. */
function referenceOf(body: string): string | undefined {
  if (!body.startsWith('#')) return Object.hasOwn(ENTITIES, body) ? ENTITIES[body] : undefined;
  if (!/^#(?:x[0-9a-fA-F]{1,6}|[0-9]{1,7})$/.test(body)) return undefined;
  const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : undefined;
}

type Units = { readonly units: Uint16Array; size: number };
const copy = (out: Units, text: string, from: number, to: number): void => {
  for (let i = from; i < to; i++) out.units[out.size++] = text.charCodeAt(i);
};
/** The reference opened by `&` at `at` and closed by `;` at `end`, or undefined when it is malformed. */
const referenceAt = (text: string, at: number, end: number): string | undefined => {
  if (end < 0 || end - at - 1 > 12) return undefined;
  const body = text.slice(at + 1, end);
  return /[&\s]/.test(body) ? undefined : referenceOf(body);
};

/**
 * `text` with references replaced; undefined for an unknown entity, invalid code point or bare `&`. Linear in time
 * and memory: decoded code units go to one preallocated buffer (references never decode longer than they are).
 */
function decodeXmlText(text: string): string | undefined {
  let at = text.indexOf('&');
  if (at < 0) return text;
  const out = { units: new Uint16Array(text.length), size: 0 };
  let from = 0;
  while (at >= 0) {
    copy(out, text, from, at);
    const end = text.indexOf(';', at + 1);
    const value = referenceAt(text, at, end);
    if (value === undefined) return undefined;
    copy(out, value, 0, value.length);
    from = end + 1;
    at = text.indexOf('&', from);
  }
  copy(out, text, from, text.length);
  const chunks: string[] = [];
  for (let i = 0; i < out.size; i += 8192) chunks.push(String.fromCharCode(...out.units.subarray(i, Math.min(out.size, i + 8192))));
  return chunks.join('');
}

/** The attributes of a tag body; undefined when malformed, duplicated or more than `max`. */
function attributesOf(body: string, max: number): Map<string, string> | undefined {
  const found = new Map<string, string>();
  let rest = body.trim();
  while (rest !== '') {
    if (found.size >= max) return undefined;
    const m = /^([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')\s*/.exec(rest);
    if (!m) return undefined;
    const name = m[1] as string;
    const value = decodeXmlText(m[2] ?? m[3] ?? '');
    if (found.has(name) || value === undefined) return undefined;
    found.set(name, value);
    rest = rest.slice(m[0].length);
  }
  return found;
}

/** The index of the `>` ending the tag opened at `lt`, skipping quoted attribute values; -1 when it never ends. */
function tagEnd(text: string, lt: number): number {
  let quote = '';
  for (let i = lt + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

type Open = { name: string; attributes: Map<string, string>; children: (XmlNode | string)[] };
type Reader = { readonly text: string; readonly limits: XmlLimits; readonly stack: Open[]; nodes: number; readonly start: number };

const BOM = String.fromCharCode(0xfeff);
const current = (r: Reader): Open => r.stack.at(-1) as Open;

/** Character data before `lt`: only whitespace outside the root. False when malformed. */
function readText(r: Reader, chunk: string): boolean {
  if (chunk === '') return true;
  const decoded = decodeXmlText(chunk);
  if (decoded === undefined) return false;
  if (r.stack.length === 1) return decoded.trim() === '';
  current(r).children.push(decoded);
  return true;
}

/** A comment, CDATA section or the leading XML declaration at `lt`: the index after it, -1 when refused. */
function readSpecial(r: Reader, lt: number): number {
  const { text } = r;
  if (text.startsWith('<!--', lt)) {
    const end = text.indexOf('-->', lt + 4);
    return end < 0 ? -1 : end + 3;
  }
  if (text.startsWith('<![CDATA[', lt)) {
    const end = text.indexOf(']]>', lt + 9);
    if (end < 0 || r.stack.length === 1) return -1;
    current(r).children.push(text.slice(lt + 9, end));
    return end + 3;
  }
  if (text.startsWith('<?', lt)) {
    // only the leading XML declaration; no other instruction is accepted
    const end = text.indexOf('?>', lt);
    return end < 0 || lt !== r.start || !/^<\?xml[\s?]/.test(text.slice(lt, end + 2)) ? -1 : end + 2;
  }
  return -1; // a doctype or entity declaration
}

function closeTag(r: Reader, tag: string): boolean {
  const open = r.stack.pop();
  if (!open || r.stack.length === 0 || open.name !== tag.slice(1).trim()) return false;
  current(r).children.push(open);
  return true;
}

function openTag(r: Reader, tag: string): boolean {
  const selfClosing = tag.endsWith('/');
  const inner = selfClosing ? tag.slice(0, -1) : tag;
  const name = NAME.exec(inner)?.[0];
  const attributes = name === undefined ? undefined : attributesOf(inner.slice(name.length), r.limits.maxAttributes);
  if (!attributes || ++r.nodes > r.limits.maxNodes || r.stack.length > r.limits.maxDepth) return false;
  if (r.stack.length === 1 && (r.stack[0] as Open).children.length > 0) return false; // a second root
  const node: Open = { name: name as string, attributes, children: [] };
  if (selfClosing) current(r).children.push(node);
  else r.stack.push(node);
  return true;
}

/** The markup at `lt`: the index after it, -1 when refused. */
function readMarkup(r: Reader, lt: number): number {
  if (r.text.startsWith('<!', lt) || r.text.startsWith('<?', lt)) return readSpecial(r, lt);
  const end = tagEnd(r.text, lt);
  if (end < 0) return -1;
  const tag = r.text.slice(lt + 1, end);
  return (tag.startsWith('/') ? closeTag(r, tag) : openTag(r, tag)) ? end + 1 : -1;
}

/** Read every node into the reader; false when anything is refused. */
function readAll(r: Reader): boolean {
  let at = r.start;
  while (at < r.text.length) {
    const lt = r.text.indexOf('<', at);
    if (!readText(r, r.text.slice(at, lt < 0 ? r.text.length : lt))) return false;
    if (lt < 0) return true;
    at = readMarkup(r, lt);
    if (at < 0) return false;
  }
  return true;
}

/** Read `text` into its single root element, or undefined when it is not strictly well formed within `limits`. */
export function readXml(text: string, limits: XmlLimits): XmlNode | undefined {
  if (typeof text !== 'string' || text.length > limits.maxChars) return undefined;
  const top: Open = { name: '#document', attributes: new Map(), children: [] };
  const r: Reader = { text, limits, stack: [top], nodes: 0, start: text.startsWith(BOM) ? 1 : 0 };
  if (!readAll(r)) return undefined;
  const root = top.children[0];
  return r.stack.length === 1 && top.children.length === 1 && typeof root !== 'string' ? (root as XmlNode) : undefined;
}

/** The element children of `node`, optionally only those named `name`. */
export const elements = (node: XmlNode, name?: string): XmlNode[] =>
  node.children.filter((c): c is XmlNode => typeof c !== 'string' && (name === undefined || c.name === name));

/** The text content of `node`. */
export const textOf = (node: XmlNode): string => node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

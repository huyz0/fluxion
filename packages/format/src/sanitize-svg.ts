// sanitizeSvg (NFR-SEC-001, ADR-0150, M7.23): untrusted SVG text in, SVG text that can do nothing out. Not a
// denylist over a parsed DOM: the text is tokenised by a small tolerant XML reader, and a new document is built from
// the tokens that an allowlist names (elements, attributes, style properties) with every value checked, so what the
// reader misreads is dropped and not passed on. Scripts, event handlers, `foreignObject`, links, images, styles and
// anything external never survive; a reference may only point at an id of the same file. Pure: no DOM, no parser
// dependency, the same output in Node and in the browser.

/**
 * The most text that is read; a larger file is refused (it is a clipboard or a drop, not a document).
 *
 * @public
 */
export const MAX_SVG_CHARS: number = 2 * 1024 * 1024;

/** The deepest element nesting that is kept (and the most elements read). */
const MAX_DEPTH = 64;
const MAX_NODES = 20_000;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The elements that are kept, with the attributes each may carry (besides the presentation attributes). */
const ELEMENTS: { readonly [name: string]: readonly string[] } = {
  svg: ['viewBox', 'width', 'height', 'preserveAspectRatio', 'x', 'y'],
  g: ['transform'],
  defs: [],
  symbol: ['viewBox', 'preserveAspectRatio'],
  use: ['href', 'xlink:href', 'x', 'y', 'width', 'height', 'transform'],
  path: ['d', 'transform', 'pathLength'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'transform'],
  circle: ['cx', 'cy', 'r', 'transform'],
  ellipse: ['cx', 'cy', 'rx', 'ry', 'transform'],
  line: ['x1', 'y1', 'x2', 'y2', 'transform'],
  polyline: ['points', 'transform'],
  polygon: ['points', 'transform'],
  text: ['x', 'y', 'dx', 'dy', 'transform', 'text-anchor', 'textLength'],
  tspan: ['x', 'y', 'dx', 'dy', 'text-anchor'],
  title: [],
  desc: [],
  linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
  radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'href', 'xlink:href'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
  clipPath: ['clipPathUnits', 'transform'],
  mask: ['maskUnits', 'maskContentUnits', 'x', 'y', 'width', 'height'],
  marker: ['markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'viewBox', 'preserveAspectRatio'],
};

/** The elements whose text is kept. */
const TEXTUAL = new Set(['text', 'tspan', 'title', 'desc']);

/** The presentation attributes any kept element may carry, which a `style` may set too. */
const PRESENTATION = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-decoration',
  'visibility',
  'display',
  'stop-color',
  'stop-opacity',
];

/** The attributes any kept element may carry. */
const COMMON = new Set([...PRESENTATION, 'id', 'class', 'style']);

/** The CSS properties a `style` attribute may set. */
const STYLE_PROPERTIES = new Set(PRESENTATION);

/** The attributes that name another element (only `#id` of this file) rather than carry a value. */
const REFERENCES = new Set(['href', 'xlink:href']);

const ENTITIES: { readonly [name: string]: string } = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** `text` with character references and the five predefined entities replaced (any other entity is dropped). */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, (_all, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body] ?? '';
  });
}

/** `text` made safe to put between tags or inside a double-quoted attribute. */
const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Whether `c` is a control character or white space (what a browser ignores inside a scheme like `java\tscript:`). */
const ignorable = (c: string): boolean => {
  const code = c.charCodeAt(0);
  return code <= 32 || (code >= 0x7f && code <= 0x9f);
};

/** Whether every `url(` in `flat` names an id of this file. */
const FUNCTIONS = new Set([
  'url',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'translate',
  'translatex',
  'translatey',
  'rotate',
  'scale',
  'scalex',
  'scaley',
  'matrix',
  'skewx',
  'skewy',
]);

/**
 * Whether every function a value calls is on the list (colours and transforms, and `url()` of an id of this file); anything
 * else (`image-set`, `image`, `src`, `var`, `calc`, …) may load or leak.
 */
const callsAreSafe = (flat: string): boolean =>
  [...flat.matchAll(/([a-z][a-z0-9-]*)\(/g)].every(
    (m) => FUNCTIONS.has(m[1] as string) && (m[1] !== 'url' || /^['"]?#/.test(flat.slice((m.index ?? 0) + (m[0] as string).length))),
  );

/** A value that carries nothing executable or external: no script scheme, no data, no markup, no CSS escape, no protocol-relative URL, only the listed functions, `url(#id)` only. */
function safeValue(value: string): boolean {
  const flat = [...value]
    .filter((c) => !ignorable(c))
    .join('')
    .toLowerCase();
  if (/(javascript|vbscript|data|file|https?|ftp|blob):/.test(flat) || /@import|<|\\|\/\*|\/\//.test(flat)) return false;
  return callsAreSafe(flat);
}

/** `style` filtered to the allowed properties with safe values; empty when nothing is left. */
function safeStyle(style: string): string {
  return style
    .split(';')
    .flatMap((declaration) => {
      const at = declaration.indexOf(':');
      if (at < 0) return [];
      const property = declaration.slice(0, at).trim().toLowerCase();
      const value = declaration.slice(at + 1).trim();
      return STYLE_PROPERTIES.has(property) && value !== '' && safeValue(value) ? [`${property}:${value}`] : [];
    })
    .join(';');
}

/** One attribute kept as `name="value"` text, or nothing. */
function keepAttribute(element: string, name: string, raw: string): string | undefined {
  if (!(COMMON.has(name) || (ELEMENTS[element] ?? []).includes(name))) return undefined;
  const value = decode(raw).trim();
  if (REFERENCES.has(name)) return /^#[A-Za-z_][\w.:-]*$/.test(value) ? `href="${escapeText(value)}"` : undefined;
  if (name === 'style') {
    const style = safeStyle(value);
    return style === '' ? undefined : `style="${escapeText(style)}"`;
  }
  return safeValue(value) ? `${name}="${escapeText(value)}"` : undefined;
}

/** A node of the tree the reader builds. */
type Node = { readonly name: string; readonly attributes: ReadonlyMap<string, string>; readonly children: (Node | string)[] };

/** The attributes of the tag text `body` (after the name), read tolerantly: quoted or bare values, repeats ignored. */
function readAttributes(body: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of body.matchAll(pattern)) {
    const name = m[1] as string;
    if (!found.has(name) && /^[A-Za-z_][\w:.-]*$/.test(name)) found.set(name, m[2] ?? m[3] ?? m[4] ?? '');
  }
  return found;
}

/** The index after the markup that starts at `at` and ends with `close`, or the end of the text when it never does. */
const skipTo = (text: string, close: string, at: number): number => {
  const end = text.indexOf(close, at);
  return end < 0 ? text.length : end + close.length;
};

/** The state of the reader: the open elements, how many opened beyond the depth cap (read and dropped), the elements counted, the doctypes, too-deep elements and unread tail dropped. */
type Reading = { readonly stack: Node[]; overflow: number; nodes: number; lost: number };

/** Add `child` to the open element. */
const add = (reading: Reading, child: Node | string): void => {
  (reading.stack.at(-1) as Node).children.push(child);
};

/** The start tag whose text (between `<` and `>`) is `tag`, opened or, when it closes itself, only added. */
function openTag(reading: Reading, tag: string): void {
  const selfClosing = tag.endsWith('/');
  const match = /^([A-Za-z_][\w:.-]*)([\s\S]*)$/.exec(selfClosing ? tag.slice(0, -1) : tag);
  if (match === null) return;
  reading.nodes++;
  if (reading.stack.length >= MAX_DEPTH) {
    // too deep to keep: read and dropped, so its end tag is not taken for an ancestor's
    reading.lost++;
    if (!selfClosing) reading.overflow++;
    return;
  }
  const node: Node = { name: match[1] as string, attributes: readAttributes(match[2] ?? ''), children: [] };
  add(reading, node);
  if (!selfClosing) reading.stack.push(node);
}

/** An end tag: the open element closes, unless it closes one that was too deep to keep. */
function closeTag(reading: Reading): void {
  if (reading.overflow > 0) reading.overflow--;
  else if (reading.stack.length > 1) reading.stack.pop();
}

/** A doctype or instruction at `lt`, skipped: the index after it; a doctype may hold an internal subset in brackets, with `>` inside it. */
function skipDeclaration(text: string, lt: number): number {
  const bracket = text.indexOf('[', lt);
  return text.startsWith('<!DOCTYPE', lt) && bracket >= 0 && bracket < text.indexOf('>', lt) ? skipTo(text, ']>', lt) : skipTo(text, '>', lt);
}

/** A comment, CDATA section, doctype or instruction at `lt` read into `reading`: the index after it; undefined when `lt` starts a tag. */
function readSpecial(text: string, lt: number, reading: Reading): number | undefined {
  if (text.startsWith('<!--', lt)) return skipTo(text, '-->', lt + 4);
  if (text.startsWith('<![CDATA[', lt)) {
    const end = text.indexOf(']]>', lt + 9);
    add(reading, text.slice(lt + 9, end < 0 ? text.length : end));
    return end < 0 ? text.length : end + 3;
  }
  if (!text.startsWith('<!', lt) && !text.startsWith('<?', lt)) return undefined;
  // a doctype or entity declaration is a thing the allowlist removes; an `<?xml ?>` line is not
  if (text.startsWith('<!', lt)) reading.lost++;
  return skipDeclaration(text, lt);
}

/** The markup that starts at `lt` (a `<`) read into `reading`; the index after it. */
function readMarkup(text: string, lt: number, reading: Reading): number {
  const special = readSpecial(text, lt, reading);
  if (special !== undefined) return special;
  const end = skipTo(text, '>', lt);
  if (text[lt + 1] === '/') closeTag(reading);
  else openTag(reading, text.slice(lt + 1, text.endsWith('>', end) ? end - 1 : end));
  return end;
}

/** Read `text` into a tree under a virtual root: elements and text only; comments, instructions, doctypes and entities are dropped. */
function read(text: string): { readonly node: Node; readonly lost: number } {
  const root: Node = { name: '#root', attributes: new Map(), children: [] };
  const reading: Reading = { stack: [root], overflow: 0, nodes: 0, lost: 0 };
  let at = 0;
  while (at < text.length && reading.nodes <= MAX_NODES) {
    const lt = text.indexOf('<', at);
    const chunk = text.slice(at, lt < 0 ? text.length : lt);
    if (chunk !== '') add(reading, decode(chunk));
    if (lt < 0) break;
    at = readMarkup(text, lt, reading);
  }
  // the node cap stopped the read with text left: whatever follows is dropped unread
  if (reading.nodes > MAX_NODES && at < text.length) reading.lost++;
  return { node: root, lost: reading.lost };
}

/** What the sanitizer took out: elements off the allowlist, attributes and style declarations dropped, a doctype. */
type Removed = { count: number };

/** A namespace declaration: the file's own `xmlns` is replaced by ours, so dropping it takes nothing out. */
const isNamespaceDeclaration = (name: string): boolean => name === 'xmlns' || name.startsWith('xmlns:');

/** How many declarations a `style` value holds. */
const declarations = (style: string): number => style.split(';').filter((d) => d.trim() !== '').length;

/** Whether the attribute `name` of an element was lost: not kept at all, or a repeat of one already kept (a namespace declaration is replaced by ours, so it never counts). */
const lostAttribute = (name: string, written: string | undefined, keptText: string | undefined): boolean =>
  !isNamespaceDeclaration(name) && (written === undefined || keptText !== written);

/** The attributes of `node` that stay, as written text: `href` and `xlink:href` are both written `href` (the first kept stays); `removed` counts the rest. */
function keptAttributes(node: Node, removed: Removed): string[] {
  const kept = new Map<string, string>();
  for (const [name, value] of node.attributes) {
    const written = keepAttribute(node.name, name, value);
    const as = name === 'xlink:href' ? 'href' : name;
    if (written !== undefined && !kept.has(as)) kept.set(as, written);
    if (lostAttribute(name, written, kept.get(as))) removed.count++;
    if (written !== undefined && name === 'style' && declarations(decode(value)) > declarations(written)) removed.count++;
  }
  return [...kept.values()];
}

/** The kept markup of `node` (an element on the allowlist; its text only where text is kept), or nothing; `removed` counts what was dropped. */
function write(node: Node | string, textual: boolean, removed: Removed): string {
  if (typeof node === 'string') return textual ? escapeText(node) : '';
  if (!Object.hasOwn(ELEMENTS, node.name)) {
    removed.count++;
    return '';
  }
  const attributes = keptAttributes(node, removed);
  const inside = node.children.map((c) => write(c, TEXTUAL.has(node.name), removed)).join('');
  return `<${node.name}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}>${inside}</${node.name}>`;
}

/**
 * `input`, an untrusted SVG file's text, rebuilt as an SVG that holds only what an allowlist names: the shapes, text,
 * gradients, clip paths, masks, markers and `use` of this file's own ids, with safe values, in the SVG namespace.
 * Scripts, event handlers, `foreignObject`, links, images, styles, entities, comments, instructions and every external
 * reference are dropped. Undefined when the text is too large or holds no `svg` root.
 *
 * @public
 */
export function sanitizeSvg(input: string): string | undefined {
  return inspectSvg(input)?.svg;
}

/**
 * What `inspectSvg` found: the sanitized SVG and how much was taken out to make it.
 *
 * @public
 */
export type SvgInspection = {
  /** The sanitized SVG, as `sanitizeSvg` gives it. */
  readonly svg: string;
  /** How many elements, attributes, style declarations and doctypes the allowlist removed (a file's own `xmlns` declarations, comments and instructions do not count). */
  readonly removed: number;
};

/**
 * `sanitizeSvg`, with a count of what it removed: zero means the file held nothing outside the allowlist, so drawing it changes only its
 * spelling (self-closed tags, indentation). Undefined when the text is too large or holds no `svg` root.
 *
 * @public
 */
export function inspectSvg(input: string): SvgInspection | undefined {
  if (input.length > MAX_SVG_CHARS) return undefined;
  const reading = read(input);
  const roots = reading.node.children.filter((c): c is Node => typeof c !== 'string');
  const root = roots.find((c) => c.name === 'svg');
  if (root === undefined) return undefined;
  // elements outside the one `svg` root (before it, after it, a second root) are dropped with everything in them
  const removed: Removed = { count: reading.lost + roots.length - 1 };
  // the namespace is ours: the file's own xmlns declarations are not on the allowlist, and the root gets the SVG one
  const svg = write(root, false, removed).replace('<svg', `<svg xmlns="${SVG_NS}"`);
  return { svg, removed: removed.count };
}

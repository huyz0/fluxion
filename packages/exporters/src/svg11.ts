// What an exported file may contain (ADR-0056 §Confirmation, FR-EXP-004): the SVG 1.1 elements and attributes an export uses, and a
// check of a file against them and against the rules a standalone, Inkscape-readable file keeps: well-formed XML under one root
// `<svg version="1.1">`; no `foreignObject`, `script`, event attribute, `var(`, `transform` on `<svg>` or `feDropShadow`; a reference
// outside `<a>` is a `data:` URL or a fragment; ids are unique XML names and every `url(#…)` and `#…` names one. Pure, so the
// tests and a host can run it.

/** The SVG 1.1 elements an export may write (SVG 1.1 Second Edition, Appendix A, without script, foreignObject and animation). */
export const SVG11_ELEMENTS: ReadonlySet<string> = new Set([
  'a',
  'circle',
  'clipPath',
  'defs',
  'desc',
  'ellipse',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
  'filter',
  'g',
  'image',
  'line',
  'linearGradient',
  'marker',
  'mask',
  'metadata',
  'path',
  'pattern',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'style',
  'svg',
  'symbol',
  'text',
  'textPath',
  'title',
  'tspan',
  'use',
]);

/** The SVG 1.1 attributes an export may write: core, presentation, and the element-specific ones of the elements above. */
export const SVG11_ATTRIBUTES: ReadonlySet<string> = new Set([
  // core and structure
  'id',
  'class',
  'style',
  'xml:space',
  'xml:lang',
  'version',
  'baseProfile',
  'width',
  'height',
  'x',
  'y',
  'viewBox',
  'preserveAspectRatio',
  'transform',
  'xlink:href',
  'xlink:title',
  'target',
  // geometry
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'd',
  'points',
  'pathLength',
  // presentation
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'stroke-opacity',
  'opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'overflow',
  'display',
  'visibility',
  'color',
  'stop-color',
  'stop-opacity',
  'flood-color',
  'flood-opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'text-anchor',
  'text-decoration',
  'text-rendering',
  'dominant-baseline',
  'baseline-shift',
  'letter-spacing',
  'word-spacing',
  'shape-rendering',
  'color-interpolation-filters',
  // gradients, patterns, clips, masks, markers, filters, text
  'offset',
  'gradientUnits',
  'gradientTransform',
  'spreadMethod',
  'patternUnits',
  'patternContentUnits',
  'patternTransform',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
  'markerUnits',
  'markerWidth',
  'markerHeight',
  'refX',
  'refY',
  'orient',
  'filterUnits',
  'primitiveUnits',
  'in',
  'in2',
  'result',
  'stdDeviation',
  'radius',
  'tableValues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'mode',
  'values',
  'type',
  'dx',
  'dy',
  'rotate',
  'textLength',
  'lengthAdjust',
  'startOffset',
]);

/** One element of a parsed file. */
type Node = { readonly name: string; readonly attrs: ReadonlyMap<string, string>; readonly parent: Node | undefined };

const NAME = /^[A-Za-z_][\w.-]*(:[A-Za-z_][\w.-]*)?$/;
const XML_ID = /^[A-Za-z_][\w.-]*$/;
const ENTITY = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/** The attributes of a start tag, or the first one that is repeated or holds `<` or a bare `&`. */
function attributesOf(raw: string): Map<string, string> | string {
  const attrs = new Map<string, string>();
  for (const a of raw.matchAll(/([^\s=]+)="([^"]*)"/g)) {
    const [name, value] = [a[1] as string, a[2] as string];
    if (attrs.has(name) || ENTITY.test(value) || value.includes('<')) return name;
    attrs.set(name, value);
  }
  return attrs;
}

/** Elements read one tag at a time, with the stack of those still open. */
class Reader {
  readonly nodes: Node[] = [];
  readonly #open: Node[] = [];

  /** Read the tag `close`/`name`/`raw`/`selfClose`; the problem, if it has one. */
  tag(close: boolean, name: string, raw: string, selfClose: boolean): string | undefined {
    if (!NAME.test(name)) return `bad element name ${name}`;
    if (close) return this.#open.pop()?.name === name ? undefined : `unbalanced </${name}>`;
    const attrs = attributesOf(raw);
    if (typeof attrs === 'string') return `bad attribute ${attrs} on ${name}`;
    const node = { name, attrs, parent: this.#open.at(-1) };
    if (node.parent === undefined && this.nodes.length > 0) return 'more than one root';
    this.nodes.push(node);
    if (!selfClose) this.#open.push(node);
    return undefined;
  }

  /** Whether every element was closed. */
  get closed(): boolean {
    return this.#open.length === 0;
  }
}

/** The elements of `xml` in document order with their attributes, or the first well-formedness problem. */
export function parseXml(xml: string): { readonly nodes: readonly Node[] } | { readonly error: string } {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const reader = new Reader();
  let at = 0;
  for (const m of body.matchAll(/<(\/?)([^\s/>]+)((?:\s+[^\s=]+="[^"]*")*)\s*(\/?)>|<!--[\s\S]*?-->/g)) {
    const text = body.slice(at, m.index);
    if (text.includes('<') || ENTITY.test(text)) return { error: `bad text at ${at}` };
    at = (m.index ?? 0) + m[0].length;
    if (m[0].startsWith('<!--')) continue;
    const problem = reader.tag(m[1] === '/', m[2] as string, m[3] ?? '', m[4] === '/');
    if (problem !== undefined) return { error: problem };
  }
  if (!reader.closed || body.slice(at).trim() !== '') return { error: 'unclosed elements or trailing text' };
  return { nodes: reader.nodes };
}

/** Whether `node` lies inside an `<a>` (where a link may point outside the file). */
const inLink = (node: Node): boolean => (node.parent === undefined ? false : node.parent.name === 'a' || inLink(node.parent));

/** The problem of a reference `value` of `node`: a fragment naming nothing, or (outside a link) anything but a `data:` URL. */
function hrefProblem(node: Node, value: string, ids: ReadonlySet<string>): string | undefined {
  const bad = value.startsWith('#') ? !ids.has(value.slice(1)) : !value.startsWith('data:') && !inLink(node);
  return bad ? `<${node.name}> refers to ${value.slice(0, 40)}` : undefined;
}

/** Whether `node` is a fluxion element in `<metadata>`, whose attributes are its own namespace's, not SVG's. */
const foreignNode = (node: Node): boolean => node.name.startsWith('fluxion:') && node.parent?.name === 'metadata';

/** The problems of one attribute of `node`. */
function attributeProblem(node: Node, [name, value]: readonly [string, string], ids: ReadonlySet<string>): string[] {
  const foreign = foreignNode(node) || name.startsWith('xmlns') || name.startsWith('fluxion:');
  const out = [
    !foreign && !SVG11_ATTRIBUTES.has(name) ? `<${node.name}> has ${name}, not an SVG 1.1 attribute` : undefined,
    /^on/i.test(name) ? `<${node.name}> has the event attribute ${name}` : undefined,
    value.includes('var(') ? `<${node.name}> ${name} uses var()` : undefined,
    name === 'href' || name === 'xlink:href' ? hrefProblem(node, value, ids) : undefined,
    ...[...value.matchAll(/url\(#([^)]+)\)/g)].map((r) => (ids.has(r[1] as string) ? undefined : `url(#${r[1]}) names no element`)),
  ];
  return out.filter((p): p is string => p !== undefined);
}

/** The problems of one element: its name and its attributes. */
function nodeProblems(node: Node, ids: ReadonlySet<string>): string[] {
  return [
    ...(foreignNode(node) || SVG11_ELEMENTS.has(node.name) ? [] : [`<${node.name}> is not an SVG 1.1 element an export writes`]),
    ...(node.name === 'svg' && node.attrs.has('transform') ? ['an <svg> has a transform (not SVG 1.1)'] : []),
    ...[...node.attrs].flatMap((a) => attributeProblem(node, a, ids)),
  ];
}

/** The ids of `nodes`, and the problem of each that is no XML name or repeats one. */
function idsOf(nodes: readonly Node[]): { readonly ids: ReadonlySet<string>; readonly problems: readonly string[] } {
  const ids = new Set<string>();
  const problems: string[] = [];
  for (const id of nodes.flatMap((n) => n.attrs.get('id') ?? [])) {
    if (!XML_ID.test(id) || ids.has(id)) problems.push(`id "${id}" is not a unique XML name`);
    ids.add(id);
  }
  return { ids, problems };
}

/**
 * The problems of `xml` as a standalone SVG 1.1 export (none: it passes).
 *
 * @public
 */
export function svg11Problems(xml: string): readonly string[] {
  const parsed = parseXml(xml);
  if ('error' in parsed) return [`not well-formed XML: ${parsed.error}`];
  const [root] = parsed.nodes;
  const rooted = root?.name === 'svg' && root.attrs.get('version') === '1.1' && root.attrs.get('xmlns') === 'http://www.w3.org/2000/svg';
  const { ids, problems } = idsOf(parsed.nodes);
  return [
    ...(rooted ? [] : ['the root is not <svg version="1.1" xmlns="http://www.w3.org/2000/svg">']),
    ...problems,
    ...parsed.nodes.flatMap((n) => nodeProblems(n, ids)),
  ];
}

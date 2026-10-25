// Shared decoded-value policy (NFR-SEC-001, FR-LIB-004, ADR-0177). XML parsing/escaping stays in format.

/** Resource bounds shared by SVG readers and paint-tree validators. @public */
export const SVG_POLICY_LIMITS: Readonly<{
  /** Maximum input text length, measured in UTF-16 code units. */
  maxChars: number;
  /** Maximum retained element nesting depth. */
  maxDepth: number;
  /** Maximum element-count budget used by the SVG reader. */
  maxNodes: number;
}> = Object.freeze({
  maxChars: 2 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 20_000,
});

/** A normalized, decoded attribute accepted by the SVG policy; not serialized markup. @public */
export type CheckedSvgAttribute = {
  /** Accepted attribute name; xlink:href is normalized to href. */
  readonly name: string;
  /** Decoded, trimmed and policy-filtered value, not escaped markup. */
  readonly value: string;
};

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

/** Whether an element belongs to the SVG allowlist. @public */
export function isSvgElement(name: string): boolean {
  return Object.hasOwn(ELEMENTS, name);
}

/** Whether an allowed SVG element retains text children. @public */
export function isSvgTextElement(name: string): boolean {
  return TEXTUAL.has(name);
}

/**
 * Check an already decoded value under the shared SVG allowlist, normalizing local references and styles.
 * Undefined means rejected. This primitive does not validate geometry, graph references or traversal bounds;
 * consumers must validate the complete bounded paint tree before rendering. XML decoding/escaping belongs to the caller.
 * @public
 */
export function checkedSvgAttribute(element: string, name: string, decodedValue: string): CheckedSvgAttribute | undefined {
  if (!isSvgElement(element) || !(COMMON.has(name) || (ELEMENTS[element] ?? []).includes(name))) return undefined;
  const value = decodedValue.trim();
  if (REFERENCES.has(name)) return /^#[A-Za-z_][\w.:-]*$/.test(value) ? { name: 'href', value } : undefined;
  if (name === 'style') {
    const style = safeStyle(value);
    return style === '' ? undefined : { name, value: style };
  }
  return safeValue(value) ? { name, value } : undefined;
}

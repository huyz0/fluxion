import { checkedSvgAttribute, isCssColor, isSvgElement, isSvgTextElement, SVG_POLICY_LIMITS, type SvgArtworkNode } from '@fluxion/schema';

const ID = /^[A-Za-z_][\w.:-]*$/;
const PAINT = new Set(['fill', 'stroke', 'stop-color']);
const URL = /url\(\s*(['"]?)#([A-Za-z_][\w.:-]*)\1\s*\)/gi;
export type ArtworkReference = { readonly id: string; readonly targets: readonly string[] };
const GRAPHICS = ['svg', 'symbol', 'g', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan'];

function styleAttributes(value: string): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const declaration of value.split(';')) {
    if (!declaration.trim()) continue;
    const colon = declaration.indexOf(':');
    if (colon < 0) return undefined;
    const key = declaration.slice(0, colon).trim().toLowerCase();
    const text = declaration.slice(colon + 1).trim();
    const checked = checkedSvgAttribute('g', 'style', `${key}:${text}`);
    if (!checked || checked.value !== `${key}:${text}` || Object.hasOwn(result, key)) return undefined;
    result[key] = text;
  }
  return Object.keys(result).length ? result : undefined;
}

function decodedAttributes(node: SvgArtworkNode): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name === 'style') continue;
    const checked = checkedSvgAttribute(node.name, name, value);
    if (!checked || Object.hasOwn(result, checked.name)) return undefined;
    result[checked.name] = checked.value;
  }
  return result;
}

/** Validate attributes and style independently; CSS precedence cannot hide unsafe data. */
export function artworkAttributes(node: SvgArtworkNode): readonly Record<string, string>[] | undefined {
  if (!isSvgElement(node.name) || node.children.some((child) => typeof child === 'string' && !isSvgTextElement(node.name))) return undefined;
  const attributes = decodedAttributes(node);
  if (!attributes) return undefined;
  const { id } = attributes;
  if (id !== undefined && !ID.test(id)) return undefined;
  const { style: rawStyle } = node.attributes;
  const style = rawStyle === undefined ? {} : styleAttributes(rawStyle);
  return style ? [attributes, style] : undefined;
}

function targets(node: string, key: string): readonly string[] | undefined {
  if (key === 'href') return node === 'use' ? GRAPHICS : ['linearGradient', 'radialGradient'];
  if (key === 'fill' || key === 'stroke') return ['linearGradient', 'radialGradient'];
  if (key === 'clip-path') return ['clipPath'];
  if (key === 'mask') return ['mask'];
  if (['marker-start', 'marker-mid', 'marker-end'].includes(key)) return ['marker'];
  return undefined;
}

function validPaint(value: string): boolean {
  return isCssColor(value) || ['none', 'currentcolor', 'inherit'].includes(value.toLowerCase());
}

function collectUrls(value: string, kinds: readonly string[] | undefined): ArtworkReference[] | undefined {
  const references: ArtworkReference[] = [];
  for (const match of value.matchAll(URL)) {
    if (!kinds || references.length >= SVG_POLICY_LIMITS.maxNodes) return undefined;
    references.push({ id: match[2] ?? '', targets: kinds });
  }
  return references;
}
function validReferencedValue(key: string, remainder: string, count: number): boolean {
  if (count > 1 && key !== 'mask') return false;
  if (!remainder) return true;
  return (key === 'fill' || key === 'stroke') && validPaint(remainder);
}
function referencesFor(node: string, key: string, value: string): ArtworkReference[] | undefined {
  if (key === 'href') return [{ id: value.slice(1), targets: targets(node, key) ?? [] }];
  const references = collectUrls(value, targets(node, key));
  if (!references) return undefined;
  const remainder = value.replace(URL, '').trim();
  if (/url\s*\(/i.test(remainder)) return undefined;
  if (!references.length) return PAINT.has(key) && !validPaint(value) ? undefined : [];
  return validReferencedValue(key, remainder, references.length) ? references : undefined;
}

/** Every local reference, or undefined for an invalid value/target role. */
export function artworkReferences(node: string, attributes: Readonly<Record<string, string>>): ArtworkReference[] | undefined {
  const references: ArtworkReference[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    const next = referencesFor(node, key, value);
    if (!next) return undefined;
    for (const reference of next) references.push(reference);
  }
  return references;
}

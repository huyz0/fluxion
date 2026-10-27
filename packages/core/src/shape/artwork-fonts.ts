import { SVG_POLICY_LIMITS, type SvgArtworkNode } from '@fluxion/schema';
/** Exact face identity used by checked SVG artwork normalization. @public */
export type SvgArtworkFont = {
  /** Original source family, without fallback guessing. */
  readonly family: string;
  /** Static weight from 100 through 900. */
  readonly weight: number;
  /** Static style. */
  readonly style: 'normal' | 'italic';
  /** SHA-256 of the exact font bytes; this pure function does not acquire bytes. */
  readonly sha256: string;
};

/** Available exact faces and optional default for checked artwork. @public */
export type SvgArtworkFontOptions = {
  /** Available descriptors; duplicate face keys or byte hashes are refused. */
  readonly fonts?: readonly SvgArtworkFont[];
  /** Exact hash used when a source omits its family. */
  readonly defaultFont?: string;
};

type Face = { family: string; weight: string; style: string };
type State = { readonly available: Map<string, SvgArtworkFont>; readonly used: Map<string, SvgArtworkFont>; error?: string };
const key = (f: Face) => `${f.family.toLowerCase()}\n${f.weight}\n${f.style}`;
const fontKey = (f: SvgArtworkFont) => key({ family: f.family, weight: String(f.weight), style: f.style });
const css = (node: SvgArtworkNode): Record<string, string> =>
  Object.fromEntries(
    (node.attributes['style'] ?? '')
      .split(';')
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf(':');
        return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
      }),
  );
function inherited(node: SvgArtworkNode, parent: Face): Face {
  const a = { ...node.attributes, ...css(node) };
  const weight = a['font-weight'] ?? parent.weight;
  return {
    family: (a['font-family'] ?? parent.family).replace(/^(["'])(.*)\1$/, '$2'),
    weight: weight === 'normal' ? '400' : weight === 'bold' ? '700' : weight,
    style: a['font-style'] ?? parent.style,
  };
}
function supportedText(node: SvgArtworkNode): boolean {
  if (node.children.some((c) => typeof c !== 'string' || !/^[\t\r\n\x20-\x7e]*$/.test(c))) return false;
  if (node.attributes['textLength'] !== undefined) return false;
  return ['x', 'y', 'dx', 'dy'].every(
    (k) => node.attributes[k] === undefined || /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(node.attributes[k] ?? ''),
  );
}
function textFace(node: SvgArtworkNode, face: Face, state: State): SvgArtworkFont | undefined {
  if (!supportedText(node)) {
    state.error = 'unsupported-text-profile';
    return undefined;
  }
  const found = state.available.get(key(face));
  if (!found) {
    state.error = 'missing-exact-font-face';
    return undefined;
  }
  state.used.set(found.sha256, found);
  return found;
}
function normalized(node: SvgArtworkNode, parent: Face, state: State): SvgArtworkNode {
  const face = inherited(node, parent);
  if (node.name === 'tspan') state.error = 'unsupported-text-profile';
  const selected = node.name === 'text' && node.children.some((c) => typeof c === 'string' && c.trim()) ? textFace(node, face, state) : undefined;
  const attributes = selected
    ? { ...node.attributes, 'font-family': selected.family, 'font-weight': String(selected.weight), 'font-style': selected.style }
    : node.attributes;
  return { ...node, attributes, children: node.children.map((c) => (typeof c === 'string' ? c : normalized(c, face, state))) };
}
function catalog(fonts: readonly SvgArtworkFont[]): Map<string, SvgArtworkFont> | undefined {
  if (fonts.length > SVG_POLICY_LIMITS.maxNodes) return undefined;
  const faces = new Map<string, SvgArtworkFont>();
  const hashes = new Set<string>();
  for (const f of fonts) {
    if (
      f.family.length > 256 ||
      !f.family.trim() ||
      !Number.isInteger(f.weight) ||
      f.weight < 100 ||
      f.weight > 900 ||
      !['normal', 'italic'].includes(f.style) ||
      !/^[a-f0-9]{64}$/.test(f.sha256)
    )
      return undefined;
    if (faces.has(fontKey(f)) || hashes.has(f.sha256)) return undefined;
    faces.set(fontKey(f), { ...f });
    hashes.add(f.sha256);
  }
  return faces;
}
function descendants(root: SvgArtworkNode): SvgArtworkNode[] {
  const nodes = [root];
  for (let i = 0; i < nodes.length; i++) {
    for (const child of nodes[i]?.children ?? []) if (typeof child !== 'string') nodes.push(child);
  }
  return nodes;
}
function referencedText(root: SvgArtworkNode): boolean {
  const nodes = descendants(root);
  const ids = new Map(nodes.filter((node) => node.attributes['id'] !== undefined).map((node) => [node.attributes['id'], node]));
  return nodes.some((node) => {
    if (node.name !== 'use') return false;
    const target = ids.get(node.attributes['href']?.slice(1));
    return target !== undefined && descendants(target).some((child) => child.name === 'text' || child.name === 'tspan');
  });
}
/**
 * Normalize font inheritance in an already validated, bounded SVG artwork node.
 * Retain the importer's ASCII/text-reference restrictions and exact-face catalogue rules.
 * No byte acquisition, font registration or paint verification occurs here.
 * @public
 */
export function normalizeSvgArtworkFonts(
  root: SvgArtworkNode,
  options: SvgArtworkFontOptions,
): {
  /** Artwork with explicit supported text-face descriptors. */
  root: SvgArtworkNode;
  /** Exact used faces sorted by byte hash; no fonts are acquired here. */
  fonts: readonly SvgArtworkFont[];
  /** Refusal reason; an error result is not qualified artwork. */
  error?: string;
} {
  if (referencedText(root)) return { root, fonts: [], error: 'unsupported-text-reference-inheritance' };
  const available = catalog(options.fonts ?? []);
  if (!available) return { root, fonts: [], error: 'invalid-font-catalog' };
  const fallback = [...available.values()].find((f) => f.sha256 === options.defaultFont);
  if (options.defaultFont && !fallback) return { root, fonts: [], error: 'missing-default-font-face' };
  const base: Face = { family: fallback?.family ?? '', weight: String(fallback?.weight ?? 400), style: fallback?.style ?? 'normal' };
  const state: State = { available, used: new Map() };
  const checked = normalized(root, base, state);
  const attributes =
    fallback && state.used.size
      ? { 'font-family': fallback.family, 'font-weight': String(fallback.weight), 'font-style': fallback.style, ...checked.attributes }
      : checked.attributes;
  const fonts = [...state.used.values()].sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
  return { root: { ...checked, attributes }, fonts, ...(state.error ? { error: state.error } : {}) };
}

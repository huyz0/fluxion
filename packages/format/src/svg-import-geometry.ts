import type { ShapeDef } from '@fluxion/core';
import type { AnchorDef, SvgArtwork, SvgArtworkNode } from '@fluxion/schema';

const LENGTH = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i;
export function positiveLength(value: string | undefined): number | undefined {
  if (value === undefined || !LENGTH.test(value)) return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function intrinsicBox(value: string | undefined): readonly number[] | undefined {
  if (value === undefined) return undefined;
  const box = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return box.length === 4 && box.every(Number.isFinite) && Number(box[2]) > 0 && Number(box[3]) > 0 ? box : undefined;
}
function resolveSize(w: number | undefined, h: number | undefined, box: readonly number[] | undefined) {
  const bw = box?.[2];
  const bh = box?.[3];
  if (bw === undefined || bh === undefined) return { width: w, height: h };
  return { width: w ?? (h === undefined ? bw : (h / bh) * bw), height: h ?? (w === undefined ? bh : (w / bw) * bh) };
}
/** Resolve intrinsic aspect ratio when just one absolute root dimension is supplied. */
export function importViewport(root: SvgArtworkNode): SvgArtwork['viewBox'] | undefined {
  const a = root.attributes;
  if ([a['x'], a['y']].some((value) => value !== undefined && value !== '0')) return undefined;
  const box = intrinsicBox(a['viewBox']);
  if (a['viewBox'] !== undefined && box === undefined) return undefined;
  const w = positiveLength(a['width']);
  const h = positiveLength(a['height']);
  if (
    [
      ['width', w],
      ['height', h],
    ].some(([key, value]) => a[String(key)] !== undefined && value === undefined)
  )
    return undefined;
  const { width, height } = resolveSize(w, h, box);
  if (!width || !height || ![width, height, 1 / width, 1 / height].every(Number.isFinite)) return undefined;
  return { x: 0, y: 0, width, height };
}
const only = (node: SvgArtworkNode, names: readonly string[]) => Object.keys(node.attributes).every((k) => names.includes(k));
const coordinate = (value: string | undefined) => (value === undefined || value === '0' ? 0 : positiveLength(value));
type Rect = { x: number; y: number; w: number; h: number };
function exactRect(artwork: SvgArtwork): Rect | undefined {
  const { root, viewBox: v } = artwork;
  if (!only(root, ['viewBox', 'width', 'height', 'fill']) || root.children.length !== 1) return undefined;
  const box = root.attributes['viewBox']
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box && (box[0] !== 0 || box[1] !== 0 || box[2] !== v.width || box[3] !== v.height)) return undefined;
  const r = root.children[0];
  if (!r || typeof r === 'string' || r.name !== 'rect' || r.children.length || !only(r, ['x', 'y', 'width', 'height', 'fill'])) return undefined;
  if ((r.attributes['fill'] ?? root.attributes['fill']) === 'none') return undefined;
  const x = coordinate(r.attributes['x']);
  const y = coordinate(r.attributes['y']);
  const w = positiveLength(r.attributes['width']);
  const h = positiveLength(r.attributes['height']);
  return x !== undefined && y !== undefined && w && h && x + w <= v.width && y + h <= v.height
    ? { x: x / v.width, y: y / v.height, w: w / v.width, h: h / v.height }
    : undefined;
}
export function importRouting(artwork: SvgArtwork): { outline: ShapeDef['outline']; anchors: readonly AnchorDef[]; exact: boolean } {
  const rect = exactRect(artwork);
  const { x, y, w, h } = rect ?? { x: 0, y: 0, w: 1, h: 1 };
  const right = x + w;
  const bottom = y + h;
  return {
    exact: rect !== undefined,
    outline: {
      path: rect ? `M {w*${x}} {h*${y}} L {w*${right}} {h*${y}} L {w*${right}} {h*${bottom}} L {w*${x}} {h*${bottom}} Z` : 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z',
    },
    anchors: [
      { name: 'n', x: x + w / 2, y, dir: { x: 0, y: -1 } },
      { name: 'e', x: right, y: y + h / 2, dir: { x: 1, y: 0 } },
      { name: 's', x: x + w / 2, y: bottom, dir: { x: 0, y: 1 } },
      { name: 'w', x, y: y + h / 2, dir: { x: -1, y: 0 } },
    ],
  };
}

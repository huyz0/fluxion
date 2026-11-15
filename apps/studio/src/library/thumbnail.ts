// The library's preview (FR-FIL-008): the first screen drawn as its background and the boxes of its elements, small. It is a sketch of the layout, not
// a render: the studio has no way to rasterise a screen yet, and a sketch is enough to tell documents apart in a list. `thumbnailPlan` is the
// arithmetic; `renderThumbnail` puts it on a canvas and encodes `preview.webp`.
import { masterLayers, type ReadView } from '@fluxion/core';
import { type AnyRecord, isMasterScreen, type RecordId, screenSize } from '@fluxion/schema';

/**
 * Width of a thumbnail in pixels.
 *
 * @public
 */
export const THUMBNAIL_WIDTH = 320;

/**
 * One box of a thumbnail, in thumbnail pixels.
 *
 * @public
 */
export type ThumbBox = {
  /** Left edge. */
  readonly x: number;
  /** Top edge. */
  readonly y: number;
  /** Width. */
  readonly w: number;
  /** Height. */
  readonly h: number;
  /** Fill colour. */
  readonly color: string;
  /** True for text, drawn as a lighter bar. */
  readonly text: boolean;
};

/**
 * What a thumbnail shows.
 *
 * @public
 */
export type ThumbPlan = {
  /** Width in pixels. */
  readonly w: number;
  /** Height in pixels (the screen's aspect ratio). */
  readonly h: number;
  /** Background colour. */
  readonly background: string;
  /** The boxes, back to front. */
  readonly boxes: readonly ThumbBox[];
};

type Rec = { readonly id?: string; readonly type?: string; readonly index?: string; readonly kind?: string; readonly [key: string]: unknown };

const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NEUTRAL = '#cbd5e1';
const PAPER = '#ffffff';

/** The colour of a paint: a literal colour, the first stop of a gradient, else `fallback` (a token needs a theme, which a sketch does not have). */
function colourOf(paint: unknown, fallback: string): string {
  if (typeof paint === 'string') return HEX.test(paint) ? paint : fallback;
  const stops = (paint as { stops?: { color?: unknown }[] } | undefined)?.stops;
  const first = stops?.[0]?.color;
  return typeof first === 'string' && HEX.test(first) ? first : fallback;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const byIndex = (a: Rec, b: Rec) => ((a.index ?? '') < (b.index ?? '') ? -1 : (a.index ?? '') > (b.index ?? '') ? 1 : 0);

/** `records` read as a store would (the master rules read through one): by id, by type, and by screen. */
function recordsView(records: { readonly [id: string]: unknown }): ReadView {
  const all = Object.values(records) as Rec[];
  return {
    get: (id) => records[id] as AnyRecord | undefined,
    has: (id) => id in records,
    ids: () => Object.keys(records) as RecordId[],
    size: all.length,
    members: (index, key) =>
      all.filter((r) => (index === 'byType' ? r.type === key : index === 'byScreen' ? r['screenId'] === key : false)).map((r) => r.id as RecordId),
  };
}

/** The boxes of `elements` (top level, visible, in order) at `scale`. */
function boxesOf(elements: readonly Rec[], scale: number): ThumbBox[] {
  const boxes: ThumbBox[] = [];
  for (const el of [...elements].sort(byIndex)) {
    const t = el['transform'] as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined;
    const [x, y, w, h] = [num(t?.x), num(t?.y), num(t?.w), num(t?.h)];
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    const style = el['style'] as { fill?: unknown } | undefined;
    const text = el.kind === 'text';
    boxes.push({ x: x * scale, y: y * scale, w: w * scale, h: h * scale, color: text ? '#94a3b8' : colourOf(style?.fill, NEUTRAL), text });
  }
  return boxes;
}

/**
 * The thumbnail of the first screen (the lowest index) of `records` that is not a master, or undefined when there is none. A
 * screen's master is drawn behind it as the player draws it (FR-SCR-005): its background when the screen has none, and its
 * elements other than placeholders unless the screen hides them.
 *
 * @public
 */
export function thumbnailPlan(records: { readonly [id: string]: unknown }): ThumbPlan | undefined {
  const all = Object.values(records) as Rec[];
  const screen = all.filter((r) => r.type === 'screen' && !isMasterScreen(r)).sort(byIndex)[0];
  if (screen === undefined) return undefined;
  const size = screenSize(screen as { size?: { w: number; h: number } });
  const scale = THUMBNAIL_WIDTH / size.w;
  const layers = masterLayers(recordsView(records), screen.id as RecordId);
  const shown = (r: Rec, on: unknown) => r.type === 'element' && r['screenId'] === on && r['parentId'] === undefined && r['hidden'] !== true;
  const behind = layers?.elements === true ? all.filter((r) => shown(r, layers.master) && !layers.placeholders.has(r.id as RecordId)) : [];
  const boxes = [
    ...boxesOf(behind, scale),
    ...boxesOf(
      all.filter((r) => shown(r, screen.id)),
      scale,
    ),
  ];
  const background = colourOf(screen['background'] ?? layers?.background, PAPER);
  return { w: THUMBNAIL_WIDTH, h: Math.max(1, Math.round(size.h * scale)), background, boxes };
}

/**
 * Draw `plan` and encode it as WebP; undefined where the browser cannot (no canvas, or no WebP encoder).
 *
 * @public
 */
export async function renderThumbnail(plan: ThumbPlan): Promise<Uint8Array | undefined> {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const canvas = new OffscreenCanvas(plan.w, plan.h);
  const ctx = canvas.getContext('2d');
  if (ctx === null) return undefined;
  ctx.fillStyle = plan.background;
  ctx.fillRect(0, 0, plan.w, plan.h);
  for (const b of plan.boxes) {
    ctx.fillStyle = b.color;
    // text is a bar through the middle of its box, not a block
    if (b.text) ctx.fillRect(b.x, b.y + b.h * 0.4, b.w, Math.max(1, b.h * 0.2));
    else ctx.fillRect(b.x, b.y, b.w, b.h);
  }
  try {
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.7 });
    // a browser without a WebP encoder answers with PNG; the file says `.webp`, so it is left out
    return blob.type === 'image/webp' ? new Uint8Array(await blob.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
}

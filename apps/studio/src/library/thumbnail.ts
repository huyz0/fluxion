// The library's preview (FR-FIL-008): the first screen drawn as its background and the boxes of its elements, small. It is a sketch of the layout, not
// a render: the studio has no way to rasterise a screen yet, and a sketch is enough to tell documents apart in a list. `thumbnailPlan` is the
// arithmetic; `renderThumbnail` puts it on a canvas and encodes `preview.webp`.
import { screenSize } from '@fluxion/schema';

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

/**
 * The thumbnail of the first screen (the lowest index) of `records`, or undefined when there is no screen.
 *
 * @public
 */
export function thumbnailPlan(records: { readonly [id: string]: unknown }): ThumbPlan | undefined {
  const all = Object.values(records) as Rec[];
  const screen = all.filter((r) => r.type === 'screen').sort((a, b) => ((a.index ?? '') < (b.index ?? '') ? -1 : (a.index ?? '') > (b.index ?? '') ? 1 : 0))[0];
  if (screen === undefined) return undefined;
  const size = screenSize(screen as { size?: { w: number; h: number } });
  const scale = THUMBNAIL_WIDTH / size.w;
  const boxes: ThumbBox[] = [];
  const onScreen = all
    .filter((r) => r.type === 'element' && r['screenId'] === screen.id && r['parentId'] === undefined && r['hidden'] !== true)
    .sort((a, b) => ((a.index ?? '') < (b.index ?? '') ? -1 : (a.index ?? '') > (b.index ?? '') ? 1 : 0));
  for (const el of onScreen) {
    const t = el['transform'] as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined;
    const [x, y, w, h] = [num(t?.x), num(t?.y), num(t?.w), num(t?.h)];
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    const style = el['style'] as { fill?: unknown } | undefined;
    const text = el.kind === 'text';
    boxes.push({ x: x * scale, y: y * scale, w: w * scale, h: h * scale, color: text ? '#94a3b8' : colourOf(style?.fill, NEUTRAL), text });
  }
  return { w: THUMBNAIL_WIDTH, h: Math.max(1, Math.round(size.h * scale)), background: colourOf(screen['background'], PAPER), boxes };
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

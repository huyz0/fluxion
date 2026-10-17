// Label placement post-pass (FR-LAY-004, architecture 05 §8): each label tries candidate fractions of
// its route's arc length (0.5 first, then 0.33, 0.66, ...) and takes the one whose box overlaps the
// least: shapes and placed labels by area, other routes by the samples that fall inside. Labels are
// placed in input order, so the same input gives the same places (FR-RTE-004).
import { type Box, createPathSampler, type PathCommand, pathFromCommands, type Vec2 } from '@fluxion/geometry';

/**
 * The size of a label.
 *
 * @public
 */
export type LabelSize = {
  /** Width, px. */
  readonly w: number;
  /** Height, px. */
  readonly h: number;
};

/**
 * A label to place on a route.
 *
 * @public
 */
export type LabelRequest = {
  /** Identifies the label in the result. */
  readonly id: string;
  /** The route the label sits on. */
  readonly commands: readonly PathCommand[];
  /** The label's size, px. */
  readonly size: LabelSize;
  /** The fraction tried first. Default 0.5. */
  readonly preferred?: number | undefined;
};

/**
 * Where a label was placed.
 *
 * @public
 */
export type LabelPlacement = {
  /** The label's id. */
  readonly id: string;
  /** The chosen fraction of the route's length. */
  readonly t: number;
  /** The label's centre. */
  readonly center: Vec2;
  /** The label's box. */
  readonly box: Box;
  /** The overlap score of the choice; 0 when the label touches nothing. */
  readonly overlap: number;
};

/** The fractions tried after the preferred one, nearest the middle first. */
const CANDIDATES: readonly number[] = [0.5, 0.33, 0.66, 0.25, 0.75, 0.4, 0.6, 0.15, 0.85];
/** What each sample of another route inside a label costs, in px² of overlap. */
const EDGE_HIT = 50;
const SAMPLES = 48;

const area = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inside = (box: Box, p: Vec2): boolean => p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h;

type Sampled = { readonly id: string; readonly sampler: ReturnType<typeof createPathSampler> | undefined; readonly points: readonly Vec2[] };

function sample(label: LabelRequest): Sampled {
  const path = pathFromCommands(label.commands);
  if (!path.ok) return { id: label.id, sampler: undefined, points: [] };
  const sampler = createPathSampler(path.value);
  return { id: label.id, sampler, points: Array.from({ length: SAMPLES + 1 }, (_, k) => sampler.pointAtFraction(k / SAMPLES)) };
}

const boxAt = (centre: Vec2, size: LabelSize): Box => ({
  x: centre.x - size.w / 2,
  y: centre.y - size.h / 2,
  w: size.w,
  h: size.h,
});

/** The overlap cost of `box`: shapes and placed labels by area, the sampled points of the other routes by `EDGE_HIT`. */
function cost(box: Box, others: { readonly boxes: readonly Box[]; readonly routes: readonly Sampled[] }, own: string): number {
  const solid = others.boxes.reduce((n, b) => n + area(box, b), 0);
  const edges = others.routes.reduce((n, r) => (r.id === own ? n : n + r.points.filter((p) => inside(box, p)).length), 0);
  return solid + edges * EDGE_HIT;
}

function candidates(preferred: number | undefined): number[] {
  const first = Math.min(Math.max(preferred ?? 0.5, 0), 1);
  return [first, ...CANDIDATES.filter((t) => t !== first)];
}

/** The best of `label`'s candidates against `others`: the first with no overlap, else the least. */
function best(label: LabelRequest, route: Sampled, others: { readonly boxes: readonly Box[]; readonly routes: readonly Sampled[] }): LabelPlacement {
  let chosen: LabelPlacement | undefined;
  for (const t of candidates(label.preferred)) {
    const center = route.sampler === undefined ? { x: 0, y: 0 } : route.sampler.pointAtFraction(t);
    const box = boxAt(center, label.size);
    const overlap = cost(box, others, label.id);
    if (chosen === undefined || overlap < chosen.overlap) chosen = { id: label.id, t, center, box, overlap };
    if (overlap === 0 || route.sampler === undefined) break;
  }
  return chosen as LabelPlacement;
}

/**
 * Places `labels` on their routes so they overlap `shapes`, each other and the other routes as little
 * as the candidates allow. A label whose route is not a path sits at the origin.
 *
 * @public
 */
export function placeLabels(labels: readonly LabelRequest[], shapes: readonly Box[]): LabelPlacement[] {
  const routes = labels.map(sample);
  const placed: Box[] = [];
  return labels.map((label, k) => {
    const chosen = best(label, routes[k] as Sampled, { boxes: [...shapes, ...placed], routes });
    placed.push(chosen.box);
    return chosen;
  });
}

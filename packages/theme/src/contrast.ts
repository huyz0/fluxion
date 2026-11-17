// Contrast thresholds, the palette's contrast pairs and the lightness solver (FR-THM-005, NFR-A11Y-005, ADR-0055). One table of
// thresholds serves the palette generator and the contrast linter. The solver keeps a colour's chroma and hue and looks for the
// lightness nearest its own at which it reaches every target against its anchors; pure, and it never throws.
import { intoGamut, type Oklch, oklchToCss, parseColor, relativeLuminance } from './oklch.js';

/**
 * The WCAG AA contrast a text colour needs against its background (NFR-A11Y-005).
 *
 * @public
 */
export const CONTRAST_TEXT: number = 4.5;

/**
 * The WCAG contrast large text, strokes and graphic fills need against what they are drawn on (NFR-A11Y-005).
 *
 * @public
 */
export const CONTRAST_GRAPHIC: number = 3;

/**
 * A colour role a generated palette assigns: the 17 required colour roles of a theme.
 *
 * @public
 */
export type PaletteRole =
  | 'background'
  | 'surface'
  | 'text'
  | 'muted'
  | 'connector'
  | 'primary'
  | 'secondary'
  | 'accent-1'
  | 'accent-2'
  | 'accent-3'
  | 'accent-4'
  | 'accent-5'
  | 'accent-6'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

/** The roles in the order the generator solves them: every pair of a role names only roles before it. */
export const PALETTE_ROLES: readonly PaletteRole[] = [
  'background',
  'surface',
  'text',
  'muted',
  'connector',
  'primary',
  'secondary',
  'accent-1',
  'accent-2',
  'accent-3',
  'accent-4',
  'accent-5',
  'accent-6',
  'success',
  'warning',
  'danger',
  'info',
];

/**
 * One contrast pair of a palette: `role` must reach `target` against `against`.
 *
 * @public
 */
export type ContrastPair = {
  /** The role whose colour is solved. */
  readonly role: PaletteRole;
  /** The role it is measured against (solved earlier). */
  readonly against: PaletteRole;
  /** The contrast ratio it must reach, {@link CONTRAST_TEXT} or {@link CONTRAST_GRAPHIC}. */
  readonly target: number;
};

/**
 * A contrast pair a palette does not meet: only possible when locked colours leave no lightness that meets it.
 *
 * @public
 */
export type ContrastMiss = {
  /** The role that misses. */
  readonly role: PaletteRole;
  /** The role it is measured against. */
  readonly against: PaletteRole;
  /** The ratio its emitted colour reaches. */
  readonly ratio: number;
  /** The ratio it needed. */
  readonly target: number;
};

const pairs = (roles: readonly PaletteRole[], against: readonly PaletteRole[], target: number): ContrastPair[] =>
  roles.flatMap((role) => against.map((a) => ({ role, against: a, target })));
const FILLS: readonly PaletteRole[] = ['accent-1', 'accent-2', 'accent-3', 'accent-4', 'accent-5', 'accent-6', 'success', 'warning', 'danger', 'info'];

/**
 * The contrast pairs of a generated palette, in solve order (ADR-0055): body text and the `primary`/`secondary` labels 4.5:1 on
 * `background` and `surface`, `connector` strokes 3:1 on both, and each accent and status fill 3:1 on `background` with `text`
 * 4.5:1 on it.
 *
 * @public
 */
export const PALETTE_CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...pairs(['text', 'muted'], ['background', 'surface'], CONTRAST_TEXT),
  ...pairs(['connector'], ['background', 'surface'], CONTRAST_GRAPHIC),
  ...pairs(['primary', 'secondary'], ['background', 'surface'], CONTRAST_TEXT),
  ...FILLS.flatMap((role) => [
    { role, against: 'background' as const, target: CONTRAST_GRAPHIC },
    { role, against: 'text' as const, target: CONTRAST_TEXT },
  ]),
];

/** The margin each boundary is solved to above its target, so the 8-bit hex still reaches the target. */
const MARGIN = 0.02;
const BISECTIONS = 32;
const NUDGE = 0.002;
const MAX_NUDGES = 8;

/** An anchor of the solver: a colour (`#rrggbb`) the solved colour must reach `target` against. */
export type Anchor = { readonly hex: string; readonly target: number };

/** What the solver gives: the lightness, the emitted hex, the nudges it took and whether every target is met on the hex. */
export type Solved = { readonly l: number; readonly hex: string; readonly nudges: number; readonly met: boolean };

type Interval = readonly [number, number];
type Lum = (l: number) => number;

const ratio = (y1: number, y2: number): number => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
const lumOfHex = (hex: string): number => relativeLuminance(parseColor(hex) as Oklch);

/** The boundary of a predicate true at 0 and false at 1, by 32 bisection steps: the last lightness found where it holds. */
function bisect(holds: (l: number) => boolean): number {
  let [lo, hi] = [0, 1];
  for (let i = 0; i < BISECTIONS; i++) {
    const mid = (lo + hi) / 2;
    if (holds(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The lightness intervals at which `lum` reaches `target + MARGIN` against luminance `ya`: a darker one, a lighter one, or both. */
function feasible(lum: Lum, ya: number, target: number): Interval[] {
  const t = target + MARGIN;
  const darkMax = (ya + 0.05) / t - 0.05;
  const lightMin = t * (ya + 0.05) - 0.05;
  if (lightMin <= 0) return [[0, 1]];
  const out: Interval[] = [];
  if (darkMax >= 0) out.push([0, bisect((l) => lum(l) <= darkMax)]);
  if (lightMin <= 1) {
    // the first L at which the colour is light enough: the boundary of "still too dark", stepped to its light side
    const below = bisect((l) => lum(l) < lightMin);
    out.push([Math.min(1, below + 2 ** -BISECTIONS), 1]);
  }
  return out;
}

function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a0, a1] of a)
    for (const [b0, b1] of b) {
      const [lo, hi] = [Math.max(a0, b0), Math.min(a1, b1)];
      if (lo <= hi) out.push([lo, hi]);
    }
  return out;
}

/** The point of `region` nearest `start` (the first of equals). */
const nearest = (region: readonly Interval[], start: number): number =>
  region.map(([lo, hi]) => Math.min(hi, Math.max(lo, start))).reduce((best, c) => (Math.abs(c - start) < Math.abs(best - start) ? c : best));

/**
 * Of the candidate lightnesses, the one that misses least: fewest misses, then smallest total relative shortfall, then nearest
 * `start`; `shortfall(l)` gives each anchor's relative shortfall (0 when met).
 */
function closest(candidates: readonly number[], start: number, shortfall: (l: number) => readonly number[]): number {
  const score = (l: number): readonly number[] => {
    const short = shortfall(l);
    return [short.filter((x) => x > 0).length, short.reduce((sum, x) => sum + x, 0), Math.abs(l - start)];
  };
  const better = (s: readonly number[], b: readonly number[]): boolean => {
    const k = s.findIndex((v, i) => v !== b[i]);
    return k >= 0 && (s[k] as number) < (b[k] as number);
  };
  return candidates.reduce((best, l) => (better(score(l), score(best)) ? l : best));
}

/**
 * The colour of `initial`'s chroma and hue (chroma re-clamped to the sRGB gamut at each lightness) at the feasible lightness
 * nearest its own, for every anchor's target (ADR-0055 §Contrast repair): each boundary by bisection to target + 0.02, then the
 * quantised hex checked and the lightness nudged away from a failing anchor by 0.002, at most 8 times. When no lightness meets
 * every target, the candidate that misses least (fewest misses, then smallest total shortfall, then nearest) and `met: false`.
 * `accept`, when given, also has to hold for the hex: a met colour it refuses is replaced by the nearest feasible lightness (scanned
 * every 0.004; at each, the chroma times 1, 0.75, 0.5, 0.25, the hue kept) whose hex meets every target and that it accepts, if
 * there is one.
 */
export function solveLightness(initial: Oklch, anchors: readonly Anchor[], accept?: (hex: string) => boolean): Solved {
  const at = (l: number): Oklch => intoGamut({ l, c: initial.c, h: initial.h, alpha: 1 });
  const lum = (l: number): number => relativeLuminance(at(l));
  const ys = anchors.map((a) => lumOfHex(a.hex));
  const start = Math.min(1, Math.max(0, initial.l));
  const sets = anchors.map((a, i) => feasible(lum, ys[i] as number, a.target));
  const region = sets.reduce<Interval[]>((acc, set) => intersect(acc, set), [[0, 1]]);
  const failing = (hex: string): number => {
    const y = lumOfHex(hex);
    return anchors.findIndex((a, i) => ratio(y, ys[i] as number) < a.target);
  };
  if (region.length === 0) {
    const shortfall = (l: number) => anchors.map((a, i) => Math.max(0, a.target - ratio(lum(l), ys[i] as number)) / a.target);
    const l = closest([start, ...sets.flat().flat()], start, shortfall);
    const hex = oklchToCss(at(l));
    return { l, hex, nudges: 0, met: failing(hex) < 0 };
  }
  let l = nearest(region, start);
  let hex = oklchToCss(at(l));
  let nudges = 0;
  for (let f = failing(hex); f >= 0 && nudges < MAX_NUDGES; f = failing(hex)) {
    l = Math.min(1, Math.max(0, l + (lumOfHex(hex) < (ys[f] as number) ? -NUDGE : NUDGE)));
    hex = oklchToCss(at(l));
    nudges += 1;
  }
  const met = failing(hex) < 0;
  if (!met || accept === undefined || accept(hex)) return { l, hex, nudges, met };
  const ok = (c: number): string | undefined =>
    CHROMA_STEPS.map((f) => oklchToCss(intoGamut({ l: c, c: initial.c * f, h: initial.h, alpha: 1 }))).find((h) => failing(h) < 0 && accept(h));
  return acceptable(region, l, ok) ?? { l, hex, nudges, met };
}

/** The chroma factors tried at each lightness of that scan, the colour's own chroma first; the hue is never changed. */
const CHROMA_STEPS: readonly number[] = [1, 0.75, 0.5, 0.25];

/** Lightness steps of the scan for an acceptable colour inside the feasible region. */
const SCAN_STEP = 0.004;

/** The feasible lightness nearest `from` (scanned every {@link SCAN_STEP}) whose colour `ok` turns into a hex, or undefined. */
function acceptable(region: readonly Interval[], from: number, ok: (l: number) => string | undefined): Solved | undefined {
  const points = region.flatMap(([lo, hi]) => [...Array.from({ length: Math.floor((hi - lo) / SCAN_STEP) + 1 }, (_, i) => lo + i * SCAN_STEP), hi]);
  points.sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || a - b);
  for (const l of points) {
    const hex = ok(l);
    if (hex !== undefined) return { l, hex, nudges: 0, met: true };
  }
  return undefined;
}

// Derived colours (FR-THM-002, ADR-0152): OKLCH maths of our own, so no host (the player included) gains a dependency for a few
// conversions. A colour is parsed to sRGB, taken to OKLab and OKLCH (Ottosson's matrices), changed by the steps `lighten`,
// `darken`, `alpha` and `mix`, and written back as `#rrggbb` or `rgb(r g b / a)`. The steps mean what CSS
// `color-mix(in oklch, ...)` means (the element-level colour transform of M4 emits exactly that), so a derived theme token and a
// transformed style agree. Pure.

/**
 * A colour in OKLCH with alpha: lightness 0 to 1, chroma from 0, hue in degrees [0, 360), alpha 0 to 1.
 *
 * @public
 */
export type Oklch = {
  /** Lightness, 0 (black) to 1 (white). */
  readonly l: number;
  /** Chroma, 0 for a grey. */
  readonly c: number;
  /** Hue angle in degrees, [0, 360); meaningless when chroma is 0. */
  readonly h: number;
  /** Opacity, 0 to 1. */
  readonly alpha: number;
};

/**
 * One step of a derived colour: `lighten n` mixes with white and `darken n` with black by n (0 to 1), `alpha n` multiplies the
 * opacity by n (0 to 1), `mix` mixes with another colour by `amount`, the weight of that colour (0 to 1).
 *
 * @public
 */
export type ColorStep =
  | {
      /** Mix with white by this much, 0 to 1. */
      readonly lighten: number;
    }
  | {
      /** Mix with black by this much, 0 to 1. */
      readonly darken: number;
    }
  | {
      /** Multiply the opacity by this, 0 to 1. */
      readonly alpha: number;
    }
  | {
      /** Mix with another colour. */
      readonly mix: {
        /** The colour to mix with. */
        readonly with: Oklch;
        /** The weight of that colour, 0 to 1. */
        readonly amount: number;
      };
    };

/** Below this chroma a colour is a grey whose hue is powerless (CSS Color 4): a mix takes the other colour's hue. */
const ACHROMATIC = 4e-4;

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
const mod360 = (h: number): number => ((h % 360) + 360) % 360;

/**
 * sRGB channels in [0, 1] (gamma-encoded, as written in CSS) as OKLCH.
 *
 * @public
 */
export function rgbToOklch(r: number, g: number, b: number, alpha = 1): Oklch {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, bb);
  return { l: L, c, h: c < ACHROMATIC ? 0 : mod360((Math.atan2(bb, a) * 180) / Math.PI), alpha };
}

/** OKLCH as unclamped linear-light sRGB (it may lie outside [0, 1]). */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ];
}

const inGamut = (rgb: readonly number[]): boolean => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** `color` brought into the sRGB gamut by reducing its chroma at the same lightness and hue (lightness is clamped to [0, 1] first). */
function intoGamut(color: Oklch): Oklch {
  const base = { ...color, l: clamp01(color.l) };
  if (inGamut(oklchToLinear(base))) return base;
  let [lo, hi] = [0, base.c];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ ...base, c: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...base, c: lo };
}

const hex2 = (v: number): string =>
  Math.round(clamp01(fromLinear(clamp01(v))) * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * A colour as CSS: `#rrggbb` when opaque, else `rgb(r g b / a)` (alpha to three places), brought into the sRGB gamut.
 *
 * @public
 */
export function oklchToCss(color: Oklch): string {
  const [r, g, b] = oklchToLinear(intoGamut(color));
  if (color.alpha >= 1) return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  const byte = (v: number) => Math.round(clamp01(fromLinear(clamp01(v))) * 255);
  return `rgb(${byte(r)} ${byte(g)} ${byte(b)} / ${Math.round(clamp01(color.alpha) * 1000) / 1000})`;
}

const CHANNEL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
/** An angle in degrees from `t` (`deg`, `grad`, `rad`, `turn`), or undefined. */
function angle(t: string): number | undefined {
  for (const [unit, per] of [
    ['deg', 1],
    ['grad', 0.9],
    ['rad', 180 / Math.PI],
    ['turn', 360],
  ] as const) {
    if (t.endsWith(unit) && CHANNEL.test(t.slice(0, -unit.length))) return Number(t.slice(0, -unit.length)) * per;
  }
  return undefined;
}

/** A channel of a colour function: a number, a percentage (of `scale`), `none` (zero), or an angle for a hue (to degrees). */
function channel(raw: string | undefined, scale: number, hue = false): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim().toLowerCase();
  if (t === 'none') return 0;
  if (t.endsWith('%')) return CHANNEL.test(t.slice(0, -1)) ? (Number(t.slice(0, -1)) / 100) * scale : undefined;
  const turned = hue ? angle(t) : undefined;
  if (turned !== undefined) return turned;
  return CHANNEL.test(t) ? Number(t) : undefined;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(((n + h / 30) % 12) - 3, 9 - ((n + h / 30) % 12), 1));
  return [f(0), f(8), f(4)];
}

/** The colour of `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` text, or undefined. */
function parseHex(t: string): Oklch | undefined {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t)?.[1];
  if (hex === undefined) return undefined;
  const full = hex.length <= 4 ? [...hex].map((d) => d + d).join('') : hex;
  const v = [0, 2, 4, 6].map((i) => (i < full.length ? Number.parseInt(full.slice(i, i + 2), 16) / 255 : 1));
  return rgbToOklch(v[0] as number, v[1] as number, v[2] as number, v[3] as number);
}

type Args = readonly [string | undefined, string | undefined, string | undefined];
const lab = (l: number, a: number, b: number, alpha: number): Oklch => {
  const c = Math.hypot(a, b);
  return { l: clamp01(l), c, h: c < ACHROMATIC ? 0 : mod360((Math.atan2(b, a) * 180) / Math.PI), alpha: clamp01(alpha) };
};

/** The readers of the colour functions, by name: each gets its three channels and the alpha. */
const FUNCTIONS: { readonly [name: string]: (a: Args, alpha: number) => Oklch | undefined } = {
  rgb: ([x, y, z], alpha) => {
    const [r, g, b] = [channel(x, 255), channel(y, 255), channel(z, 255)];
    return r === undefined || g === undefined || b === undefined ? undefined : rgbToOklch(clamp01(r / 255), clamp01(g / 255), clamp01(b / 255), clamp01(alpha));
  },
  hsl: ([x, y, z], alpha) => {
    // saturation and lightness: a percentage, or a plain number that is a percentage too (hsl(221 83 53)): both in 0 to 100 here
    const [h, s, l] = [channel(x, 360, true), channel(y, 100), channel(z, 100)];
    if (h === undefined || s === undefined || l === undefined) return undefined;
    const [r, g, b] = hslToRgb(mod360(h), clamp01(s / 100), clamp01(l / 100));
    return rgbToOklch(clamp01(r), clamp01(g), clamp01(b), clamp01(alpha));
  },
  oklch: ([x, y, z], alpha) => {
    const [l, c, h] = [channel(x, 1), channel(y, 0.4), channel(z, 360, true)];
    return l === undefined || c === undefined || h === undefined ? undefined : { l: clamp01(l), c: Math.max(0, c), h: mod360(h), alpha: clamp01(alpha) };
  },
  oklab: ([x, y, z], alpha) => {
    const [l, a, b] = [channel(x, 1), channel(y, 0.4), channel(z, 0.4)];
    return l === undefined || a === undefined || b === undefined ? undefined : lab(l, a, b, alpha);
  },
};

/**
 * The colour a literal CSS colour text names, or undefined when its form cannot be derived from: `#rgb`, `#rgba`, `#rrggbb`,
 * `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()` and `oklab()` are read; named colours, `lab()`, `lch()`, `hwb()` and
 * `color()` are not.
 *
 * @public
 */
export function parseColor(text: string): Oklch | undefined {
  const t = text.trim();
  const fn = /^(rgb|hsl|oklch|oklab)a?\(([^()]*)\)$/i.exec(t);
  if (fn === null) return parseHex(t);
  const args = (fn[2] as string).split(/[\s,/]+/).filter(Boolean);
  const alpha = args.length === 4 ? channel(args[3], 1) : 1;
  if (alpha === undefined || args.length < 3 || args.length > 4) return undefined;
  return FUNCTIONS[(fn[1] as string).toLowerCase()]?.([args[0], args[1], args[2]], alpha);
}

/** `a` and `b` mixed by `weight` of `b` in OKLCH, as CSS `color-mix(in oklch, a, b)` does: premultiplied, the shorter hue arc, a grey's hue powerless. */
function mix(a: Oklch, b: Oklch, weight: number): Oklch {
  const alpha = a.alpha * (1 - weight) + b.alpha * weight;
  const h1 = a.c < ACHROMATIC ? b.h : a.h;
  const h2 = b.c < ACHROMATIC ? a.h : b.h;
  // the shorter arc; a difference of exactly 180 degrees keeps its sign, as CSS Color 4 leaves it
  const diff = h2 - h1;
  const arc = diff > 180 ? diff - 360 : diff < -180 ? diff + 360 : diff;
  const premultiplied = (x: number, y: number) => (alpha === 0 ? x * (1 - weight) + y * weight : (x * a.alpha * (1 - weight) + y * b.alpha * weight) / alpha);
  return { l: premultiplied(a.l, b.l), c: premultiplied(a.c, b.c), h: mod360(h1 + arc * weight), alpha };
}

/**
 * `base` changed by `steps`, in order, as OKLCH (before the sRGB gamut is applied, so it is exact to floating point).
 *
 * @public
 */
export function deriveOklch(base: Oklch, steps: readonly ColorStep[]): Oklch {
  return steps.reduce<Oklch>((color, step) => {
    if ('lighten' in step) return mix(color, { l: 1, c: 0, h: color.h, alpha: color.alpha }, step.lighten);
    if ('darken' in step) return mix(color, { l: 0, c: 0, h: color.h, alpha: color.alpha }, step.darken);
    if ('alpha' in step) return { ...color, alpha: color.alpha * step.alpha };
    return mix(color, step.mix.with, step.mix.amount);
  }, base);
}

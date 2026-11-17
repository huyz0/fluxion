// A palette from 1-3 seed colours (FR-THM-005, ADR-0055 §Seed → palette): initial colours in OKLCH by role, the 7 hue slots
// shuffled by a seeded Fisher–Yates over the unlocked slots, then one pass of contrast repair in solve order, each role solved
// against the roles before it. Locked roles are set verbatim and become anchors. The same (seeds, locks, shuffle) give the same
// palette, byte for byte. Pure.
import { err, ok, type Result } from '@fluxion/schema';
import { EXTENSION_KEY } from './alias.js';
import { type Anchor, type ContrastMiss, PALETTE_CONTRAST_PAIRS, PALETTE_ROLES, type PaletteRole, solveLightness } from './contrast.js';
import type { ThemeError } from './errors.js';
import { contrastRatio, intoGamut, type Oklch, oklabDistance, oklchToCss, parseColor } from './oklch.js';
import { createRng } from './rng.js';
import { isToken, type Theme, type Token, type TokenGroup } from './tokens.js';

/**
 * What a palette is generated from.
 *
 * @public
 */
export type PaletteOptions = {
  /** 1 to 3 CSS colours `parseColor` reads; the first becomes `primary`, the others `secondary` and `accent-1`. Alpha is ignored. */
  readonly seeds: readonly string[];
  /** Roles set to a colour as given (written as `#rrggbb`, never repaired); unlocked roles are solved against them. */
  readonly locks?: Partial<Record<PaletteRole, string>>;
  /** A whole number 0 to 2^32 - 1 choosing a permutation of the unlocked hue slots; 0 (the default) is the canonical order. */
  readonly shuffle?: number;
};

/**
 * A generated palette: a `#rrggbb` colour for every required role, the roles moved for contrast and the pairs not met.
 *
 * @public
 */
export type Palette = {
  /** The colour of each role, `#rrggbb` (lower case). */
  readonly colors: Readonly<Record<PaletteRole, string>>;
  /** The roles whose colour the contrast repair changed ("adjusted for contrast"), in solve order. */
  readonly adjusted: readonly PaletteRole[];
  /** The contrast pairs the palette misses; empty unless locked colours made a pair impossible. */
  readonly unmet: readonly ContrastMiss[];
};

const HUE_SLOTS: readonly PaletteRole[] = ['secondary', 'accent-1', 'accent-2', 'accent-3', 'accent-4', 'accent-5', 'accent-6'];
const GOLDEN_ANGLE = 137.5;
const STATUS: ReadonlyArray<readonly [PaletteRole, number]> = [
  ['success', 145],
  ['warning', 70],
  ['danger', 25],
  ['info', 240],
];
const HEX6 = /^#[0-9a-f]{6}$/i;
/** The fills kept apart when a role is locked: the hue slots and the status roles. */
const FILL_ROLES: readonly PaletteRole[] = [...HUE_SLOTS, ...STATUS.map(([r]) => r)];
/**
 * The least OKLab distance between two fills of a palette with locks (about a just-noticeable difference of 0.02); an unlocked fill
 * closer than this to another is moved inside its feasible lightness when it can be.
 */
const MIN_FILL_DISTANCE = 0.02;

const input = (message: string): Result<never, ThemeError> => err({ code: 'PALETTE_INPUT', message });
const mod360 = (h: number): number => ((h % 360) + 360) % 360;
const opaque = (c: Oklch): Oklch => ({ ...c, alpha: 1 });

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** The lightness of the neutrals: ADR-0055's light table, and its inverse, also solved whenever a role is locked. */
const NEUTRALS = {
  light: { background: 0.99, surface: 0.97, text: 0.22, muted: 0.48, connector: 0.4 },
  dark: { background: 0.16, surface: 0.2, text: 0.96, muted: 0.74, connector: 0.7 },
} as const;
type Polarity = keyof typeof NEUTRALS;

/** The initial colour of every role (ADR-0055's table), before shuffle and repair; seeds are gamut-clamped. */
function initialColors(seeds: readonly Oklch[], polarity: Polarity): Map<PaletteRole, Oklch> {
  const n = NEUTRALS[polarity];
  const [s1, s2, s3] = seeds as [Oklch, Oklch?, Oklch?];
  const h1 = s1.h;
  const slotC = Math.min(0.17, Math.max(0.08, median(seeds.map((s) => s.c))));
  const at = (l: number, c: number, h: number): Oklch => ({ l, c, h: mod360(h), alpha: 1 });
  const out = new Map<PaletteRole, Oklch>([
    ['background', at(n.background, 0.004, h1)],
    ['surface', at(n.surface, 0.008, h1)],
    ['text', at(n.text, 0.02, h1)],
    ['muted', at(n.muted, 0.02, h1)],
    ['connector', at(n.connector, 0.02, h1)],
    ['primary', intoGamut(s1)],
  ]);
  for (const [k, slot] of HUE_SLOTS.entries()) out.set(slot, at(0.62, slotC, h1 + GOLDEN_ANGLE * (k + 1)));
  if (s2) out.set('secondary', intoGamut(s2));
  if (s3) out.set('accent-1', intoGamut(s3));
  for (const [role, hue] of STATUS) out.set(role, at(0.62, 0.14, hue));
  return out;
}

/** The hue slots' colours permuted by a Fisher–Yates draw from `rng(shuffle)` over the unlocked slots; locked slots stay put. */
function shuffled(colors: Map<PaletteRole, Oklch>, locked: ReadonlySet<PaletteRole>, shuffle: number): void {
  if (shuffle === 0) return;
  const free = HUE_SLOTS.filter((s) => !locked.has(s));
  const values = free.map((s) => colors.get(s) as Oklch);
  const rng = createRng(shuffle);
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [values[i], values[j]] = [values[j] as Oklch, values[i] as Oklch];
  }
  for (const [i, s] of free.entries()) colors.set(s, values[i] as Oklch);
}

function readSeeds(seeds: unknown): Result<Oklch[], ThemeError> {
  if (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 3) return input('a palette needs 1 to 3 seed colours');
  const out: Oklch[] = [];
  for (const [i, s] of seeds.entries()) {
    const c = typeof s === 'string' ? parseColor(s) : undefined;
    if (c === undefined) return input(`seed ${i + 1} is not a colour parseColor reads: ${String(s)}`);
    out.push(opaque(c));
  }
  return ok(out);
}

/** One lock as `#rrggbb`: a `#rrggbb` text kept as written (lower-cased), any other readable colour converted; undefined when unreadable. */
function lockHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (HEX6.test(value)) return value.toLowerCase();
  const c = parseColor(value);
  return c === undefined ? undefined : oklchToCss(opaque(c));
}

const isRole = (role: string): role is PaletteRole => (PALETTE_ROLES as readonly string[]).includes(role);

function readLocks(locks: unknown): Result<Map<PaletteRole, string>, ThemeError> {
  const out = new Map<PaletteRole, string>();
  if (locks === undefined) return ok(out);
  if (typeof locks !== 'object' || locks === null || Array.isArray(locks)) return input('locks is an object of role → colour');
  for (const [role, value] of Object.entries(locks).filter(([, v]) => v !== undefined)) {
    if (!isRole(role)) return input(`locks names an unknown role: ${role}`);
    const hex = lockHex(value);
    if (hex === undefined) return input(`the lock of ${role} is not a colour parseColor reads: ${String(value)}`);
    out.set(role, hex);
  }
  return ok(out);
}

const validShuffle = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;

/**
 * The anchors of an unlocked role: its pairs against roles solved before it, and every pair whose other side is locked, whatever
 * the solve order (a lock is an anchor its unlocked partners are solved against, ADR-0055 §Lock and shuffle).
 */
function anchorsOf(role: PaletteRole, colors: Readonly<Record<PaletteRole, string>>, locks: ReadonlyMap<PaletteRole, string>): Anchor[] {
  return PALETTE_CONTRAST_PAIRS.flatMap((p) => {
    if (p.role === role) return [{ hex: colors[p.against], target: p.target }];
    const locked = p.against === role ? locks.get(p.role) : undefined;
    return locked === undefined ? [] : [{ hex: locked, target: p.target }];
  });
}

/**
 * Each unlocked role solved in order against its anchors: the colours, the roles whose colour moved (in order) and the total
 * lightness movement of the unlocked roles from their initial L.
 */
function repaired(initial: ReadonlyMap<PaletteRole, Oklch>, locks: ReadonlyMap<PaletteRole, string>): Solve {
  const colors = {} as Record<PaletteRole, string>;
  const adjusted: PaletteRole[] = [];
  let movement = 0;
  for (const role of PALETTE_ROLES) {
    const locked = locks.get(role);
    if (locked !== undefined) {
      colors[role] = locked;
      continue;
    }
    const start = initial.get(role) as Oklch;
    const anchors = anchorsOf(role, colors, locks);
    const accept = locks.size > 0 && FILL_ROLES.includes(role) ? apart(role, colors, locks) : undefined;
    const solved = anchors.length === 0 ? { l: start.l, hex: oklchToCss(start) } : solveLightness(start, anchors, accept);
    colors[role] = solved.hex;
    movement += Math.abs(solved.l - Math.min(1, Math.max(0, start.l)));
    if (solved.hex !== oklchToCss(start)) adjusted.push(role);
  }
  return { colors, adjusted, movement, unmet: missesOf(colors) };
}

/** Whether a candidate colour of fill `role` is at least {@link MIN_FILL_DISTANCE} from every locked fill and every fill solved so far. */
function apart(role: PaletteRole, colors: Readonly<Record<PaletteRole, string>>, locks: ReadonlyMap<PaletteRole, string>): (hex: string) => boolean {
  const others = FILL_ROLES.filter((r) => r !== role && (locks.has(r) || colors[r] !== undefined)).map((r) => parseColor(locks.get(r) ?? colors[r]) as Oklch);
  return (hex) => {
    const c = parseColor(hex) as Oklch;
    return others.every((o) => oklabDistance(c, o) >= MIN_FILL_DISTANCE);
  };
}

type Solve = Palette & { readonly movement: number };

/** Whether solve `a` beats `b`: fewer misses, then less lightness movement; on a tie neither does (the caller keeps light). */
const beats = (a: Solve, b: Solve): boolean => a.unmet.length < b.unmet.length || (a.unmet.length === b.unmet.length && a.movement < b.movement);

/**
 * A palette for the 17 required colour roles from 1 to 3 seed colours (FR-THM-005, ADR-0055): seed 1 becomes `primary`, seeds 2
 * and 3 `secondary` and `accent-1`, the other hue slots follow the golden angle from seed 1, neutrals take its hue and status roles
 * fixed hues; then each role's lightness is repaired until every pair of {@link PALETTE_CONTRAST_PAIRS} is met on the emitted hex.
 * `locks` set roles verbatim and anchor every unlocked partner, whatever the solve order; with any lock the palette is solved with
 * the light neutrals and with them inverted (a dark background), and the one with fewer misses, then less lightness movement of the
 * unlocked roles, is kept (light on a tie). Without locks only the light neutrals are used.
 * `shuffle` permutes the unlocked hue slots. Deterministic. `PALETTE_INPUT` when there are not 1 to 3
 * readable seeds, a lock names an unknown role or an unreadable colour, or `shuffle` is not a whole number 0 to 2^32 - 1.
 *
 * @public
 */
export function generatePalette(options: PaletteOptions): Result<Palette, ThemeError> {
  const seeds = readSeeds(options.seeds);
  if (!seeds.ok) return seeds;
  const locks = readLocks(options.locks);
  if (!locks.ok) return locks;
  const shuffle = options.shuffle ?? 0;
  if (!validShuffle(shuffle)) return input('shuffle is a whole number 0 to 2^32 - 1');

  const solve = (polarity: Polarity): Solve => {
    const initial = initialColors(seeds.value, polarity);
    shuffled(initial, new Set(locks.value.keys()), shuffle);
    return repaired(initial, locks.value);
  };
  const light = solve('light');
  const dark = locks.value.size > 0 ? solve('dark') : undefined;
  const chosen = dark !== undefined && beats(dark, light) ? dark : light;
  return ok({ colors: chosen.colors, adjusted: chosen.adjusted, unmet: chosen.unmet });
}

/** Every pair of {@link PALETTE_CONTRAST_PAIRS} the colours miss, with the ratio they reach. */
const missesOf = (colors: Readonly<Record<PaletteRole, string>>): ContrastMiss[] =>
  PALETTE_CONTRAST_PAIRS.map(({ role, against, target }) => ({ role, against, ratio: contrastRatio(colors[role], colors[against]) as number, target })).filter(
    (m) => m.ratio < m.target,
  );

/**
 * `theme` with its 17 colour-role tokens (`color.<role>`) set to the palette's colours as literals: a token's `$description` and
 * other extensions are kept; an alias becomes a literal and a derived token loses its `dev.fluxion` transform. Other tokens are
 * untouched, so tokens derived from the roles follow (ADR-0152).
 *
 * @public
 */
export function applyPalette(theme: Theme, palette: Palette): Theme {
  const group = theme.tokens['color'];
  const old: TokenGroup = group !== undefined && !isToken(group) ? group : {};
  const color: Record<string, Token | TokenGroup> = { ...old };
  for (const role of PALETTE_ROLES) color[role] = literal(old[role], palette.colors[role]);
  return { ...theme, tokens: { ...theme.tokens, color } };
}

/** A literal colour token of `value`, keeping `prev`'s `$description` and its extensions but the `dev.fluxion` transform. */
function literal(prev: Token | TokenGroup | undefined, value: string): Token {
  const token = prev !== undefined && isToken(prev) ? prev : undefined;
  const { [EXTENSION_KEY]: fluxion, ...others } = token?.$extensions ?? {};
  const { transform: _transform, ...keep } = (typeof fluxion === 'object' && fluxion !== null ? fluxion : {}) as Record<string, unknown>;
  const extensions = Object.keys(keep).length > 0 ? { ...others, [EXTENSION_KEY]: keep } : others;
  return {
    $type: 'color',
    $value: value,
    ...(token?.$description === undefined ? {} : { $description: token.$description }),
    ...(Object.keys(extensions).length > 0 ? { $extensions: extensions } : {}),
  };
}

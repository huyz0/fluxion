// The pure side of the inspector's widgets (FR-EDT-008, M7.16): what typing and scrubbing make of a number,
// and the colour tokens a picker offers. The components (inspector.tsx) only draw and call these.
import type { FieldDef } from '@fluxion/schema';
import type { Theme } from '@fluxion/theme';

/** Pixels of pointer travel that change a scrubbed number by one step. */
export const SCRUB_PX_PER_STEP = 4;

/** `n` within the field's bounds (a bound the schema does not have does not limit). */
export function clampTo(def: Pick<FieldDef, 'min' | 'max'>, n: number): number {
  return Math.min(def.max ?? Number.POSITIVE_INFINITY, Math.max(def.min ?? Number.NEGATIVE_INFINITY, n));
}

/** How much a number field changes per step: 0.01 for a field bounded within 0..1 or so, else 1. */
export function stepOf(def: Pick<FieldDef, 'min' | 'max'>): number {
  return def.min !== undefined && def.max !== undefined && def.max - def.min <= 2 ? 0.01 : 1;
}

/** Round to the step's precision, so 0.1 + 0.2 reads 0.3 and a scrub never leaves float dust. */
const tidy = (n: number, step: number): number => Number((Math.round(n / step) * step).toFixed(6));

/**
 * The value of a number scrubbed `dx` px from `start`: one step per {@link SCRUB_PX_PER_STEP}, ten times
 * as many with `coarse`, a tenth with `fine`, kept within the field's bounds.
 */
export function scrubbed(
  def: Pick<FieldDef, 'min' | 'max'>,
  start: number,
  dx: number,
  mode: { readonly coarse?: boolean; readonly fine?: boolean } = {},
): number {
  const step = stepOf(def);
  const scale = mode.coarse === true ? 10 : mode.fine === true ? 0.1 : 1;
  return clampTo(def, tidy(start + (dx / SCRUB_PX_PER_STEP) * step * scale, mode.fine === true ? step / 10 : step));
}

/**
 * The number typed into a field: undefined for an empty entry (the field is cleared), `'invalid'` for text that
 * is no finite number, else the number within the field's bounds.
 */
export function parseNumber(def: Pick<FieldDef, 'min' | 'max'>, text: string): number | undefined | 'invalid' {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? clampTo(def, n) : 'invalid';
}

type Tree = { readonly [name: string]: unknown };

/** The colour token references under `node` (a token, or a group of them) at `path`. */
function colorRefs(node: unknown, path: string): string[] {
  if (typeof node !== 'object' || node === null) return [];
  const type = (node as { readonly $type?: unknown }).$type;
  if (type !== undefined) return type === 'color' ? [`{${path}}`] : [];
  return Object.entries(node as Tree).flatMap(([name, child]) => colorRefs(child, `${path}.${name}`));
}

/** The colour tokens of `theme` as references (`{color.primary}`), in tree order. */
export const colorTokenRefs = (theme: Theme): readonly string[] => colorRefs((theme.tokens as Tree)['color'], 'color');

/** Whether a stored paint is a plain colour value the colour input can show (`#rrggbb`). */
export const isHex6 = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

/** The glyph an enum option wears on its button (the option's name stays its accessible name); a first letter for an option without one. */
const GLYPHS: Readonly<Record<string, string>> = {
  none: '∅',
  shrink: '⇲',
  grow: '⇱',
  width: '↔',
  height: '↕',
  cover: '▣',
  contain: '▢',
  fill: '■',
  left: '⇤',
  center: '↔',
  right: '⇥',
  justify: '☰',
  straight: '╱',
  curved: '⌒',
  orthogonal: '┐',
  polyline: '⌇',
};

/** The icon of enum option `option`. */
export const optionGlyph = (option: string): string => GLYPHS[option] ?? (option.slice(0, 1).toUpperCase() || '·');

/** What a stored paint is when it is no plain colour: `'gradient'`, `'image'`, else undefined. */
export function paintKind(value: unknown): 'gradient' | 'image' | undefined {
  const type = typeof value === 'object' && value !== null ? (value as { readonly type?: unknown }).type : undefined;
  if (type === 'linear-gradient' || type === 'radial-gradient') return 'gradient';
  return type === 'image' ? 'image' : undefined;
}

/** How a gradient or image paint reads in the colour box (it is shown, not edited as text). */
export function paintLabel(value: unknown): string | undefined {
  const type = (value as { readonly type?: string } | null | undefined)?.type;
  return paintKind(value) === undefined ? undefined : type === 'image' ? 'image' : type === 'radial-gradient' ? 'radial gradient' : 'linear gradient';
}

/** The CSS background a gradient paint previews as: its stops in offset order, a stop that is no plain hex colour grey. */
export function gradientCss(value: unknown): string | undefined {
  if (paintKind(value) !== 'gradient') return undefined;
  const g = value as { readonly type: string; readonly angle?: number; readonly stops?: readonly { readonly offset: number; readonly color: unknown }[] };
  const stops = [...(g.stops ?? [])]
    .sort((a, b) => a.offset - b.offset)
    .map((st) => `${typeof st.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(st.color) ? st.color : '#888888'} ${Math.round(st.offset * 100)}%`);
  if (stops.length < 2) return undefined;
  return g.type === 'radial-gradient' ? `radial-gradient(${stops.join(', ')})` : `linear-gradient(${(g.angle ?? 0) + 90}deg, ${stops.join(', ')})`;
}

/** A number one step up (`direction` 1) or down (-1) from `current`, ten steps with `coarse`, a tenth with `fine`, within the field's bounds. */
export const stepped = (
  def: Pick<FieldDef, 'min' | 'max'>,
  current: number,
  direction: 1 | -1,
  mode: { readonly coarse?: boolean; readonly fine?: boolean } = {},
): number => scrubbed(def, current, direction * SCRUB_PX_PER_STEP, mode);

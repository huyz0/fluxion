// Style stage (06-ai-authoring.md §3, ADR-0030): FluxScript style values to the document's `Style`. Token names become token references
// (`color.primary` → `{color.primary}`), `tone` becomes `style.variant`, a stroke preset becomes a dash, and an edge op says its markers
// and whether it is dashed. Theme defaults are referenced through the variant, never copied (02 §2).
import type { AnchorRef, Marker, Paint, Style } from '@fluxion/schema';
import type { EdgeOp } from '../parse/edge.js';
import type { LocatedStyle, StyleAst } from '../read/ast.js';

const TOKEN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;

/** The dash of each stroke preset, px; `solid` states no dash, over a theme's. */
const DASHES: { readonly [preset in 'solid' | 'dashed' | 'dotted']: readonly number[] } = { solid: [], dashed: [8, 4], dotted: [2, 4] };

/** A style value as the document holds it: a token name as a reference, anything else as written. */
export function styleValue(v: string | number | boolean): unknown {
  return typeof v === 'string' && TOKEN.test(v) ? `{${v}}` : v;
}

/** A background: a token name as a reference, else a colour as written. */
export function paintOf(v: string): Paint {
  return styleValue(v) as Paint;
}

type Mutable = { [key: string]: unknown };

/** Set `value` at the dot path `path` of `into`, making the objects on the way. */
function setPath(into: Mutable, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    into[head] = value;
    return;
  }
  const next = into[head];
  const child: Mutable = typeof next === 'object' && next !== null && !Array.isArray(next) ? (next as Mutable) : {};
  into[head] = child;
  setPath(child, rest, value);
}

/** The style path a key names: dot paths as written (`stroke.width`, `font.size`); `stroke` alone is its colour, or its width for a number. */
function pathOf(key: string, value: string | number | boolean): readonly string[] {
  if (key === 'stroke') return ['stroke', typeof value === 'number' ? 'width' : 'color'];
  return key.split('.');
}

/** A map style or a stroke preset, merged into `into`. */
function apply(into: Mutable, style: StyleAst): void {
  if (typeof style === 'string') {
    setPath(into, ['stroke', 'dash'], [...DASHES[style]]);
    return;
  }
  for (const [key, value] of Object.entries(style)) setPath(into, pathOf(key, value), key === 'variant' ? String(value) : styleValue(value));
}

/** What styles an element: its `style`, its `tone`, and for an async edge its dash. */
export type StyleInput = {
  /** The `style:` of the source. */
  readonly style?: LocatedStyle | undefined;
  /** The `tone:` of a node: the theme variant. */
  readonly tone?: string | undefined;
  /** A dash the element has unless its style says otherwise (an async edge). */
  readonly dashed?: boolean;
};

/** The document style of an element, or undefined when it has none. */
export function styleOf({ style, tone, dashed }: StyleInput): Style | undefined {
  const out: Mutable = {};
  if (dashed) apply(out, 'dashed');
  if (style) apply(out, style.value);
  // tone and a style's `variant` are the same field; tone wins
  if (tone !== undefined) out['variant'] = tone;
  return Object.keys(out).length > 0 ? (out as Style) : undefined;
}

/** What an edge op draws: its markers, and whether it is dashed (ADR-0030 op table). */
export function opStyle(op: EdgeOp): { readonly markers: { readonly start: Marker; readonly end: Marker }; readonly dashed: boolean } {
  const arrow = (start: boolean, end: boolean) => ({ start: start ? 'arrow' : 'none', end: end ? 'arrow' : 'none' }) as const;
  switch (op) {
    case '->':
      return { markers: arrow(false, true), dashed: false };
    case '<-':
      return { markers: arrow(true, false), dashed: false };
    case '<->':
      return { markers: arrow(true, true), dashed: false };
    case '--':
      return { markers: arrow(false, false), dashed: false };
    case '~>':
      return { markers: arrow(false, true), dashed: true };
  }
}

const SIDES = new Set(['n', 'e', 's', 'w']);

/** An edge end's anchor suffix as an anchor: a side (`api.e`), a named anchor (`db.out-1`), or auto when there is none. */
export function anchorOf(anchor: string | undefined): AnchorRef {
  if (anchor === undefined) return { kind: 'auto' };
  if (SIDES.has(anchor)) return { kind: 'side', side: anchor as 'n' | 'e' | 's' | 'w' };
  return { kind: 'named', name: anchor };
}

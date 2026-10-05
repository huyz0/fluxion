// The token model's types (FR-THM-001): a DTCG-shaped tree of groups and tokens, and a theme. Their own file, so the plain checks (token-check.ts) and the
// Zod schemas (tokens.ts) both state the model's rules against them without importing each other.

/**
 * A length in px (DTCG `dimension`).
 *
 * @public
 */
export type Dimension = {
  /** The length. */
  readonly value: number;
  /** The unit (px only in M4). */
  readonly unit: 'px';
};

/**
 * A design token of DTCG type `T` holding a value of type `V`.
 *
 * @public
 */
export type TypedToken<T extends string, V> = {
  /** The DTCG type. */
  readonly $type: T;
  /** The value. */
  readonly $value: V;
  /** What the token is for. */
  readonly $description?: string;
  /** Data of other tools, kept and never emitted; `dev.fluxion.transform` holds the steps of a derived colour (ADR-0152). */
  readonly $extensions?: { readonly [key: string]: unknown };
};

/**
 * A duration in milliseconds (DTCG `duration`).
 *
 * @public
 */
export type Duration = {
  /** The length of time. */
  readonly value: number;
  /** The unit (ms only). */
  readonly unit: 'ms';
};

/**
 * A drop shadow (DTCG `shadow`): a colour and lengths in px.
 *
 * @public
 */
export type ShadowValue = {
  /** The shadow colour (a literal CSS colour). */
  readonly color: string;
  /** Horizontal offset, px. */
  readonly offsetX: number;
  /** Vertical offset, px. */
  readonly offsetY: number;
  /** Blur radius, px (not negative). */
  readonly blur: number;
  /** Spread, px. */
  readonly spread: number;
};

/**
 * One design token (DTCG): a typed value. A `color` token's value may also be an alias to another token (`{color.primary}`).
 *
 * @public
 */
export type Token =
  | TypedToken<'color', string>
  | TypedToken<'dimension', Dimension>
  | TypedToken<'fontFamily', string | readonly string[]>
  | TypedToken<'fontWeight', number>
  | TypedToken<'number', number>
  | TypedToken<'shadow', ShadowValue>
  | TypedToken<'duration', Duration>
  | TypedToken<'cubicBezier', readonly [number, number, number, number]>;

/**
 * A group of tokens and nested groups, keyed by name (DTCG).
 *
 * @public
 */
export type TokenGroup = { readonly [name: string]: Token | TokenGroup };

/**
 * A theme: its name, its token tree and per-element-kind default styles (read by `resolveStyle`).
 *
 * @public
 */
export type Theme = {
  /** Theme name, e.g. `light`. */
  readonly name: string;
  /** The DTCG token tree: `color`, `font`, `space`, `radius`, `stroke`, … */
  readonly tokens: TokenGroup;
  /** Default styles by element kind (`shape`, `connector`, …); values may be token references. */
  readonly defaults?: { readonly [kind: string]: { readonly [field: string]: unknown } };
};

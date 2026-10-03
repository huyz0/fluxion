// The layered resolver of styles (02 §2 resolution order): the first layer that holds a valid value for
// a field wins, the fallbacks last; token refs become `var(--fx-…)`, unknown ones are reported. Shared by
// resolve-style.ts and effects.ts.
import { colorSchema, DIAGNOSTIC_CODES, type Diagnostic, jsonPointer, type TokenRef } from '@fluxion/schema';
import { type ColorResolver, colorResolver, needsResolving } from './alias.js';
import { familyCss, resolveToken, tokenPath } from './resolve.js';
import { cssVarName, FAMILY, isValidToken, type Theme, TOKEN_REF } from './tokens.js';

/** One layer of values and where it sits, for diagnostics. */
export type Layer = { readonly values: unknown; readonly at: ReadonlyArray<string | number> };

// the strict reference syntax (names only), so a ref can never put other CSS into a var() name
export const isRef = (v: unknown): v is TokenRef => typeof v === 'string' && TOKEN_REF.test(v);
export const isObject = (v: unknown): v is { readonly [k: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The value at `path` in `values`, or undefined. */
export const at = (values: unknown, path: readonly string[]): unknown => path.reduce<unknown>((v, k) => (isObject(v) ? v[k] : undefined), values);

/** The resolution context: the theme, the layers, and the diagnostics it collects. */
export class Resolver {
  readonly diagnostics: Diagnostic[] = [];
  readonly theme: Theme;
  readonly layers: readonly Layer[];
  readonly fallback: unknown;
  /** Resolves colour tokens (aliases and derived colours), sharing its work across this resolver's lookups. */
  private readonly follow: ColorResolver;

  constructor(theme: Theme, layers: readonly Layer[], fallback: unknown) {
    this.theme = theme;
    this.layers = layers;
    this.fallback = fallback;
    this.follow = colorResolver(theme);
  }

  /**
   * A token ref as `var(--fx-…)`, or undefined (reported) when the theme has no such token
   * or its value is not a valid token (a theme object never parsed; M4.10 review round 2 F1).
   */
  ref(ref: TokenRef, where: ReadonlyArray<string | number>): string | undefined {
    const token = resolveToken(this.theme, ref);
    // an alias is a colour only when its chain ends in a literal (unknown and cyclic ones are reported, not referenced)
    const alias = token.ok && needsResolving(token.value) ? this.follow(tokenPath(ref)) : undefined;
    if (token.ok && isValidToken(token.value) && alias?.ok !== false) return `var(${cssVarName(tokenPath(ref))})`;
    this.diagnostics.push({
      code: 'FLX_TOKEN_UNKNOWN',
      severity: DIAGNOSTIC_CODES.FLX_TOKEN_UNKNOWN,
      path: jsonPointer([...where]),
      message: !token.ok ? token.error.message : alias?.ok === false ? alias.error.message : `token ${ref} of theme ${this.theme.name} is not a valid token`,
    });
    return undefined;
  }

  /** The first layer's value at `path` that `convert` accepts; the fallback's otherwise. */
  pick<T>(path: readonly string[], convert: (v: unknown, where: ReadonlyArray<string | number>) => T | undefined): T {
    for (const layer of this.layers) {
      const v = at(layer.values, path);
      if (v === undefined) continue;
      const out = convert(v, [...layer.at, ...path]);
      if (out !== undefined) return out;
    }
    return convert(at(this.fallback, path), []) as T;
  }

  /** A colour field: literal, token ref, or transformed token (color-mix in OKLCH). */
  color: (v: unknown, where: ReadonlyArray<string | number>) => string | undefined = (v, where) => {
    if (isRef(v)) return this.ref(v, where);
    // only a CSS colour: a literal from unvalidated theme defaults cannot carry other CSS (M4.10 review F2)
    if (typeof v === 'string') return colorSchema.safeParse(v).success ? v : undefined;
    if (isObject(v) && isRef(v['token'])) {
      const base = this.ref(v['token'], [...where, 'token']);
      return base === undefined ? undefined : transformed(base, isObject(v['transform']) ? v['transform'] : {});
    }
    return undefined;
  };

  /** A numeric field with a CSS unit (`px`, or '' for unitless): number or token ref. */
  number: (unit: string) => (v: unknown, where: ReadonlyArray<string | number>) => string | undefined = (unit) => (v, where) =>
    isRef(v) ? this.ref(v, where) : typeof v === 'number' && Number.isFinite(v) ? `${v}${unit}` : undefined;

  /** A font family: a token ref, or one name quoted and escaped as CSS (markup and control characters refused). */
  family: (v: unknown, where: ReadonlyArray<string | number>) => string | undefined = (v, where) =>
    isRef(v) ? this.ref(v, where) : typeof v === 'string' && FAMILY.test(v) ? familyCss(v) : undefined;

  /** A keyword field: only a value of its allow-list (M4.10 review F2). */
  keyword: (allowed: ReadonlySet<string>) => (v: unknown) => string | undefined = (allowed) => (v) => (typeof v === 'string' && allowed.has(v) ? v : undefined);
}

/** `v` clamped to [min, max] when it is a finite number; `otherwise` when it is not. */
export const finiteIn = (v: unknown, min: number, max: number, otherwise: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : otherwise;

/** A colour with a ColorTransform: lighten mixes with white (black when negative), alpha with transparent. */
export function transformed(base: string, t: { readonly [k: string]: unknown }): string {
  let css = base;
  // finite and clamped, so the percentages are valid CSS (M4.10 review round 2 F2)
  const lighten = finiteIn(t['lighten'], -1, 1, 0);
  if (lighten !== 0) css = `color-mix(in oklch, ${css}, ${lighten > 0 ? 'white' : 'black'} ${Math.round(Math.abs(lighten) * 100)}%)`;
  const alpha = finiteIn(t['alpha'], 0, 1, 1);
  if (alpha !== 1) css = `color-mix(in oklch, ${css} ${Math.round(alpha * 100)}%, transparent)`;
  return css;
}

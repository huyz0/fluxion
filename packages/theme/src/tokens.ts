// The token model (FR-THM-001, 14-theme-text-media): a DTCG-shaped tree of groups and tokens. A token
// is an object with `$value` and `$type`; everything else is a group. M4 carries the minimal set
// (colour roles, font families and scale, spacing, radii, stroke widths); M9 adds shadows, motion and
// theme records without renaming anything here.
import { colorSchema } from '@fluxion/schema';
import { z } from 'zod';

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
};

/**
 * One design token (DTCG): a typed value.
 *
 * @public
 */
export type Token =
  | TypedToken<'color', string>
  | TypedToken<'dimension', Dimension>
  | TypedToken<'fontFamily', string | readonly string[]>
  | TypedToken<'fontWeight', number>
  | TypedToken<'number', number>;

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

const NAME = /^[A-Za-z0-9_-]+$/;
// a family name reaches CSS quoted and escaped (cssValue); markup and control characters could still
// end a <style> element or an attribute, so they are refused (M4.9 review F2)
const FAMILY = /^[^\p{Cc}<>]+$/u;
const family = z.string().regex(FAMILY, 'a font family name has no control characters, "<" or ">"');
const described = { $description: z.string().optional() };
const tokenSchema = z.discriminatedUnion('$type', [
  // a literal CSS colour only: no value that could carry other CSS into a style (review F2)
  z.object({ $type: z.literal('color'), $value: colorSchema, ...described }),
  z.object({ $type: z.literal('dimension'), $value: z.object({ value: z.number().finite(), unit: z.literal('px') }), ...described }),
  z.object({ $type: z.literal('fontFamily'), $value: z.union([family, z.array(family).min(1)]), ...described }),
  z.object({ $type: z.literal('fontWeight'), $value: z.number().int().min(1).max(1000), ...described }),
  z.object({ $type: z.literal('number'), $value: z.number().finite(), ...described }),
]);

/** A token is any object with `$value`; a group has none (DTCG). */
const isTokenLike = (v: unknown): boolean => typeof v === 'object' && v !== null && '$value' in v;

const groupSchema: z.ZodType<TokenGroup> = z.lazy(() =>
  z.record(
    z.string().regex(NAME, 'token and group names are letters, digits, "_" and "-"'),
    z.unknown().superRefine((v, ctx) => {
      const r = isTokenLike(v) ? tokenSchema.safeParse(v) : groupSchema.safeParse(v);
      for (const issue of r.success ? [] : r.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    }),
  ),
) as z.ZodType<TokenGroup>;

/**
 * The CSS custom property of a token path: `color.primary` → `--fx-color-primary`. Names may hold "-",
 * so two paths can map to one property; `themeSchema` refuses such a theme.
 *
 * @public
 */
export const cssVarName = (path: string): string => `--fx-${path.split('.').join('-')}`;

/** Every token of `group` with its dot path, in tree order (core-internal to the package). */
export function tokenEntries(group: TokenGroup, prefix = ''): Array<readonly [string, Token]> {
  return Object.entries(group).flatMap(([name, node]) => {
    const path = prefix ? `${prefix}.${name}` : name;
    return isTokenLike(node) ? [[path, node as Token] as const] : tokenEntries(node as TokenGroup, path);
  });
}

/**
 * Schema of a {@link Theme} (FR-THM-001: "Theme JSON validates"). Two tokens whose CSS properties
 * coincide (`a.b-c` and `a-b.c` are both `--fx-a-b-c`) are refused (review F1).
 *
 * @public
 */
export const themeSchema: z.ZodType<Theme> = z
  .object({
    name: z.string().min(1),
    tokens: groupSchema,
    defaults: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  })
  .superRefine((theme, ctx) => {
    const seen = new Map<string, string>();
    for (const [path] of tokenEntries(theme.tokens)) {
      const name = cssVarName(path);
      const first = seen.get(name);
      if (first !== undefined) ctx.addIssue({ code: 'custom', path: ['tokens', ...path.split('.')], message: `${path} and ${first} are both ${name}` });
      else seen.set(name, path);
    }
  }) as z.ZodType<Theme>;

/**
 * Whether a tree node is a token (has `$value`).
 *
 * @public
 */
export const isToken = (node: Token | TokenGroup | undefined): node is Token => isTokenLike(node);

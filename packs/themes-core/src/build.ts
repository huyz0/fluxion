// Building the pack's themes (FR-THM-003): every theme has the structure of the built-in light theme (typography, spacing, radii,
// stroke widths, shadows, motion, the per-kind defaults) with its own palette and a few of its own values.
import { LIGHT_THEME, type Theme, type ThemeDef } from '@fluxion/sdk';

/** The colour roles of a theme (FR-THM-001). */
export type Palette = {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  readonly primary: string;
  readonly secondary: string;
  /** accent-1 to accent-6. */
  readonly accents: readonly [string, string, string, string, string, string];
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly info: string;
  readonly connector: string;
};

/** What a theme changes besides its colours. */
export type Extras = {
  /** Replaces whole token groups of the light theme (`font`, `radius`, `stroke`, `shadow`, `motion`, ...). */
  readonly groups?: Theme['tokens'];
  /** Replaces the per-kind defaults. */
  readonly defaults?: NonNullable<Theme['defaults']>;
};

/** One node of a token tree: a token or a group. */
type Node = Theme['tokens'][string];

const color = ($value: string): Node => ({ $type: 'color', $value });
/** A length in px. */
export const px = (value: number): Node => ({ $type: 'dimension', $value: { value, unit: 'px' } });
/** A font family list. */
export const family = (...$value: string[]): Node => ({ $type: 'fontFamily', $value });

/** The `color` group of `p`. */
function colors(p: Palette): Theme['tokens'] {
  return {
    background: color(p.background),
    surface: color(p.surface),
    text: color(p.text),
    muted: color(p.muted),
    primary: color(p.primary),
    secondary: color(p.secondary),
    ...Object.fromEntries(p.accents.map((c, i) => [`accent-${i + 1}`, color(c)])),
    success: color(p.success),
    warning: color(p.warning),
    danger: color(p.danger),
    info: color(p.info),
    connector: color(p.connector),
  };
}

/** `name` as a registry id slug: lower case, runs of other characters as one `-`. */
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * A theme of the pack: the light theme's structure, `palette`'s colours and the `extras`.
 */
export function makeTheme(name: string, palette: Palette, extras: Extras = {}): ThemeDef {
  return {
    ...LIGHT_THEME,
    ...(extras.defaults === undefined ? {} : { defaults: extras.defaults }),
    id: `themes-core:${slug(name)}`,
    name,
    tokens: { ...LIGHT_THEME.tokens, ...extras.groups, color: colors(palette) },
  };
}

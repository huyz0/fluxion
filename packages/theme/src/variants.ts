// The built-in style variants (FR-THM-006, ADR-0055): `primary`, `subtle`, `outline` and `emphasis` for each element kind that
// takes them, as token refs, so a theme edit restyles a variant element through the screen's CSS variables alone. Every built-in
// theme spreads them into its `defaults[kind].variants`; the player reaches this table and nothing else of the theme studio.
import type { Style } from '@fluxion/schema';

/** A shape's (and a frame's) variants: fill, outline and the text on it. */
const BOXED: { readonly [name: string]: Style } = {
  primary: { fill: '{color.primary}', stroke: { color: '{color.primary}' }, font: { color: '{color.background}' } },
  subtle: { fill: '{color.surface}', stroke: { color: '{color.muted}', width: '{stroke.thin}' }, font: { color: '{color.text}' } },
  outline: { fill: 'transparent', stroke: { color: '{color.primary}' }, font: { color: '{color.primary}' } },
  emphasis: {
    fill: '{color.secondary}',
    stroke: { color: '{color.secondary}', width: '{stroke.thick}' },
    font: { color: '{color.background}', weight: 700 },
  },
};

/**
 * The built-in variants by element kind: `shape` and `frame`, `connector` and `text` (ADR-0055's table).
 *
 * @public
 */
export const BUILTIN_VARIANTS: { readonly [kind: string]: { readonly [name: string]: Style } } = {
  shape: BOXED,
  frame: BOXED,
  connector: {
    primary: { stroke: { color: '{color.primary}' } },
    subtle: { stroke: { color: '{color.muted}', width: '{stroke.thin}' } },
    outline: { stroke: { color: '{color.primary}', dash: [6, 4] } },
    emphasis: { stroke: { color: '{color.secondary}', width: '{stroke.thick}' } },
  },
  text: {
    primary: { font: { color: '{color.primary}' } },
    subtle: { font: { color: '{color.muted}' } },
    outline: { font: { color: '{color.primary}', weight: 400 } },
    emphasis: { font: { color: '{color.text}', weight: 700 } },
  },
};

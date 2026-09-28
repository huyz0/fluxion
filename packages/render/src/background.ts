// Screen backgrounds (FR-SCR-001): a resolved paint (theme resolveBackground) as the background
// layer's CSS. Every string in it was validated by the theme, and an image's asset id never reaches
// CSS: until the asset store arrives (M10) an image shows a placeholder pattern and carries its id
// as a data attribute.
import type { ResolvedPaint } from '@fluxion/theme';
import type { CSSProperties } from 'react';

/** CSS angles run from the top; the document's 0° runs left to right (02 §Style, GradientPaint). */
const CSS_ANGLE_OFFSET = 90;

/** The placeholder of an image fill until assets are resolved (M10): a muted diagonal hatch. */
const IMAGE_PLACEHOLDER = 'repeating-linear-gradient(45deg, var(--fx-color-muted, #64748b) 0 2px, transparent 2px 12px)';

const stopList = (stops: ReadonlyArray<{ readonly offset: number; readonly css: string }>) =>
  stops.map((s) => `${s.css} ${Math.round(s.offset * 10000) / 100}%`).join(', ');

/**
 * The CSS of a background layer for `paint`.
 *
 * @public
 */
export function paintCss(paint: ResolvedPaint): CSSProperties {
  switch (paint.type) {
    case 'color':
      return { backgroundColor: paint.css };
    case 'linear-gradient':
      return { backgroundImage: `linear-gradient(${paint.angle + CSS_ANGLE_OFFSET}deg, ${stopList(paint.stops)})` };
    case 'radial-gradient':
      return { backgroundImage: `radial-gradient(circle, ${stopList(paint.stops)})` };
    case 'image':
      return { backgroundImage: IMAGE_PLACEHOLDER };
    default:
      return {};
  }
}

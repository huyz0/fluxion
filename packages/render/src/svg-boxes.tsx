// The svg-surface leaves of the boxed built-ins that are not shapes (ADR-0056 items 8 and 9, FR-EXP-004): a frame's box in its
// resolved style (its members' clip is drawn by the surface, in screen coordinates), and an image from its asset's `data:` URL,
// cropped, fitted and masked as the html leaf draws it. Colours are literals; an image the export has no bytes for is reported and
// left out, never fetched.
import { evaluateOutline } from '@fluxion/core';
import type { FrameElement, ImageElement } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { type ReactNode, useId } from 'react';
import type { ImageSource } from './assets.js';
import { concreteLength } from './css-values.js';
import { ASPECT } from './image-fit.js';
import { pathData } from './path-data.js';
import type { ElementViewProps } from './registries.js';
import { n3, opacityOf, strokeAttrs, svgPaint } from './svg-paint.js';
import { useSvgImage } from './svg-surface.js';

/**
 * The svg-surface view of `kind: 'frame'` elements: its box, filled (a colour only, as the html leaf) and stroked in its style.
 *
 * @public
 */
export function FrameSvg(props: ElementViewProps): ReactNode {
  const { theme } = props;
  const element = props.element as FrameElement;
  const { style } = resolveStyle(element.style, 'frame', theme, ['records', element.id, 'style']);
  const { w, h } = element.transform;
  const fill = style.fill.type === 'color' ? svgPaint(style.fill, '', { w, h }, theme).fill : 'none';
  const radius = concreteLength(style.radius, theme);
  const opacity = opacityOf(style.opacity, theme);
  return (
    <rect
      x={0}
      y={0}
      width={n3(w)}
      height={n3(h)}
      rx={radius > 0 ? n3(radius) : undefined}
      fill={fill}
      {...strokeAttrs(style.stroke, theme)}
      opacity={opacity === 1 ? undefined : opacity}
    />
  );
}

/**
 * The image fitted into the box. Uncropped, one `<image>`; cropped (fractions of the image, which needs its natural size), the crop is
 * the viewBox of a nested `<svg>` and a clip too, as the html leaf draws it. Without a recorded size the crop is ignored.
 */
function picture(element: ImageElement, image: ImageSource, cropId: string): ReactNode {
  const { w, h } = element.transform;
  const fit = ASPECT[element.fit ?? 'contain'];
  const { crop } = element;
  if (crop === undefined || image.w === undefined || image.h === undefined)
    return <image x={0} y={0} xlinkHref={image.href} width={n3(w)} height={n3(h)} preserveAspectRatio={fit} />;
  const [x, y, cw, ch] = [crop.x * image.w, crop.y * image.h, crop.w * image.w, crop.h * image.h];
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the element's words are the title of the group around it
    <svg x={0} y={0} width={n3(w)} height={n3(h)} viewBox={`${n3(x)} ${n3(y)} ${n3(cw)} ${n3(ch)}`} preserveAspectRatio={fit}>
      <clipPath id={cropId}>
        <rect x={n3(x)} y={n3(y)} width={n3(cw)} height={n3(ch)} />
      </clipPath>
      <image xlinkHref={image.href} width={image.w} height={image.h} preserveAspectRatio="none" clipPath={`url(#${cropId})`} />
    </svg>
  );
}

/**
 * The svg-surface view of `kind: 'image'` elements: its asset's `data:` URL, cropped, fitted and masked by a shape outline.
 *
 * @public
 */
export function ImageSvg(props: ElementViewProps): ReactNode {
  const { store, theme, registries } = props;
  const element = props.element as ImageElement;
  const { w, h } = element.transform;
  const ids = useId().replace(/[^\w-]/g, '');
  const image = useSvgImage(store, element.assetId, element.id);
  const { style } = resolveStyle(element.style, 'image', theme, ['records', element.id, 'style']);
  const mask = element.maskDefId === undefined ? undefined : registries.shapeDefs.get(element.maskDefId);
  const clip = mask === undefined ? undefined : evaluateOutline(mask, { w, h });
  const opacity = opacityOf(style.opacity, theme);
  if (image === undefined) return null;
  return (
    <g opacity={opacity === 1 ? undefined : opacity}>
      {clip?.ok ? (
        <defs>
          <clipPath id={`fx-mask-${ids}`}>
            <path d={pathData(clip.value.commands)} />
          </clipPath>
        </defs>
      ) : null}
      <g clipPath={clip?.ok ? `url(#fx-mask-${ids})` : undefined}>{picture(element, image, `fx-crop-${ids}`)}</g>
    </g>
  );
}

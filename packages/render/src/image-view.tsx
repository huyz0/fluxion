// The image view (FR-SHP-012): the element's asset, cropped (fractions of the image) and fitted into the
// box (contain, cover or fill), optionally masked by any shape definition's outline as a clip path.
// Images draw only from the host's asset URLs (assets.ts); without one the box stays empty.
import { evaluateOutline } from '@fluxion/core';
import type { ImageElement } from '@fluxion/schema';
import { resolveStyle } from '@fluxion/theme';
import { type ReactNode, useId, useMemo } from 'react';
import { type ImageSource, useImage } from './assets.js';
import { pathData } from './path-data.js';
import type { ElementViewProps } from './registries.js';

/** How each fit places the (cropped) image in the box, as SVG preserveAspectRatio (CSS object-fit). */
const FIT: { readonly [fit: string]: string } = { contain: 'xMidYMid meet', cover: 'xMidYMid slice', fill: 'none' };

/**
 * The view of `kind: 'image'` elements.
 *
 * @public
 */
export function ImageView(props: ElementViewProps): ReactNode {
  const { store, theme, registries } = props;
  const element = props.element as ImageElement;
  const { w, h } = element.transform;
  const ids = useId().replace(/[^\w-]/g, '');
  const image = useImage(store, element.assetId);
  const { style } = useMemo(() => resolveStyle(element.style, 'image', theme, ['records', element.id, 'style']), [element.style, theme, element.id]);
  const mask = element.maskDefId === undefined ? undefined : registries.shapeDefs.get(element.maskDefId);
  const clip = useMemo(() => (mask === undefined ? undefined : evaluateOutline(mask, { w, h })), [mask, w, h]);
  return (
    <>
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ opacity: style.opacity }} data-asset-id={element.assetId}>
        {clip?.ok ? (
          <defs>
            <clipPath id={`fx-mask-${ids}`}>
              <path d={pathData(clip.value.commands)} />
            </clipPath>
          </defs>
        ) : null}
        {image === undefined ? null : <g clipPath={clip?.ok ? `url(#fx-mask-${ids})` : undefined}>{picture(element, image, `fx-crop-${ids}`)}</g>}
      </svg>
      {props.children}
    </>
  );
}

/**
 * The image fitted into the element's box. Uncropped, one `<image>` whose own aspect the browser keeps.
 * Cropped, the crop (fractions of the image, so it needs the asset's natural size) is the viewBox of a
 * nested svg and a clip path too, since an svg clips at its viewport, not its viewBox, and contain
 * would show the cut-away parts in its bands (M5.15 review F1). Without a recorded size the crop is
 * ignored rather than guessed, which would distort the image (review F2).
 */
function picture(element: ImageElement, image: ImageSource, cropId: string): ReactNode {
  const { w, h } = element.transform;
  const fit = FIT[element.fit ?? 'contain'];
  const { crop } = element;
  if (crop === undefined || image.w === undefined || image.h === undefined)
    return <image className="fx-image" href={image.href} width={w} height={h} preserveAspectRatio={fit} />;
  const [x, y, cw, ch] = [crop.x * image.w, crop.y * image.h, crop.w * image.w, crop.h * image.h];
  return (
    <svg className="fx-image" aria-hidden="true" width={w} height={h} viewBox={`${x} ${y} ${cw} ${ch}`} preserveAspectRatio={fit}>
      <clipPath id={cropId}>
        <rect x={x} y={y} width={cw} height={ch} />
      </clipPath>
      <image href={image.href} width={image.w} height={image.h} preserveAspectRatio="none" clipPath={`url(#${cropId})`} />
    </svg>
  );
}

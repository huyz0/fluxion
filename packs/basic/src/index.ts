// Public entry of @fluxion/pack-basic; the package comment is the dts banner in tsdown.config.ts.
import { definePack, type Pack } from '@fluxion/sdk';
import { basicMarkers } from './markers.js';
import { blockArrow } from './shapes/block-arrow.js';
import { callout } from './shapes/callout.js';
import { cloud } from './shapes/cloud.js';
import { cylinder } from './shapes/cylinder.js';
import { diamond } from './shapes/diamond.js';
import { document } from './shapes/document.js';
import { ellipse } from './shapes/ellipse.js';
import { freehand } from './shapes/freehand.js';
import { hexagon } from './shapes/hexagon.js';
import { imageFrame } from './shapes/image-frame.js';
import { line } from './shapes/line.js';
import { note } from './shapes/note.js';
import { octagon } from './shapes/octagon.js';
import { parallelogram } from './shapes/parallelogram.js';
import { polyline } from './shapes/polyline.js';
import { rect } from './shapes/rect.js';
import { roundedRect } from './shapes/rounded-rect.js';
import { star } from './shapes/star.js';
import { textBox } from './shapes/text-box.js';
import { trapezoid } from './shapes/trapezoid.js';
import { triangle } from './shapes/triangle.js';

/**
 * Version of this package.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/**
 * The basic shapes (FR-SHP-002) and connector markers (FR-CON-003), namespace `basic`. Hosts register it into their core registries
 * (ADR-0017): `basicPack.register(registries)`.
 *
 * @public
 */
export const basicPack: Pack = definePack({
  id: 'basic',
  shapes: [
    rect,
    roundedRect,
    ellipse,
    triangle,
    diamond,
    parallelogram,
    trapezoid,
    hexagon,
    octagon,
    star,
    blockArrow,
    callout,
    cloud,
    cylinder,
    document,
    note,
    line,
    polyline,
    freehand,
    textBox,
    imageFrame,
  ],
  markers: basicMarkers,
});

export {
  basicMarkers,
  blockArrow,
  callout,
  cloud,
  cylinder,
  diamond,
  document,
  ellipse,
  freehand,
  hexagon,
  imageFrame,
  line,
  note,
  octagon,
  parallelogram,
  polyline,
  rect,
  roundedRect,
  star,
  textBox,
  trapezoid,
  triangle,
};

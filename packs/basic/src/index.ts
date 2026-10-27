// Public entry of @fluxion/pack-basic; the package comment is the dts banner in tsdown.config.ts.
import { type DeclarativeShapePack, definePack, type Pack } from '@fluxion/sdk';
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
 * Version of this package; also the version of its declarative distribution in `pack/`.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/**
 * The basic pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution is
 * built from.
 *
 * @public
 */
export const basicSource: DeclarativeShapePack = {
  id: 'basic',
  version: VERSION,
  name: 'Basic shapes',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  credits: [
    {
      id: 'fluxion',
      license: 'MIT',
      attribution: 'Fluxion contributors',
      notice: 'Copyright (c) 2026 Fluxion contributors. Released under the MIT License.',
      source: { kind: 'original', author: 'Fluxion contributors', statement: 'Original artwork drawn for Fluxion.' },
    },
  ],
  definitions: [
    { name: 'Rectangle', def: rect },
    { name: 'Rounded rectangle', def: roundedRect },
    { name: 'Ellipse', def: ellipse },
    { name: 'Triangle', def: triangle },
    { name: 'Diamond', def: diamond },
    { name: 'Parallelogram', def: parallelogram },
    { name: 'Trapezoid', def: trapezoid },
    { name: 'Hexagon', def: hexagon },
    { name: 'Octagon', def: octagon },
    { name: 'Star', def: star },
    { name: 'Block arrow', def: blockArrow },
    { name: 'Callout', def: callout },
    { name: 'Cloud', def: cloud },
    { name: 'Cylinder', def: cylinder },
    { name: 'Document', def: document },
    { name: 'Note', def: note },
    { name: 'Line', def: line },
    { name: 'Polyline', def: polyline },
    { name: 'Freehand', def: freehand },
    { name: 'Text box', def: textBox },
    { name: 'Image frame', def: imageFrame },
  ],
};

/**
 * The basic shapes (FR-SHP-002) and connector markers (FR-CON-003), namespace `basic`. Hosts register it into their core registries
 * (ADR-0017): `basicPack.register(registries)`.
 *
 * @public
 */
export const basicPack: Pack = definePack({
  id: 'basic',
  shapes: basicSource.definitions.map(({ def }) => def),
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

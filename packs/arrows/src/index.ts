// Public entry of @fluxion/pack-arrows; the package comment is the dts banner in tsdown.config.ts.
import { type DeclarativeShapePack, definePack, namedShapeDefs, type Pack } from '@fluxion/sdk';
import { shapes } from './shapes.js';

/**
 * Version of this package; also the version of its declarative distribution in `pack/`.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/** Library display names by definition id. */
const NAMES: Readonly<Record<string, string>> = {
  'arrows:right': 'Right arrow',
  'arrows:left': 'Left arrow',
  'arrows:up': 'Up arrow',
  'arrows:down': 'Down arrow',
  'arrows:left-right': 'Left-right arrow',
  'arrows:up-down': 'Up-down arrow',
  'arrows:quad': 'Quad arrow',
  'arrows:notched-right': 'Notched right arrow',
  'arrows:striped-right': 'Striped right arrow',
  'arrows:chevron': 'Chevron',
  'arrows:pentagon': 'Pentagon arrow',
  'arrows:bent-right': 'Bent arrow',
  'arrows:bent-up': 'Bent-up arrow',
  'arrows:u-turn': 'U-turn arrow',
  'arrows:curved-right': 'Curved right arrow',
  'arrows:circular': 'Circular arrow',
  'arrows:callout-right': 'Right arrow callout',
  'arrows:split': 'Split arrow',
};

/**
 * The Arrows pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const arrowsSource: DeclarativeShapePack = {
  id: 'arrows',
  version: VERSION,
  name: 'Arrows',
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
  definitions: namedShapeDefs(shapes, NAMES),
};

/**
 * The Arrows shapes, namespace `arrows`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const arrowsPack: Pack = definePack({ id: 'arrows', shapes: shapes });

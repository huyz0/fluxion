// Public entry of @fluxion/pack-callouts; the package comment is the dts banner in tsdown.config.ts.
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
  'callouts:speech-rect': 'Rectangular speech bubble',
  'callouts:speech-rounded': 'Rounded speech bubble',
  'callouts:speech-oval': 'Oval speech bubble',
  'callouts:speech-left': 'Speech bubble, tail left',
  'callouts:thought': 'Thought bubble',
  'callouts:shout': 'Shout',
  'callouts:line': 'Line callout',
  'callouts:sticky-note': 'Sticky note',
  'callouts:tag': 'Tag',
  'callouts:pin': 'Pin',
  'callouts:quote': 'Quote',
  'callouts:brace': 'Brace',
  'callouts:bracket': 'Bracket',
};

/**
 * The Callouts pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const calloutsSource: DeclarativeShapePack = {
  id: 'callouts',
  version: VERSION,
  name: 'Callouts',
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
 * The Callouts shapes, namespace `callouts`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const calloutsPack: Pack = definePack({ id: 'callouts', shapes: shapes });

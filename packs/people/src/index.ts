// Public entry of @fluxion/pack-people; the package comment is the dts banner in tsdown.config.ts.
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
  'people:person': 'Person',
  'people:person-add': 'Add person',
  'people:person-check': 'Verified person',
  'people:guest': 'Guest',
  'people:pair': 'Pair',
  'people:group': 'Group',
  'people:admin': 'Administrator',
  'people:developer': 'Developer',
  'people:support': 'Support agent',
  'people:bot': 'Bot',
};

/**
 * The People pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const peopleSource: DeclarativeShapePack = {
  id: 'people',
  version: VERSION,
  name: 'People',
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
 * The People shapes, namespace `people`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const peoplePack: Pack = definePack({ id: 'people', shapes: shapes });

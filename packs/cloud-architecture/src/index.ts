// Public entry of @fluxion/pack-cloud-architecture; the package comment is the dts banner in tsdown.config.ts.
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
  'cloud:compute': 'Compute',
  'cloud:container': 'Container',
  'cloud:function': 'Function',
  'cloud:cluster': 'Cluster',
  'cloud:object-storage': 'Object storage',
  'cloud:block-storage': 'Block storage',
  'cloud:database': 'Database',
  'cloud:cache': 'Cache',
  'cloud:queue': 'Queue',
  'cloud:pub-sub': 'Pub/sub topic',
  'cloud:api-gateway': 'API gateway',
  'cloud:cdn': 'CDN',
  'cloud:dns': 'DNS',
  'cloud:identity': 'Identity',
  'cloud:monitoring': 'Monitoring',
  'cloud:region': 'Region',
  'cloud:zone': 'Availability zone',
  'cloud:private-network': 'Private network',
};

/**
 * The Cloud architecture pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const cloudSource: DeclarativeShapePack = {
  id: 'cloud',
  version: VERSION,
  name: 'Cloud architecture',
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
 * The Cloud architecture shapes, namespace `cloud`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const cloudPack: Pack = definePack({ id: 'cloud', shapes: shapes });

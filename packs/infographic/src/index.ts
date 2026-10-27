// Public entry of @fluxion/pack-infographic; the package comment is the dts banner in tsdown.config.ts.
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
  'infographic:pie': 'Pie slice',
  'infographic:donut': 'Donut segment',
  'infographic:gauge': 'Gauge',
  'infographic:progress': 'Progress bar',
  'infographic:target': 'Target',
  'infographic:venn': 'Venn pair',
  'infographic:matrix': 'Two-by-two matrix',
  'infographic:funnel': 'Funnel',
  'infographic:funnel-layer': 'Funnel layer',
  'infographic:pyramid': 'Pyramid',
  'infographic:step-pill': 'Step pill',
  'infographic:number-badge': 'Number badge',
  'infographic:hexagon-tile': 'Hexagon tile',
  'infographic:stat-card': 'Stat card',
  'infographic:banner': 'Banner',
  'infographic:milestone': 'Milestone',
};

/**
 * The Infographic pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const infographicSource: DeclarativeShapePack = {
  id: 'infographic',
  version: VERSION,
  name: 'Infographic',
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
 * The Infographic shapes, namespace `infographic`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const infographicPack: Pack = definePack({ id: 'infographic', shapes: shapes });

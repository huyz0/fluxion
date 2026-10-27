// Public entry of @fluxion/pack-network; the package comment is the dts banner in tsdown.config.ts.
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
  'network:router': 'Router',
  'network:switch': 'Switch',
  'network:hub': 'Hub',
  'network:firewall': 'Firewall',
  'network:load-balancer': 'Load balancer',
  'network:server': 'Server',
  'network:rack': 'Rack',
  'network:storage': 'Network storage',
  'network:access-point': 'Access point',
  'network:internet': 'Internet',
  'network:subnet': 'Subnet',
  'network:bus': 'Network segment',
  'network:modem': 'Modem',
  'network:vpn': 'VPN',
};

/**
 * The Network pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const networkSource: DeclarativeShapePack = {
  id: 'network',
  version: VERSION,
  name: 'Network',
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
 * The Network shapes, namespace `network`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const networkPack: Pack = definePack({ id: 'network', shapes: shapes });

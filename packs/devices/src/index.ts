// Public entry of @fluxion/pack-devices; the package comment is the dts banner in tsdown.config.ts.
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
  'devices:desktop': 'Desktop',
  'devices:laptop': 'Laptop',
  'devices:phone': 'Phone',
  'devices:tablet': 'Tablet',
  'devices:watch': 'Watch',
  'devices:printer': 'Printer',
  'devices:keyboard': 'Keyboard',
  'devices:mouse': 'Mouse',
  'devices:camera': 'Camera',
  'devices:usb-drive': 'USB drive',
  'devices:tv': 'TV',
  'devices:speaker': 'Speaker',
  'devices:sensor': 'Sensor',
  'devices:iot-device': 'IoT device',
  'devices:thermostat': 'Thermostat',
};

/**
 * The Devices pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const devicesSource: DeclarativeShapePack = {
  id: 'devices',
  version: VERSION,
  name: 'Devices',
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
 * The Devices shapes, namespace `devices`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const devicesPack: Pack = definePack({ id: 'devices', shapes: shapes });

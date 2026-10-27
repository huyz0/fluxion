// Public entry of @fluxion/pack-flowchart; the package comment is the dts banner in tsdown.config.ts.
import { type DeclarativeShapePack, definePack, namedShapeDefs, type Pack } from '@fluxion/sdk';
import { flowchartShapes } from './shapes.js';

/**
 * Version of this package; also the version of its declarative distribution in `pack/`.
 *
 * @public
 */
export const VERSION: string = '0.0.0';

/** Library display names by definition id. */
const NAMES: Readonly<Record<string, string>> = {
  'flowchart:process': 'Process',
  'flowchart:alternate-process': 'Alternate process',
  'flowchart:decision': 'Decision',
  'flowchart:terminator': 'Terminator',
  'flowchart:predefined-process': 'Predefined process',
  'flowchart:preparation': 'Preparation',
  'flowchart:manual-operation': 'Manual operation',
  'flowchart:delay': 'Delay',
  'flowchart:data': 'Data',
  'flowchart:manual-input': 'Manual input',
  'flowchart:document': 'Document',
  'flowchart:multi-document': 'Multi document',
  'flowchart:database': 'Database',
  'flowchart:stored-data': 'Stored data',
  'flowchart:internal-storage': 'Internal storage',
  'flowchart:queue': 'Queue',
  'flowchart:display': 'Display',
  'flowchart:card': 'Card',
  'flowchart:connector': 'Connector',
  'flowchart:off-page-connector': 'Off-page connector',
  'flowchart:merge': 'Merge',
  'flowchart:extract': 'Extract',
  'flowchart:summing-junction': 'Summing junction',
  'flowchart:or': 'Or junction',
  'flowchart:annotation': 'Annotation',
};

/**
 * The Flowchart pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const flowchartSource: DeclarativeShapePack = {
  id: 'flowchart',
  version: VERSION,
  name: 'Flowchart',
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
  definitions: namedShapeDefs(flowchartShapes, NAMES),
};

/**
 * The Flowchart shapes, namespace `flowchart`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const flowchartPack: Pack = definePack({ id: 'flowchart', shapes: flowchartShapes });

export { flowchartShapes };

// Public entry of @fluxion/pack-uml; the package comment is the dts banner in tsdown.config.ts.
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
  'uml:class': 'Class',
  'uml:interface': 'Interface',
  'uml:object': 'Object',
  'uml:package': 'Package',
  'uml:component': 'Component',
  'uml:node': 'Node',
  'uml:artifact': 'Artifact',
  'uml:note': 'Note',
  'uml:provided-interface': 'Provided interface',
  'uml:actor': 'Actor',
  'uml:use-case': 'Use case',
  'uml:system-boundary': 'System boundary',
  'uml:lifeline': 'Lifeline',
  'uml:activation': 'Activation',
  'uml:fragment': 'Combined fragment',
  'uml:state': 'State',
  'uml:initial': 'Initial state',
  'uml:final': 'Final state',
  'uml:choice': 'Choice',
  'uml:fork': 'Fork/join bar',
};

/**
 * The UML pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const umlSource: DeclarativeShapePack = {
  id: 'uml',
  version: VERSION,
  name: 'UML',
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
 * The UML shapes, namespace `uml`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const umlPack: Pack = definePack({ id: 'uml', shapes: shapes });

// Public entry of @fluxion/pack-bpmn; the package comment is the dts banner in tsdown.config.ts.
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
  'bpmn:task': 'Task',
  'bpmn:subprocess': 'Sub-process',
  'bpmn:call-activity': 'Call activity',
  'bpmn:transaction': 'Transaction',
  'bpmn:start-event': 'Start event',
  'bpmn:intermediate-event': 'Intermediate event',
  'bpmn:end-event': 'End event',
  'bpmn:timer-event': 'Timer event',
  'bpmn:message-event': 'Message event',
  'bpmn:exclusive-gateway': 'Exclusive gateway',
  'bpmn:parallel-gateway': 'Parallel gateway',
  'bpmn:inclusive-gateway': 'Inclusive gateway',
  'bpmn:event-gateway': 'Event-based gateway',
  'bpmn:data-object': 'Data object',
  'bpmn:data-store': 'Data store',
  'bpmn:pool': 'Pool',
  'bpmn:lane': 'Lane',
  'bpmn:group': 'Group',
  'bpmn:annotation': 'Text annotation',
};

/**
 * The BPMN-lite pack's declarative source (ADR-0194): the index metadata, credits and named definitions its `pack/` distribution
 * is built from.
 *
 * @public
 */
export const bpmnSource: DeclarativeShapePack = {
  id: 'bpmn',
  version: VERSION,
  name: 'BPMN-lite',
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
 * The BPMN-lite shapes, namespace `bpmn`. Hosts register it into their core registries (ADR-0017), or load its declarative
 * distribution in `pack/` (ADR-0048).
 *
 * @public
 */
export const bpmnPack: Pack = definePack({ id: 'bpmn', shapes: shapes });

// The JSON Schema of FluxScript `flux: 1` (FR-AI-001, M14.25): generated from the reader's key table (`KEYS`), which is the source of truth because
// the reader is hand-written. Every compiled key needs a value schema below, so a key added to the table without one fails the generator (and its
// drift test); a deferred key is accepted with any value, as the compiler keeps it and warns. The committed copy is specs/schema/fluxscript.schema.json.
import { EDGE_DETAILS, KEYS } from './fields.js';

/** A JSON Schema fragment. */
type Schema = { readonly [keyword: string]: unknown };

/**
 * The JSON Schema of FluxScript as a plain object.
 *
 * @public
 */
export type FluxScriptJsonSchema = { readonly [keyword: string]: unknown };

const string: Schema = { type: 'string' };
const SLUG = '^[a-z][a-z0-9-]*$';
const STROKES = ['solid', 'dashed', 'dotted'];
const ROUTES = ['straight', 'curved', 'orthogonal', 'polyline'];

const style: Schema = {
  anyOf: [{ enum: STROKES }, { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] } }],
  description: 'token names by key, or solid, dashed or dotted',
};
const layout: Schema = {
  type: 'object',
  properties: { type: string },
  required: ['type'],
  description: 'a layout algorithm by name; the other keys are its options',
};
const pin: Schema = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
};

/** The value schema of every compiled key, by level. */
const VALUES: { readonly [level in keyof typeof KEYS]: { readonly [key: string]: Schema } } = {
  top: {
    flux: { const: 1 },
    title: string,
    theme: { anyOf: [string, { $ref: '#/$defs/theme' }] },
    uses: { type: 'array', items: string },
    lineJumps: { type: 'boolean', description: 'connectors hop where they cross, throughout the document' },
    screens: { type: 'array', items: { $ref: '#/$defs/screen' } },
  },
  theme: {
    preset: string,
    name: string,
    overrides: { type: 'object', additionalProperties: { type: ['string', 'number'] }, description: 'token values by token name' },
  },
  screen: {
    id: { type: 'string', pattern: SLUG },
    title: string,
    layout,
    background: string,
    nodes: { type: 'object', propertyNames: { pattern: SLUG }, additionalProperties: { $ref: '#/$defs/node' } },
    groups: { type: 'object', propertyNames: { pattern: SLUG }, additionalProperties: { $ref: '#/$defs/group' } },
    edges: { type: 'array', items: { $ref: '#/$defs/edge' } },
    notes: string,
  },
  node: { shape: string, text: string, label: string, tone: string, style, pin, alt: string },
  group: { label: string, contains: { type: 'array', items: string }, style, layout },
  edge: { from: string, to: string, op: string, label: string, style, route: { enum: ROUTES }, jumps: { enum: ['arc', 'gap', 'none'] } },
  pin: {},
};

/** The properties of one level: every compiled key with its schema, every deferred key with any value. */
function properties(level: keyof typeof KEYS): Schema {
  const out: { [key: string]: Schema } = {};
  for (const key of KEYS[level].compiled) {
    const value = VALUES[level][key];
    if (value === undefined) throw new Error(`the FluxScript key table has "${key}" at ${level} but json-schema.ts has no schema for it`);
    out[key] = value;
  }
  for (const key of KEYS[level].deferred) out[key] = { description: 'kept but not compiled yet (FLX_DSL_NOT_YET)' };
  return out;
}

/** An object that has exactly the keys of `level`. */
const closed = (level: keyof typeof KEYS, required: readonly string[], extra: Schema = {}): Schema => ({
  type: 'object',
  properties: properties(level),
  required,
  additionalProperties: false,
  ...extra,
});

/**
 * The JSON Schema (draft 2020-12) of a FluxScript file once its YAML is read as data: the keys of every level come from the reader's key table.
 *
 * @public
 */
export function fluxScriptJsonSchema(): FluxScriptJsonSchema {
  const compiledEdgeKeys = [...KEYS.edge.compiled];
  const detail = {
    type: 'object',
    properties: {
      ...Object.fromEntries(EDGE_DETAILS.map((k) => [k, VALUES.edge[k]])),
      ...Object.fromEntries(KEYS.edge.deferred.map((k) => [k, { description: 'kept but not compiled yet (FLX_DSL_NOT_YET)' }])),
    },
    additionalProperties: false,
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://fluxion.dev/schema/fluxscript.schema.json',
    title: 'FluxScript flux: 1',
    ...closed('top', ['flux', 'title', 'screens']),
    $defs: {
      theme: closed('theme', []),
      screen: {
        description: 'a screen; one with a kind is an archetype, kept whole with any other keys',
        anyOf: [closed('screen', ['id']), { type: 'object', required: ['id', 'kind'], properties: { id: VALUES.screen['id'], kind: string } }],
      },
      node: {
        ...closed('node', []),
        anyOf: [...['shape', 'text', 'label'], ...KEYS.node.deferred].map((key) => ({ required: [key] })),
      },
      group: closed('group', []),
      edge: {
        description: 'a -> b, a -> b: label (as text), a one-entry mapping { "a -> b": label or details }, or { from, to, op, label, style, route, jumps }',
        anyOf: [
          string,
          closed('edge', ['from', 'to']),
          {
            type: 'object',
            minProperties: 1,
            maxProperties: 1,
            propertyNames: { not: { enum: compiledEdgeKeys } },
            additionalProperties: { anyOf: [{ type: 'null' }, string, detail] },
          },
        ],
      },
    },
  };
}

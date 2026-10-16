// The JSON Schemas of the AI patch (ADR-0035, FR-AI-001): the plain one for validators and editors, and the provider-strict one for structured
// output. Both are generated from the Zod schemas of schema.ts; the committed copies in specs/schema/ are checked by json-schema.test.ts.
import { z } from 'zod';
import { aiPatchSchema } from './schema.js';

type Json = {
  type?: unknown;
  properties?: unknown;
  required?: unknown;
  additionalProperties?: unknown;
  oneOf?: unknown;
  anyOf?: unknown;
  items?: unknown;
  [key: string]: unknown;
};

/** Keywords the strict subset drops: bounds and formats a provider's structured output rejects. */
const DROPPED = [
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'format',
  'propertyNames',
  'default',
];

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Nullable form of a property schema (an optional property becomes required-but-null in the strict subset). */
const nullable = (schema: unknown): Json => ({ anyOf: [schema, { type: 'null' }] });

/** A record (an object with free keys) becomes an array of `{ key, value }` pairs: the strict subset has no open objects. */
function recordAsPairs(value: unknown): Json {
  return {
    type: 'array',
    items: { type: 'object', properties: { key: { type: 'string' }, value: strictNode(value) }, required: ['key', 'value'], additionalProperties: false },
  };
}

function strictObject(node: Json): Json {
  const properties = isObject(node.properties) ? node.properties : {};
  const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
  const out: Json = {};
  for (const [name, schema] of Object.entries(properties)) out[name] = required.has(name) ? strictNode(schema) : nullable(strictNode(schema));
  return { ...rest(node), type: 'object', properties: out, required: Object.keys(properties), additionalProperties: false };
}

/** The node without the keywords handled by the caller or dropped. */
function rest(node: Json): Json {
  const copy: Json = { ...node };
  for (const key of [...DROPPED, 'properties', 'required', 'additionalProperties', 'oneOf', 'anyOf', 'items']) delete copy[key];
  return copy;
}

function strictNode(schema: unknown): Json {
  if (!isObject(schema)) return {};
  if (isObject(schema.additionalProperties) && !schema.properties) return recordAsPairs(schema.additionalProperties);
  if (schema.type === 'object') return strictObject(schema);
  const union = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(union)) return { ...rest(schema), anyOf: union.map(strictNode) };
  if (schema.items !== undefined) return { ...rest(schema), type: 'array', items: strictNode(schema.items) };
  return rest(schema);
}

/**
 * The plain JSON Schema of an AI patch: every constraint kept, free-key records as objects.
 *
 * @public
 */
export function patchJsonSchema(): { readonly [key: string]: unknown } {
  return { title: 'Fluxion AI patch', ...z.toJSONSchema(aiPatchSchema, { unrepresentable: 'any', io: 'input' }) };
}

/**
 * The provider-strict JSON Schema of an AI patch (ADR-0035): every object closed (`additionalProperties: false`), every property required (an
 * optional one is nullable), unions flat as `anyOf`, no bounds or formats, free-key records as `{ key, value }` arrays.
 *
 * @public
 */
export function strictPatchJsonSchema(): { readonly [key: string]: unknown } {
  const { $schema, ...plain } = patchJsonSchema();
  return { $schema, ...strictNode(plain), title: 'Fluxion AI patch (strict)' };
}

import { describe, expect, it } from 'vitest';
import { KEYS } from '../read/fields.js';
import { PROVIDER_RULES as rules } from './__fixtures__/provider-rules.js';
import { patchJsonSchema, strictPatchJsonSchema } from './json-schema.js';
import { aiPatchSchema, NODE_SPEC_KEYS } from './schema.js';

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
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The problems of one object schema: closed, every property required, not too wide. */
function objectProblems(schema: Json, path: string): string[] {
  const out: string[] = [];
  if (schema.additionalProperties !== false) out.push(`${path}: object not closed`);
  const names = Object.keys(isObject(schema.properties) ? schema.properties : {});
  const required = Array.isArray(schema.required) ? schema.required : [];
  if (names.some((name) => !required.includes(name))) out.push(`${path}: a property is not required`);
  if (names.length > rules.maxProperties) out.push(`${path}: more than ${rules.maxProperties} properties`);
  return out;
}

/** Every problem of `schema` against the provider rules, with the path of each; `depth` counts object levels (arrays and unions add none). */
function problems(schema: unknown, path = '#', depth = 0): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, i) => problems(item, `${path}/${i}`, depth));
  if (!isObject(schema)) return [];
  const isObjectSchema = schema.type === 'object';
  const level = isObjectSchema ? depth + 1 : depth;
  const out = rules.forbiddenKeywords.filter((key) => key in schema).map((key) => `${path}: keyword ${key}`);
  if (level > rules.maxObjectDepth) out.push(`${path}: objects nested deeper than ${rules.maxObjectDepth}`);
  if (isObjectSchema) out.push(...objectProblems(schema, path));
  for (const [key, value] of Object.entries(schema)) out.push(...problems(value, `${path}/${key}`, level));
  return out;
}

describe('the AI patch JSON Schemas (FR-AI-001, FR-AI-003)', () => {
  it('FR-AI-001: the committed plain patch schema equals the schema generated from the Zod patch (drift test)', async () => {
    await expect(`${JSON.stringify(patchJsonSchema(), null, 2)}\n`).toMatchFileSnapshot('../../../../specs/schema/ai-patch.schema.json');
  });

  it('FR-AI-001: the committed strict patch schema equals the schema generated from the Zod patch (drift test)', async () => {
    await expect(`${JSON.stringify(strictPatchJsonSchema(), null, 2)}\n`).toMatchFileSnapshot('../../../../specs/schema/ai-patch.strict.schema.json');
  });

  it('FR-AI-003: the strict schema meets the provider rules fixture: closed objects, all properties required, flat anyOf, no bounds', () => {
    expect(problems(strictPatchJsonSchema())).toEqual([]);
    expect(JSON.stringify(strictPatchJsonSchema())).not.toContain('oneOf');
  });

  it('FR-AI-003: the provider rules checker rejects an open object, an optional property and a bound', () => {
    expect(problems({ type: 'object', properties: { a: { type: 'string', minLength: 1 } }, required: [] })).toEqual([
      '#: object not closed',
      '#: a property is not required',
      '#/properties/a: keyword minLength',
    ]);
  });

  it('FR-AI-003: the provider rules checker has a failing case for depth, width and each forbidden keyword', () => {
    const closed = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
    let deep: unknown = { type: 'string' };
    for (let i = 0; i <= rules.maxObjectDepth; i++) deep = closed({ a: deep });
    expect(problems(deep).some((p) => p.includes('nested deeper'))).toBe(true);
    const wide = closed(Object.fromEntries(Array.from({ length: rules.maxProperties + 1 }, (_, i) => [`p${i}`, { type: 'string' }])));
    expect(problems(wide)).toEqual(['#: more than 100 properties']);
    for (const keyword of rules.forbiddenKeywords) expect(problems({ type: 'string', [keyword]: 1 }), keyword).toEqual([`#: keyword ${keyword}`]);
  });

  it('FR-AI-003: the patch covers the nine ops of ADR-0035 and caps a patch at 200 ops', () => {
    const ops = ['add', 'update', 'remove', 'connect', 'disconnect', 'setLayout', 'restyle', 'addStep', 'addInteraction'];
    for (const op of ops) expect(JSON.stringify(patchJsonSchema())).toContain(`"const":"${op}"`);
    const one = { op: 'remove', target: 'a' };
    expect(aiPatchSchema.safeParse({ flux: 1, ops: Array.from({ length: 200 }, () => one) }).success).toBe(true);
    expect(aiPatchSchema.safeParse({ flux: 1, ops: Array.from({ length: 201 }, () => one) }).success).toBe(false);
    expect(aiPatchSchema.safeParse({ flux: 1, ops: [] }).success).toBe(false);
  });

  it('FR-AI-003: a node payload uses only keys the FluxScript reader knows (ADR-0030), so the patch and the compiler cannot drift apart', () => {
    const known = new Set<string>([...KEYS.node.compiled, ...KEYS.node.deferred]);
    for (const key of NODE_SPEC_KEYS) expect(known.has(key)).toBe(true);
  });
});

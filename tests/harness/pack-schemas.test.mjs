import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { generatedPackSchemas, packJSONSchema } from '../../scripts/core/pack-schemas.mjs';

test('FR-LIB-003: published pack JSON Schemas match their structural source', () => {
  for (const [name, schema] of generatedPackSchemas()) {
    const expected = JSON.parse(readFileSync(new URL(`../../packages/core/generated/shape-pack-${name}.schema.json`, import.meta.url), 'utf8'));
    assert.deepEqual(schema, expected);
    assert.equal(schema.additionalProperties, false);
    assert.match(schema.$comment, /license policy require the pack parser/);
  }
});

const { z } = createRequire(new URL('../../packages/core/package.json', import.meta.url))('zod');
test('FR-LIB-003: unknown custom predicates fail generation instead of silently accepting any JSON', () => {
  assert.throws(() => packJSONSchema(z.custom(() => true)), /Unmapped custom pack schema/);
});
test('FR-LIB-003: generated branded string constraints retain their wire boundaries', () => {
  const schemas = Object.fromEntries(generatedPackSchemas());
  const id = schemas.index.properties.definitions.items.properties.id;
  assert.equal(id.type, 'string');
  assert.equal(new RegExp(id.pattern).test('sample:box'), true);
  for (const invalid of ['box', 'Sample:box', 'sample:bad name', 'sample:']) assert.equal(new RegExp(id.pattern).test(invalid), false);
  const strings = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'string' && value.pattern) strings.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(schemas.category);
  const token = strings.find((value) => new RegExp(value.pattern).test('{color.primary}'));
  assert.ok(token);
  assert.equal(new RegExp(token.pattern).test('{color..primary}'), false);
  const record = strings.find((value) => value.minLength === 1 && value.maxLength === 64);
  assert.ok(record);
  assert.equal(new RegExp(record.pattern).test('asset_1-a'), true);
  assert.equal(new RegExp(record.pattern).test('asset:1'), false);
});

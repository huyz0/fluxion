// Deterministic structural pack JSON Schemas (ADR-0178). Semantic checks still require the parsers.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { z } = createRequire(new URL('../../packages/core/package.json', import.meta.url))('zod');

import { shapePackCategorySchema, shapePackIndexSchema, shapePackSubsetSchema } from '../../packages/core/dist/index.js';

// These three branded strings are custom predicates in @fluxion/schema. Keep their
// wire constraints explicit; any new custom predicate must receive a reviewed mapping.
const brandedStrings = new Map([
  ['expected "<namespace>:<name>" in lower case, e.g. "basic:rect"', { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9.-]*$' }],
  ['expected a token reference such as "{color.primary}"', { type: 'string', pattern: '^\\{[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*\\}$' }],
  ['expected a record id: 1-64 characters of A-Z a-z 0-9 _ -', { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' }],
]);

export function packJSONSchema(schema) {
  return z.toJSONSchema(schema, {
    unrepresentable: ({ zodSchema }) => {
      const def = zodSchema._zod.def;
      const message = def.type === 'custom' && typeof def.error === 'function' ? def.error({}) : undefined;
      const mapped = brandedStrings.get(message);
      if (!mapped) throw new Error('Unmapped custom pack schema; add an explicit structural contract');
      return { ...mapped };
    },
  });
}

export function generatedPackSchemas() {
  return [
    ['index', shapePackIndexSchema],
    ['category', shapePackCategorySchema],
    ['subset', shapePackSubsetSchema],
  ].map(([name, schema]) => [
    name,
    {
      $id: `urn:fluxion:shape-pack-${name}:1.0`,
      $comment: 'Structural schema only; membership, geometry and license policy require the pack parser.',
      ...packJSONSchema(schema),
    },
  ]);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = fileURLToPath(new URL('../../packages/core/generated/', import.meta.url));
  const write = process.argv.includes('--write');
  const entries = generatedPackSchemas();
  if (write) mkdirSync(root, { recursive: true });
  for (const [name, value] of entries) {
    const expected = `${JSON.stringify(value, null, 2)}\n`;
    const file = `${root}/shape-pack-${name}.schema.json`;
    if (write) writeFileSync(file, expected);
    else if (JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))) !== JSON.stringify(value)) throw new Error(`${file}: stale generated schema`);
  }
  console.log(`pack-schemas: ${entries.length} structural schemas ${write ? 'written' : 'match'}`);
}

// FR-AI-001 (M14.25): every example of the FluxScript corpus validates against the generated FluxScript JSON Schema and reads without an error.
// It lives with the corpus runner because it reads the files (packages/dsl is pure and has no node types).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fluxScriptJsonSchema } from '@fluxion/dsl';
import { describe, expect, it } from 'vitest';
import { parseFlux } from '../../packages/dsl/src/parse/parse.js';
import { plain } from '../../packages/dsl/src/read/fields.js';
import { readFlux } from '../../packages/dsl/src/read/read.js';
import { type Json, validAgainst } from '../../packages/dsl/src/read/schema-validator.fixture.js';

const DIR = join(import.meta.dirname, '..', '..', 'examples', 'dsl');
const FILES = readdirSync(DIR)
  .filter((f) => f.endsWith('.flux.yaml'))
  .sort();

describe('the FluxScript JSON Schema against the example corpus (FR-AI-001)', () => {
  it.each(FILES)('FR-AI-001: the example %s validates against the schema and reads without an error', (file) => {
    const text = readFileSync(join(DIR, file), 'utf8');
    const parsed = parseFlux(text);
    if (!parsed.root) throw new Error(`${file} does not parse`);
    const errors = [...parsed.diagnostics, ...readFlux(parsed.root, text).diagnostics].filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);
    expect(validAgainst(fluxScriptJsonSchema() as Json, plain(parsed.root))).toBe(true);
  });
});

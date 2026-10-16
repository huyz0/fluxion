// FR-AI-001 (M14.25): the FluxScript JSON Schema is generated from the reader's key table, matches the committed copy, accepts what the compiler
// accepts and rejects an unknown key. The validator below covers only the keywords the schema uses (no schema library is a dependency here).
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseFlux } from '../parse/parse.js';
import { KEYS } from './fields.js';
import { fluxScriptJsonSchema } from './json-schema.js';
import { readFlux } from './read.js';
import { type Json, validAgainst } from './schema-validator.fixture.js';

/** How many errors the reader (the compiler's read stage) finds in `text`. */
function readerErrors(text: string): number {
  const parsed = parseFlux(text);
  const read = parsed.root ? readFlux(parsed.root, text).diagnostics : [];
  return [...parsed.diagnostics, ...read].filter((d) => d.severity === 'error').length;
}

const ROOT = fluxScriptJsonSchema() as Json;

describe('the FluxScript JSON Schema (FR-AI-001)', () => {
  it('FR-AI-001: the committed FluxScript schema equals the schema generated from the key table (drift test)', async () => {
    await expect(`${JSON.stringify(fluxScriptJsonSchema(), null, 2)}\n`).toMatchFileSnapshot('../../../../specs/schema/fluxscript.schema.json');
  });

  it('FR-AI-001: every compiled and deferred key of the key table is a property of its level', () => {
    const top = (ROOT['properties'] ?? {}) as Json;
    const defs = ROOT['$defs'] as { [k: string]: Json };
    const levels: ReadonlyArray<readonly [Json, keyof typeof KEYS]> = [
      [ROOT, 'top'],
      [defs['theme'] as Json, 'theme'],
      [((defs['screen'] as Json)['anyOf'] as Json[])[0] as Json, 'screen'],
      [defs['group'] as Json, 'group'],
    ];
    expect(Object.keys(top)).toEqual([...KEYS.top.compiled, ...KEYS.top.deferred]);
    for (const [schema, level] of levels) expect(Object.keys(schema['properties'] as Json)).toEqual([...KEYS[level].compiled, ...KEYS[level].deferred]);
  });

  it('FR-AI-001: an unknown key, a bad slug, a bad route and a missing title are rejected, and the compiler rejects the same files', () => {
    const base = { flux: 1, title: 'T', screens: [{ id: 'main', nodes: { a: { shape: 'rect' } }, edges: ['a -> a'] }] };
    expect(validAgainst(ROOT, base)).toBe(true);
    const screen = (over: Json) => ({ ...base, screens: [{ ...(base.screens[0] as Json), ...over }] });
    const bad: Json[] = [
      { ...base, tiltle: 'x' },
      screen({ nodes: { Bad_Id: { shape: 'rect' } } }),
      screen({ nodes: { a: { shpe: 'rect' } } }),
      screen({ edges: [{ from: 'a', to: 'a', route: 'zigzag' }] }),
      { flux: 1, screens: base.screens },
    ];
    for (const doc of bad) {
      expect(validAgainst(ROOT, doc), JSON.stringify(doc)).toBe(false);
      expect(readerErrors(JSON.stringify(doc))).toBeGreaterThan(0);
    }
  });
});

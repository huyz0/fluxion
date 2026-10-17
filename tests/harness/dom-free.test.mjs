// FR-IMP-002, ADR-0040: a browser bundle of @fluxion/dsl must not load decode-named-character-reference's DOM entry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { domFreeAliases } from '../../tools/vite-dom-free/index.mjs';
import { REPO } from './helpers.mjs';

describe('DOM-free alias (FR-IMP-002, ADR-0040)', () => {
  it('FR-IMP-002: decode-named-character-reference resolves to its plain index.js, not index.dom.js', () => {
    assert.equal(domFreeAliases.length, 1);
    const [alias] = domFreeAliases;
    assert.ok(alias.find.test('decode-named-character-reference'));
    assert.match(alias.replacement, /decode-named-character-reference[\\/]index\.js$/);
  });

  it('FR-IMP-002: the studio build and the Vitest browser project both apply the alias', () => {
    for (const file of ['apps/studio/vite.config.ts', 'vitest.config.ts']) {
      assert.match(readFileSync(`${REPO}/${file}`, 'utf8'), /alias: domFreeAliases/, file);
    }
  });
});

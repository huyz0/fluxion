import { describe, expect, it } from 'vitest';
import { fluxScriptKeys } from '../index.js';

describe('fluxScriptKeys, the key table tools highlight from (FR-DSL-009)', () => {
  it('FR-DSL-009: the key table lists the compiled and deferred keys of every level, and no key is both', () => {
    const table = fluxScriptKeys();
    expect(Object.keys(table)).toEqual(['top', 'theme', 'screen', 'node', 'group', 'edge', 'pin']);
    expect(table.top.compiled).toEqual(['flux', 'title', 'theme', 'uses', 'screens']);
    expect(table.edge.deferred).toEqual(['flow', 'riders']);
    const compiled = new Set(Object.values(table).flatMap((l) => l.compiled));
    const deferred = Object.values(table).flatMap((l) => l.deferred);
    expect(deferred.filter((k) => compiled.has(k))).toEqual([]);
  });
});

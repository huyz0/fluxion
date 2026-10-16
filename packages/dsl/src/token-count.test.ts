import { describe, expect, it } from 'vitest';
import { countTokens } from './__fixtures__/token-count.js';

describe('token counting (NFR-AI-002, NFR-AI-003, ADR-0037)', () => {
  it('NFR-AI-002: counts o200k_base tokens, offline and the same twice', () => {
    expect(countTokens('')).toBe(0);
    expect(countTokens('hello world')).toBe(2);
    expect(countTokens('hello world')).toBe(countTokens('hello world'));
  });

  it('NFR-AI-003: counts a JSON object above its flow-style YAML twin, the comparison the ratio makes', () => {
    const json = JSON.stringify({ id: 'a', kind: 'shape', box: { x: 0, y: 0, w: 120, h: 60 }, label: 'Start' }, null, 2);
    const yaml = 'a: { shape: rect, label: Start }';
    expect(countTokens(json)).toBeGreaterThan(countTokens(yaml));
  });
});

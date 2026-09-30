import { describe, expect, it } from 'vitest';
import { LASER_FADE, trailKeys } from './laser-keys.js';

describe('laser trail keys (FR-EDT-003)', () => {
  it('FR-EDT-003: a dot keeps its key while it stays in the trail, repeats of a place told apart; dots fade over LASER_FADE', () => {
    expect(LASER_FADE).toBe('0.8s');
    const a = { x: 1, y: 2 };
    const b = { x: 3, y: 4 };
    expect(trailKeys([a, b, a]).map((k) => k.key)).toEqual(['1,2#1', '3,4#1', '1,2#2']);
    expect(trailKeys([b, a]).map((k) => [k.key, k.p])).toEqual([
      ['3,4#1', b],
      ['1,2#1', a],
    ]);
  });
});

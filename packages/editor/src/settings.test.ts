import { describe, expect, it } from 'vitest';
import { memorySettings } from './settings.js';

describe('memorySettings (ADR-0029)', () => {
  it('FR-EDT-001: keeps values by key, starting from the given ones', () => {
    const s = memorySettings({ a: 1 });
    expect(s.get('a')).toBe(1);
    expect(s.get('b')).toBeUndefined();
    s.set('b', { x: 2 });
    s.set('a', 3);
    expect([s.get('a'), s.get('b')]).toEqual([3, { x: 2 }]);
    expect(memorySettings().get('a')).toBeUndefined();
  });
});

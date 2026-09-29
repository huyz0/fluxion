import { describe, expect, it } from 'vitest';
import { batch, computed, effect, writable } from './signals.js';

describe('writable signals (ADR-0028)', () => {
  it('FR-EDT-004: a writable signal reads, notifies its dependents, and ignores the same value', () => {
    const s = writable<readonly string[]>([]);
    const seen: (readonly string[])[] = [];
    const stop = effect(() => {
      seen.push(s.get());
    });
    const count = computed(() => s.get().length);
    const next = ['a', 'b'];
    s.set(next);
    s.set(next);
    expect(s.get()).toBe(next);
    expect(count()).toBe(2);
    expect(seen).toEqual([[], ['a', 'b']]);
    batch(() => {
      s.set(['c']);
      s.set(['d']);
    });
    expect(seen).toEqual([[], ['a', 'b'], ['d']]);
    stop();
    s.set([]);
    expect(seen.length).toBe(3);
  });
});

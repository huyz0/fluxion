import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareKeys, type IndexKey, isIndexKey, keyBetween, nKeysBetween } from './fractional-index.js';
import { seededRandom } from './ids.js';

const key = (a: string | null, b: string | null): IndexKey => {
  const r = keyBetween(a, b);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};

/** A sorted list of keys built by random inserts (at the ends and between neighbours). */
function randomKeys(seed: number, count: number): IndexKey[] {
  const random = seededRandom(seed);
  const keys: IndexKey[] = [];
  for (let i = 0; i < count; i++) {
    const at = Math.floor(random.next() * (keys.length + 1));
    keys.splice(at, 0, key(keys[at - 1] ?? null, keys[at] ?? null));
  }
  return keys;
}

const isStrictlyIncreasing = (keys: (string | null)[]): boolean => {
  const present = keys.filter((k): k is string => k !== null);
  return present.every((k, j) => j === 0 || compareKeys(present[j - 1] ?? '', k) === -1);
};

const ops = fc.array(fc.nat(), { maxLength: 60 });
const build = (picks: number[]): IndexKey[] => {
  const keys: IndexKey[] = [];
  for (const p of picks) {
    const at = p % (keys.length + 1);
    keys.splice(at, 0, key(keys[at - 1] ?? null, keys[at] ?? null));
  }
  return keys;
};

describe('fractional index', () => {
  it('FR-DOC-010: a < keyBetween(a, b) < b for 10k pairs', () => {
    const keys = randomKeys(42, 300);
    const random = seededRandom(43);
    for (let n = 0; n < 10_000; n++) {
      const i = Math.floor(random.next() * (keys.length - 1));
      const j = i + 1 + Math.floor(random.next() * (keys.length - 1 - i));
      const a = keys[i] ?? null;
      const b = keys[j] ?? null;
      const k = key(a, b);
      expect(isIndexKey(k)).toBe(true);
      expect(a !== null && a < k && b !== null && k < b).toBe(true);
    }
  });

  it('FR-DOC-010: any insert sequence keeps keys valid, unique and in string order', () => {
    fc.assert(
      fc.property(ops, (picks) => {
        const keys = build(picks);
        expect(keys.every(isIndexKey)).toBe(true);
        expect([...keys].sort(compareKeys)).toEqual(keys);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });

  it('FR-DOC-010: nKeysBetween is strictly increasing and inside its bounds', () => {
    fc.assert(
      fc.property(ops, fc.nat({ max: 40 }), fc.nat(), (picks, n, at) => {
        const keys = build(picks);
        const i = at % (keys.length + 1);
        const [a, b] = [keys[i - 1] ?? null, keys[i] ?? null];
        const r = nKeysBetween(a, b, n);
        expect(r.ok).toBe(true);
        const out = r.ok ? r.value : [];
        expect(out).toHaveLength(n);
        expect(isStrictlyIncreasing([a, ...out, b])).toBe(true);
      }),
    );
  });

  it('FR-DOC-010: WHEN one screen is reordered THE SYSTEM SHALL change exactly one record', () => {
    const list = nKeysBetween(null, null, 5);
    const screens = new Map((list.ok ? list.value : []).map((index, i) => [`s${i}`, { id: `s${i}`, index }]));
    const before = new Map([...screens].map(([id, s]) => [id, { ...s }]));
    // move s4 between s0 and s1
    const s0 = screens.get('s0')?.index ?? null;
    const s1 = screens.get('s1')?.index ?? null;
    screens.set('s4', { id: 's4', index: key(s0, s1) });
    const changed = [...screens.keys()].filter((id) => screens.get(id)?.index !== before.get(id)?.index);
    expect(changed).toEqual(['s4']);
    const order = [...screens.values()].sort((x, y) => compareKeys(x.index, y.index)).map((s) => s.id);
    expect(order).toEqual(['s0', 's4', 's1', 's2', 's3']);
  });

  it('starts at a0 and appends, prepends and grows the integer part', () => {
    expect(key(null, null)).toBe('a0');
    expect(key('a0', null)).toBe('a1');
    expect(key(null, 'a0')).toBe('Zz');
    expect(key('az', null)).toBe('b00');
    expect(key(null, 'Z0')).toBe('Yzz');
    expect(key('Zz', null)).toBe('a0');
    expect(key('a0', 'a1')).toBe('a0V');
    expect(key('a0V', 'a1')).toBe('a0l');
    expect(key('a1', 'a2')).toBe('a1V');
    let k: IndexKey = key(null, null);
    for (let i = 0; i < 5000; i++) k = key(k, null);
    expect(k.length).toBeLessThanOrEqual(4);
  });

  it('grows about one digit per six inserts at the same spot', () => {
    let hi: IndexKey = key('a0', 'a1');
    for (let i = 0; i < 60; i++) hi = key('a0', hi);
    expect(hi.length).toBeGreaterThan(10);
    expect(hi.length).toBeLessThan(16);
  });

  it('reaches the key-space edges without running out', () => {
    const largest = `z${'z'.repeat(26)}`;
    const smallest = `A${'0'.repeat(26)}`;
    expect(isIndexKey(largest)).toBe(true);
    expect(key(largest, null)).toBe(`${largest}V`);
    expect(isIndexKey(smallest)).toBe(false);
    expect(key(null, `${smallest}1`)).toBe(`${smallest}0V`);
    const low = key(null, `A${'0'.repeat(25)}1`);
    expect(low).toBe(`${smallest}V`);
    expect(key(null, low)).toBe(`${smallest}G`);
    expect(keyBetween(null, 'A0')).toMatchObject({ ok: false, error: { code: 'INDEX_INVALID' } });
  });

  it('returns errors for invalid input and never throws', () => {
    expect(keyBetween('a1', 'a0')).toMatchObject({ ok: false, error: { code: 'INDEX_ORDER' } });
    expect(keyBetween('a0', 'a0')).toMatchObject({ ok: false, error: { code: 'INDEX_ORDER' } });
    expect(keyBetween('a00', null)).toMatchObject({ ok: false, error: { code: 'INDEX_INVALID' } });
    expect(keyBetween(null, 'b1')).toMatchObject({ ok: false, error: { code: 'INDEX_INVALID' } });
    expect(keyBetween('!', null)).toMatchObject({ ok: false, error: { code: 'INDEX_INVALID' } });
    expect(nKeysBetween(null, null, -1)).toMatchObject({ ok: false, error: { code: 'INDEX_INVALID' } });
    expect(nKeysBetween('a1', 'a0', 0)).toMatchObject({ ok: false, error: { code: 'INDEX_ORDER' } });
    expect(nKeysBetween('a1', 'a0', 3)).toMatchObject({ ok: false, error: { code: 'INDEX_ORDER' } });
    expect(nKeysBetween(null, 'a0', 0)).toEqual({ ok: true, value: [] });
    fc.assert(
      fc.property(fc.option(fc.string()), fc.option(fc.string()), (a, b) => {
        expect(() => keyBetween(a, b)).not.toThrow();
      }),
    );
  });

  it('compares by code units, not locale', () => {
    expect(compareKeys('a0', 'a0')).toBe(0);
    expect(compareKeys('Zz', 'a0')).toBe(-1);
    expect(compareKeys('a0a', 'a0B')).toBe(1);
    expect(isIndexKey(42)).toBe(false);
    expect(isIndexKey('')).toBe(false);
    expect(isIndexKey('a')).toBe(false);
  });
});

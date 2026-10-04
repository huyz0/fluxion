import { describe, expect, it } from 'vitest';
import { LIBRARY_LIMIT, type LibraryEntry, memoryLibrary } from './store.js';

const entry = (id: string, saved: string, size = 1): LibraryEntry => ({ id, name: `${id}.flux`, saved, bytes: new Uint8Array(size) });
const stamp = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

describe('the local library (FR-FIL-008)', () => {
  it('FR-FIL-008: documents come back newest first, up to the limit asked for', async () => {
    const lib = memoryLibrary();
    await lib.put(entry('old', stamp(1)));
    await lib.put(entry('new', stamp(3)));
    await lib.put(entry('mid', stamp(2)));
    expect((await lib.recent(10)).map((e) => e.id)).toEqual(['new', 'mid', 'old']);
    expect((await lib.recent(2)).map((e) => e.id)).toEqual(['new', 'mid']);
  });

  it('FR-FIL-008: saving under the same id replaces the entry and moves it to the top', async () => {
    const lib = memoryLibrary();
    await lib.put(entry('a', stamp(1), 1));
    await lib.put(entry('b', stamp(2)));
    await lib.put(entry('a', stamp(3), 5));
    const [first, second, ...rest] = await lib.recent(10);
    expect(rest).toHaveLength(0);
    expect(first?.id).toBe('a');
    expect(first?.bytes).toHaveLength(5);
    expect(second?.id).toBe('b');
  });

  it('FR-FIL-008: only the newest LIBRARY_LIMIT entries are kept', async () => {
    const lib = memoryLibrary();
    for (let i = 0; i < LIBRARY_LIMIT + 7; i++) await lib.put(entry(`d${i}`, stamp(i)));
    const kept = await lib.recent(1000);
    expect(kept).toHaveLength(LIBRARY_LIMIT);
    expect(kept[0]?.id).toBe(`d${LIBRARY_LIMIT + 6}`);
    expect(await lib.get('d0')).toBeUndefined();
    expect(await lib.get('d7')).toBeDefined();
  });

  it('FR-FIL-008: an entry is read by id and removed, and removing what is not there is fine', async () => {
    const lib = memoryLibrary();
    await lib.put(entry('a', stamp(1)));
    expect((await lib.get('a'))?.name).toBe('a.flux');
    await lib.remove('a');
    await lib.remove('a');
    expect(await lib.get('a')).toBeUndefined();
  });

  it('FR-FIL-008: entries saved in the same millisecond keep a fixed order, and the entry just written is never the one trimmed', async () => {
    const lib = memoryLibrary();
    for (let i = 0; i < LIBRARY_LIMIT; i++) await lib.put(entry(`z${String(i).padStart(2, '0')}`, stamp(5)));
    await lib.put(entry('a-just-written', stamp(5)));
    const kept = await lib.recent(1000);
    expect(kept).toHaveLength(LIBRARY_LIMIT);
    expect(kept.map((e) => e.id)).toContain('a-just-written');
    expect(kept.map((e) => e.id)).toEqual([...kept.map((e) => e.id)].sort().reverse());
  });
});

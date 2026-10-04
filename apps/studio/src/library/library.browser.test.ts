import { afterEach, describe, expect, it } from 'vitest';
import { idbLibrary, LIBRARY_LIMIT, type LibraryEntry, type LibraryStore } from './store.js';
import { renderThumbnail, thumbnailPlan } from './thumbnail.js';

const opened: LibraryStore[] = [];
afterEach(() => {
  for (const l of opened.splice(0)) l.close();
});
let counter = 0;
const fresh = async (name?: string) => {
  counter += 1;
  const lib = await idbLibrary(indexedDB, name ?? `fluxion-library-test-${Date.now()}-${counter}`);
  opened.push(lib);
  return lib;
};
const entry = (id: string, n: number, thumb?: Uint8Array): LibraryEntry => ({
  id,
  name: `${id}.flux`,
  saved: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  bytes: new Uint8Array([n, n]),
  ...(thumb === undefined ? {} : { thumb }),
});

describe('the library on IndexedDB (FR-FIL-008)', () => {
  it('FR-FIL-008: entries with their bytes and thumbnail come back newest first from a second connection', async () => {
    const name = `fluxion-library-test-shared-${Date.now()}`;
    const lib = await fresh(name);
    await lib.put(entry('a', 1, new Uint8Array([9])));
    await lib.put(entry('b', 2));
    const other = await fresh(name);
    const [first, second] = await other.recent(10);
    expect([first?.id, second?.id]).toEqual(['b', 'a']);
    expect(second?.thumb).toEqual(new Uint8Array([9]));
    expect(second?.bytes).toEqual(new Uint8Array([1, 1]));
  });

  it('FR-FIL-008: the same id is replaced, an entry is removed, and the newest LIBRARY_LIMIT stay', async () => {
    const lib = await fresh();
    await lib.put(entry('a', 1));
    await lib.put(entry('a', 2));
    expect(await lib.recent(10)).toHaveLength(1);
    await lib.remove('a');
    expect(await lib.get('a')).toBeUndefined();
    for (let i = 0; i < LIBRARY_LIMIT + 3; i++) await lib.put(entry(`d${i}`, i));
    const kept = await lib.recent(1000);
    expect(kept).toHaveLength(LIBRARY_LIMIT);
    expect(kept[0]?.id).toBe(`d${LIBRARY_LIMIT + 2}`);
  });
});

describe('a library that fails (FR-FIL-008)', () => {
  it('FR-FIL-008: a write the database refuses rejects and leaves the library as it was', async () => {
    const lib = await fresh();
    await lib.put(entry('a', 1));
    // a function cannot be stored: the write fails as a quota or a closed disk would
    await expect(lib.put({ ...entry('b', 2), bytes: (() => 1) as unknown as Uint8Array })).rejects.toBeInstanceOf(DOMException);
    expect((await lib.recent(10)).map((e) => e.id)).toEqual(['a']);
  });

  it('FR-FIL-008: a browser that refuses IndexedDB rejects the open, and a closed library rejects its work', async () => {
    const refusing = {
      open() {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    await expect(idbLibrary(refusing)).rejects.toMatchObject({ name: 'SecurityError' });
    const lib = await fresh();
    lib.close();
    await expect(lib.recent(1)).rejects.toBeDefined();
  });
});

describe('the thumbnail on a canvas (FR-FIL-008)', () => {
  it('FR-FIL-008: a plan is drawn and encoded as a WebP image', async () => {
    const plan = thumbnailPlan({
      s: { id: 's', type: 'screen', index: 'a' },
      e: { id: 'e', type: 'element', kind: 'shape', screenId: 's', index: 'a', transform: { x: 100, y: 100, w: 500, h: 300 }, style: { fill: '#336699' } },
    });
    const bytes = await renderThumbnail(plan as NonNullable<typeof plan>);
    expect(bytes).toBeDefined();
    const text = new TextDecoder().decode(bytes?.subarray(0, 12));
    expect(text.startsWith('RIFF')).toBe(true);
    expect(text.endsWith('WEBP')).toBe(true);
  });
});

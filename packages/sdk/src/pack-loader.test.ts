import { sha256Hex } from '@fluxion/core';
import { describe, expect, it, vi } from 'vitest';
import { createShapePackLoader, type ShapePackLoaderOptions } from './pack-loader.js';

const raw = import.meta.glob('../../../fixtures/shape-pack/index.json', { query: '?raw', import: 'default', eager: true });
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function fixture(count = 4, namespace = 'sample') {
  const index = JSON.parse(raw['../../../fixtures/shape-pack/index.json'] ?? 'null');
  index.id = namespace;
  index.categories = {};
  index.definitions = [];
  const files = new Map<string, Uint8Array>();
  for (let start = 0; start < count; start += 50) {
    const category = `group-${start}`;
    const definitions = [];
    for (let n = start; n < Math.min(count, start + 50); n++) {
      const id = `${namespace}:s${n}`;
      index.definitions.push({ id, name: `Shape ${n}`, keywords: [n % 2 ? 'odd' : 'even'], category });
      definitions.push({ id, outline: { path: 'M0 0H{w}V{h}H0Z' }, defaultSize: { w: 80, h: 40 } });
    }
    const bytes = encode({ formatVersion: '1.0', definitions });
    const path = `categories/${category}.json`;
    files.set(path, bytes);
    index.categories[category] = { path, sha256: sha256Hex(bytes) };
  }
  const read = vi.fn(async (path: string, _maxBytes: number) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error('missing test category');
    return bytes;
  });
  const options: ShapePackLoaderOptions = {
    maxBytes: 2 * 1024 * 1024,
    read,
    hasher: { sha256: async (bytes) => sha256Hex(bytes) },
    licensePolicy: (license) => license === 'MIT',
  };
  return { index, files, read, options };
}
async function loader(f = fixture()) {
  const result = await createShapePackLoader(encode(f.index), f.options);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe('lazy shape pack loader', () => {
  it('FR-LIB-009: searches 5000 metadata entries without reading geometry; first use loads only its category', async () => {
    const f = fixture(5000);
    const pack = await loader(f);
    expect(pack.search('')).toHaveLength(5000);
    expect(pack.search('sHaPe 4999').map((entry) => entry.id)).toEqual(['sample:s4999']);
    expect(pack.search('even')).toHaveLength(2500);
    expect(f.read).not.toHaveBeenCalled();
    const result = await pack.load('sample:s4999');
    expect(result).toMatchObject({ ok: true, value: { id: 'sample:s4999' } });
    expect(f.read.mock.calls).toEqual([['categories/group-4950.json', f.options.maxBytes]]);
  });
  it('FR-LIB-009: concurrent IDs share a category load, cached success and independent other categories', async () => {
    const f = fixture(100);
    const pack = await loader(f);
    const results = await Promise.all([pack.load('sample:s0'), pack.load('sample:s1'), pack.load('sample:s0')]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect((await pack.load('sample:s2')).ok).toBe(true);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect((await pack.load('sample:s50')).ok).toBe(true);
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it('NFR-SEC-001 FR-LIB-009: snapshots caller bytes and freezes metadata and cached definitions', async () => {
    const f = fixture();
    const bytes = encode(f.index);
    const pending = createShapePackLoader(bytes, f.options);
    bytes.fill(0);
    const result = await pending;
    if (!result.ok) throw new Error('snapshot was not retained');
    const pack = result.value;
    expect(Reflect.set(pack.index, 'version', '9.0.0')).toBe(false);
    expect(Reflect.set(pack.index.definitions[0] as object, 'category', 'evil')).toBe(false);
    const loaded = await pack.load('sample:s0');
    if (!loaded.ok) throw new Error('fixture did not load');
    expect(Reflect.set(loaded.value.outline, 'path', 'evil')).toBe(false);
    expect(await pack.load('sample:s0')).toEqual(loaded);
  });
  it('FR-LIB-009: identity isolates namespace, version and index bytes between loader instances', async () => {
    const f = fixture();
    const first = await loader(f);
    f.index.version = '2.0.0';
    const second = await loader(f);
    f.index.name = 'Different metadata';
    const third = await loader(f);
    expect(new Set([first.identity, second.identity, third.identity]).size).toBe(3);
    await Promise.all([first.load('sample:s0'), second.load('sample:s0'), third.load('sample:s0')]);
    expect(f.read).toHaveBeenCalledTimes(3);
  });
  it('FR-LIB-009: unknown IDs fail before I/O; failed concurrent reads retry only on a later explicit call', async () => {
    const f = fixture();
    const pack = await loader(f);
    expect((await pack.load('sample:missing')).ok).toBe(false);
    expect(f.read).not.toHaveBeenCalled();
    f.read.mockRejectedValueOnce(new Error('offline'));
    const failures = await Promise.all([pack.load('sample:s0'), pack.load('sample:s1')]);
    expect(failures.every((result) => !result.ok)).toBe(true);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect((await pack.load('sample:s0')).ok).toBe(true);
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it.each(['hash', 'json', 'missing', 'artwork', 'extra', 'utf8'])('NFR-SEC-001: category %s failure never returns partial success', async (mode) => {
    const f = fixture();
    const path = 'categories/group-0.json';
    const category = JSON.parse(new TextDecoder().decode(f.files.get(path)));
    if (mode === 'missing') category.definitions.pop();
    if (mode === 'extra') category.definitions.push({ ...category.definitions[0], id: 'sample:unindexed' });
    if (mode === 'artwork') category.definitions[0].artwork = { root: { name: 'script' } };
    let bytes = encode(category);
    if (mode === 'json') bytes = new TextEncoder().encode('{broken');
    if (mode === 'utf8') bytes = new Uint8Array([255]);
    f.files.set(path, bytes);
    f.index.categories['group-0'].sha256 = mode === 'hash' ? '0'.repeat(64) : sha256Hex(bytes);
    const pack = await loader(f);
    expect((await pack.load('sample:s0')).ok, mode).toBe(false);
  });
  it('NFR-SEC-001 NFR-LIC-003: rejects invalid index, UTF-8, license, byte limits and hash failures', async () => {
    const f = fixture();
    expect((await createShapePackLoader(new Uint8Array([255]), f.options)).ok).toBe(false);
    expect((await createShapePackLoader(encode({}), f.options)).ok).toBe(false);
    expect((await createShapePackLoader(encode({ ...f.index, formatVersion: '9.0' }), f.options)).ok).toBe(false);
    expect((await createShapePackLoader(encode(f.index), { ...f.options, licensePolicy: () => false })).ok).toBe(false);
    for (const maxBytes of [0, NaN, Infinity, 1, 1.5]) expect((await createShapePackLoader(encode(f.index), { ...f.options, maxBytes })).ok).toBe(false);
    expect((await createShapePackLoader(encode(f.index), { ...f.options, hasher: { sha256: async () => 'invalid' } })).ok).toBe(false);
    expect(
      (
        await createShapePackLoader(encode(f.index), {
          ...f.options,
          hasher: {
            sha256: async () => {
              throw new Error('hash unavailable');
            },
          },
        })
      ).ok,
    ).toBe(false);
    const pack = await loader(f);
    f.read.mockResolvedValueOnce(new Uint8Array(f.options.maxBytes + 1));
    expect((await pack.load('sample:s0')).ok).toBe(false);
    expect(f.read).toHaveBeenCalledTimes(1);
  });
});

it('FR-LIB-009 NFR-SEC-001: captures options before asynchronous hashing and installs pending loads before reentrant reads', async () => {
  const f = fixture();
  const options = { ...f.options };
  const pending = createShapePackLoader(encode(f.index), options);
  options.maxBytes = 1;
  options.licensePolicy = () => false;
  options.read = async () => {
    throw new Error('replacement reader must not run');
  };
  const created = await pending;
  if (!created.ok) throw new Error('creation failed');
  expect((await created.value.load('sample:s0')).ok).toBe(true);
  expect(f.read).toHaveBeenCalledTimes(1);
  const secondFixture = fixture();
  let nested: ReturnType<typeof created.value.load> | undefined;
  const second = await loader(secondFixture);
  const bytes = secondFixture.files.get('categories/group-0.json') as Uint8Array;
  secondFixture.read.mockImplementationOnce(async () => {
    nested = second.load('sample:s1');
    return bytes;
  });
  expect((await second.load('sample:s0')).ok).toBe(true);
  expect((await nested)?.ok).toBe(true);
  expect(secondFixture.read).toHaveBeenCalledTimes(1);
});

it('FR-LIB-009 NFR-SEC-001: namespace isolation and host hash-buffer mutation cannot poison definitions', async () => {
  const a = fixture();
  const b = fixture(4, 'other');
  const first = await loader(a);
  b.options.hasher.sha256 = async (bytes) => {
    const hash = sha256Hex(bytes);
    bytes.fill(0);
    return hash;
  };
  const second = await loader(b);
  expect(first.identity).toContain('sample@1.0.0#');
  expect(second.identity).toContain('other@1.0.0#');
  expect((await second.load('sample:s0')).ok).toBe(false);
  expect(b.read).not.toHaveBeenCalled();
  expect(await second.load('other:s0')).toMatchObject({ ok: true, value: { id: 'other:s0' } });
});
it('NFR-SEC-001: category hashing failures return diagnostics and an exact byte-cap index is accepted', async () => {
  const f = fixture();
  const hash = vi.fn(async (bytes: Uint8Array) => sha256Hex(bytes));
  f.options.hasher.sha256 = hash;
  const pack = await loader(f);
  hash.mockRejectedValueOnce(new Error('hash unavailable'));
  expect((await pack.load('sample:s0')).ok).toBe(false);
  expect((await pack.load('sample:s0')).ok).toBe(true);
  const bytes = encode(f.index);
  expect((await createShapePackLoader(bytes, { ...f.options, maxBytes: bytes.length })).ok).toBe(true);
});

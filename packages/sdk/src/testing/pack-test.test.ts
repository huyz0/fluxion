import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeclarativeShapePack } from '../index.js';
import { shapePackExpectation } from './index.js';
import { checkedInShapePack, runEnv, shapePackTest, testShapePack, writeRequested } from './pack-test.js';

const pack: DeclarativeShapePack = {
  id: 'sample',
  version: '1.0.0',
  name: 'Sample',
  license: 'MIT',
  attribution: 'Fluxion contributors',
  credits: [
    {
      id: 'fluxion',
      license: 'MIT',
      attribution: 'Fluxion contributors',
      notice: 'MIT License',
      source: { kind: 'original', author: 'Fluxion contributors', statement: 'Original artwork.' },
    },
  ],
  definitions: [
    { name: 'Box', def: { id: 'sample:box', outline: { path: 'M 0 0 L {w} 0 L {w} {h} L 0 {h} Z' }, defaultSize: { w: 120, h: 60 }, category: 'boxes' } },
  ],
};
const expected = shapePackExpectation(pack, undefined);
const checkedIn = { pack: expected.pack, goldens: expected.goldens, packageJson: '{"version":"1.0.0"}', versions: expected.versions };

describe('the shared first-party pack test (ADR-0199)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('FR-LIB-007: only VITE_FLUXION_WRITE_PACK=1 asks for a write, read from the run environment', () => {
    expect(writeRequested({ VITE_FLUXION_WRITE_PACK: '1' })).toBe(true);
    for (const env of [{ VITE_FLUXION_WRITE_PACK: '0' }, { VITE_FLUXION_WRITE_PACK: '' }, { OTHER: '1' }, {}, undefined]) {
      expect(writeRequested(env)).toBe(false);
    }
    vi.stubEnv('VITE_FLUXION_WRITE_PACK', '1');
    expect(writeRequested(runEnv())).toBe(true);
    vi.stubEnv('VITE_FLUXION_WRITE_PACK', '0');
    expect(writeRequested(runEnv())).toBe(false);
  });

  it('FR-LIB-007: the globs become the checked-in pack, by path below pack/ and __golden__/', () => {
    expect(
      checkedInShapePack({
        pack: { '../pack/index.json': 'i', '../pack/categories/a.json': 'a' },
        goldens: { '../__golden__/box.svg': 's' },
        packageJson: { '../package.json': 'p' },
        versions: {},
        changelog: { '../CHANGELOG.md': 'c' },
      }),
    ).toEqual({ pack: { 'index.json': 'i', 'categories/a.json': 'a' }, goldens: { 'box.svg': 's' }, packageJson: 'p', versions: undefined, changelog: 'c' });
    expect(checkedInShapePack({ pack: {}, goldens: {}, packageJson: {}, versions: {}, changelog: {} }).packageJson).toBe('');
  });

  it('FR-LIB-007, NFR-LIC-003: a compare run passes on the build and fails on a changed file; a write run without -u fails', async () => {
    await expect(shapePackTest(pack, checkedIn, false)).resolves.toBeUndefined();
    const changed = { ...checkedIn, goldens: { ...checkedIn.goldens, 'box.svg': '<svg/>' } };
    await expect(shapePackTest(pack, changed, false)).rejects.toThrow();
    // this run is not `-u`, so a write run refuses before touching any file
    await expect(shapePackTest(pack, changed, true)).rejects.toThrow(/^VITE_FLUXION_WRITE_PACK=1 needs `vitest run -u`: expected '(new|none)' to be 'all'/);
  });
});

describe('testShapePack registers the comparison (FR-LIB-007, ADR-0199)', () => {
  let reads = 0;
  const counted = new Proxy(pack, {
    get(target, key, receiver) {
      if (key === 'definitions') reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  const under = (dir: string, files: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.entries(files).map(([path, text]) => [`${dir}${path}`, text]));
  testShapePack(counted, {
    pack: under('../pack/', checkedIn.pack),
    goldens: under('../__golden__/', checkedIn.goldens),
    packageJson: { '../package.json': checkedIn.packageJson },
    versions: { '../pack-versions.json': checkedIn.versions },
    changelog: {},
  });
  it('the registered test built and compared the pack (it runs first)', () => {
    expect(reads).toBeGreaterThan(0);
  });
});

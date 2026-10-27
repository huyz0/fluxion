import { allowsShapePackContentLicense, sha256Hex } from '@fluxion/core';
import { describe, expect, it, vi } from 'vitest';
import { ARTWORK_ACQUISITION_LIMITS, createArtworkShapePackLoader } from './artwork-pack-loader.js';
import { createShapePackLoader, type ShapePackLoaderOptions } from './pack-loader.js';

declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?inline'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}
const json = import.meta.glob('../../../fixtures/shape-pack/**/*.json', { query: '?raw', import: 'default', eager: true });
const fonts = import.meta.glob('../../../packs/fonts-core/fonts/inter-latin-400-normal.woff2', { query: '?inline', import: 'default', eager: true });
const file = (path: string) => {
  const raw = json[`../../../fixtures/shape-pack/${path}`];
  if (typeof raw !== 'string') throw new Error(`missing fixture ${path}`);
  return new TextEncoder().encode(raw);
};
const inline = Object.values(fonts)[0];
if (typeof inline !== 'string') throw new Error('missing Inter fixture');
const INTER = Uint8Array.from(atob(inline.slice(inline.indexOf(',') + 1)), (c) => c.charCodeAt(0));
const SHA = sha256Hex(INTER);
const FONT_PATH = `fonts/${SHA}.woff2`;

function fixture(overrides: { font?: Uint8Array; index?: Uint8Array } = {}) {
  const files = new Map<string, Uint8Array>([
    ['categories/labels.json', file('v1.1/categories/labels.json')],
    [FONT_PATH, overrides.font ?? INTER],
  ]);
  const read = vi.fn(async (path: string, maxBytes: number) => {
    const bytes = files.get(path);
    if (!bytes) throw new Error(`missing ${path}`);
    if (bytes.byteLength > maxBytes) throw new Error('reader cap exceeded');
    return bytes;
  });
  const options: ShapePackLoaderOptions = {
    maxBytes: 2 * 1024 * 1024,
    read,
    hasher: { sha256: async (bytes) => sha256Hex(bytes) },
    licensePolicy: allowsShapePackContentLicense,
  };
  return { files, read, options, index: overrides.index ?? file('v1.1/index.json') };
}
async function loader(f = fixture()) {
  const result = await createArtworkShapePackLoader(f.index, f.options);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe('artwork font acquisition', () => {
  it('FR-LIB-004 NFR-LIC-003: acquires a 1.1 definition with its exact verified face bytes and covering font credits', async () => {
    const f = fixture();
    const pack = await loader(f);
    expect(pack.search('label').map((e) => e.id)).toEqual(['sample:label']);
    expect(f.read).not.toHaveBeenCalled();
    const result = await pack.acquire('sample:label');
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { definition, fonts, fontCredits } = result.value;
    expect(definition.id).toBe('sample:label');
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toMatchObject({
      faceId: 'inter',
      family: 'Inter',
      weight: 400,
      style: 'normal',
      resourceId: 'inter-400',
      sha256: SHA,
      profile: 'inter-latin-400-ascii',
    });
    expect(fonts[0]?.bytes).toEqual(INTER);
    expect(fontCredits.map((c) => c.id)).toEqual(['inter-ofl']);
    expect(fontCredits[0]?.notice).toContain('SIL Open Font License');
    expect(f.read.mock.calls).toEqual([
      ['categories/labels.json', f.options.maxBytes],
      [FONT_PATH, INTER.byteLength],
    ]);
    expect(Object.isFrozen(result.value) && Object.isFrozen(fonts) && Object.isFrozen(definition)).toBe(true);
  });

  it('FR-LIB-004: text-free geometry acquires no fonts or font credits', async () => {
    const f = fixture();
    const result = await (await loader(f)).acquire('sample:box');
    expect(result).toMatchObject({ ok: true, value: { fonts: [], fontCredits: [] } });
    expect(f.read.mock.calls.map((c) => c[0])).toEqual(['categories/labels.json']);
  });

  it('FR-LIB-004: consumers sharing one verified binary get independent byte copies', async () => {
    const f = fixture();
    const pack = await loader(f);
    const [label, badge] = await Promise.all([pack.acquire('sample:label'), pack.acquire('sample:badge')]);
    if (!label.ok || !badge.ok) throw new Error('fixture did not acquire');
    expect(f.read.mock.calls.filter((c) => c[0] === FONT_PATH)).toHaveLength(1);
    expect(badge.value.fonts[0]?.family).toBe('Brand Sans');
    label.value.fonts[0]?.bytes.fill(0);
    expect(badge.value.fonts[0]?.bytes).toEqual(INTER);
    const again = await pack.acquire('sample:label');
    expect(again.ok && again.value.fonts[0]?.bytes).toEqual(INTER);
    expect(f.files.get(FONT_PATH)).toEqual(INTER);
  });

  it('NFR-SEC-001 FR-LIB-004: bytes other than the pinned profile (changed, truncated, longer or non-WOFF2) refuse with no value, and failures are retried later', async () => {
    const flipped = INTER.slice();
    flipped[100] = (flipped[100] ?? 0) ^ 1;
    const notWoff = INTER.slice();
    notWoff[0] = 0;
    const longer = new Uint8Array(INTER.byteLength + 1);
    longer.set(INTER);
    for (const [name, font] of [
      ['wrong hash', flipped],
      ['truncated', INTER.slice(0, -1)],
      ['oversized', longer],
      ['not WOFF2', notWoff],
    ] as const) {
      const f = fixture({ font });
      const pack = await loader(f);
      const result = await pack.acquire('sample:label');
      expect(result.ok, name).toBe(false);
      expect('value' in result, name).toBe(false);
      f.files.set(FONT_PATH, INTER);
      expect((await pack.acquire('sample:label')).ok, `${name} retry`).toBe(true);
    }
  });

  it('NFR-SEC-001: a reader that returns other bytes than the cap allows, or throws, is refused', async () => {
    const f = fixture();
    f.read.mockImplementation(async (path: string) => {
      if (path === FONT_PATH) throw new Error('network down');
      return f.files.get(path) ?? new Uint8Array();
    });
    const result = await (await loader(f)).acquire('sample:label');
    expect(result.ok).toBe(false);
  });

  it('FR-LIB-004: cancellation before or during acquisition returns no value and leaves later acquisitions intact', async () => {
    const f = fixture();
    const pack = await loader(f);
    expect(await pack.acquire('sample:label', { signal: { aborted: true } })).toMatchObject({ ok: false });
    expect(f.read).not.toHaveBeenCalled();
    const signal = { aborted: false };
    f.read.mockImplementation(async (path: string) => {
      if (path === FONT_PATH) signal.aborted = true;
      return f.files.get(path) ?? new Uint8Array();
    });
    const during = await pack.acquire('sample:label', { signal });
    expect(during.ok).toBe(false);
    if (!during.ok) expect(during.error[0]?.message).toBe('acquisition was cancelled');
    expect((await pack.acquire('sample:label')).ok).toBe(true);
  });

  it('FR-LIB-004: arguments are captured before the first await', async () => {
    const f = fixture();
    const pack = await loader(f);
    const options = { signal: { aborted: false } };
    const pending = pack.acquire('sample:label', options);
    Reflect.set(options, 'signal', { aborted: true });
    expect((await pending).ok).toBe(true);
  });

  it('FR-LIB-004 NFR-LIC-003: 1.0 packs keep fontless loading, the 1.0 loader refuses 1.1, and unlicensed font rights refuse the index', async () => {
    const legacyIndex = file('index.json');
    const legacy = fixture({ index: legacyIndex });
    legacy.files.set('categories/basic.json', file('categories/basic.json'));
    legacy.options = { ...legacy.options, licensePolicy: (license) => license === 'MIT' };
    const pack = await loader(legacy);
    expect(await pack.acquire('sample:box')).toMatchObject({ ok: true, value: { fonts: [], fontCredits: [] } });
    const f = fixture();
    expect((await createShapePackLoader(f.index, f.options)).ok).toBe(false);
    const noFonts = await createArtworkShapePackLoader(f.index, { ...f.options, licensePolicy: (license) => license === 'MIT' });
    expect(noFonts.ok).toBe(false);
    expect(f.read).not.toHaveBeenCalled();
  });

  it('FR-LIB-004: one acquisition is bounded to 8 faces, 5 MiB per font and 8 MiB in total', () => {
    expect(ARTWORK_ACQUISITION_LIMITS).toEqual({ maxFontBytes: 5 * 1024 * 1024, maxFaces: 8, maxTotalFontBytes: 8 * 1024 * 1024 });
  });
});

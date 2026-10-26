import { allowsShapePackContentLicense, type ShapePackSubset } from '@fluxion/core';
import type { Result } from '@fluxion/schema';
import { documentBuilder } from '@fluxion/schema/testing';
import { expect, it } from 'vitest';
import { encodeBase64 } from './base64.js';
import { loadFlux, writePortableFlux } from './index.js';
import { loadFluxLean } from './lean.js';
import { sha256Hex } from './sha256.js';
import { decodeUtf8, decodeUtf8Strict, encodeUtf8 } from './utf8.js';
import { readZip, writeZip } from './zip.js';

const files = import.meta.glob('../../../fixtures/shape-pack/subset.json', { query: '?raw', import: 'default', eager: true });
const subset = (): ShapePackSubset => JSON.parse(Object.values(files)[0] ?? 'null');
const hasher = { sha256: async (b: Uint8Array) => sha256Hex(b) };
const options = { hasher, shapePackLicensePolicy: allowsShapePackContentLicense };
const path = 'plugins/sample@1.0.0/defs.json';
function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
const digest = (b: Uint8Array) => `sha256-${encodeBase64(Uint8Array.from(sha256Hex(b).match(/../g) ?? [], (s) => Number.parseInt(s, 16)))}`;
async function valid() {
  const b = documentBuilder();
  b.rect(b.screen(), { defId: 'sample:box' });
  return value(
    await writePortableFlux({
      document: b.build(),
      appVersion: '0',
      hasher,
      shapePacks: {
        sources: [{ kind: 'embedded', subset: subset() }],
        builtinIds: new Set(['basic:rect']),
        licensePolicy: allowsShapePackContentLicense,
      },
    }),
  ).bytes;
}
type Manifest = { plugins: Record<string, unknown>[]; entries: Record<string, { sha256: string; size: number }> };
function refresh(manifest: Manifest, entries: Map<string, Uint8Array>) {
  const bytes = entries.get(path);
  const lock = manifest.plugins[0];
  if (!bytes || !lock) throw new Error('missing fixture entry');
  manifest.entries[path] = { sha256: sha256Hex(bytes), size: bytes.length };
  lock['integrity'] = digest(bytes);
}
function rewrite(bytes: Uint8Array, edit: (manifest: Manifest, entries: Map<string, Uint8Array>) => void): Uint8Array {
  const entries = new Map(value(readZip(bytes)).map((e) => [e.name, e.bytes]));
  const manifest: Manifest = JSON.parse(decodeUtf8(entries.get('manifest.json') ?? new Uint8Array()));
  edit(manifest, entries);
  entries.set('manifest.json', encodeUtf8(JSON.stringify(manifest)));
  return value(writeZip([...entries].map(([name, data]) => ({ name, bytes: data }))));
}
const lock = (m: Manifest): Record<string, unknown> => {
  const first = m.plugins[0];
  if (!first) throw new Error('missing fixture lock');
  return first;
};

it('FR-LIB-009 NFR-SEC-001: known lock identity, version, path, hash and manifest size violations fail atomically in both loaders', async () => {
  const original = await valid();
  const unchanged = original.slice();
  const edits: ((m: Manifest, e: Map<string, Uint8Array>) => void)[] = [
    (m) => {
      lock(m)['packFormat'] = '2.0';
    },
    (m) => {
      lock(m)['version'] = '2.0.0';
    },
    (m) => {
      lock(m)['entry'] = 'plugins/other/defs.json';
    },
    (m) => {
      lock(m)['unexpected'] = true;
    },
    (m) => {
      lock(m)['integrity'] = `sha256-${'A'.repeat(43)}=`;
    },
    (m) => {
      m.plugins.push({ ...lock(m) });
    },
    (_m, e) => {
      e.delete(path);
    },
    (m) => {
      m.entries[path] = { sha256: '0'.repeat(64), size: 1 };
    },
    (m) => {
      const entry = m.entries[path];
      if (entry) entry.size++;
    },
    (m) => {
      delete m.entries[path];
    },
  ];
  for (const edit of edits)
    for (const load of [loadFlux, loadFluxLean]) {
      const result = await load(rewrite(original, edit), options);
      expect(result).toMatchObject({ ok: false, error: { code: 'FILE_SHAPE_PACK_INVALID', diagnostics: [expect.objectContaining({ severity: 'error' })] } });
      expect(result).not.toHaveProperty('value');
    }
  expect(original).toEqual(unchanged);
});

it('NFR-SEC-001 NFR-LIC-003: recomputed valid hashes cannot authorize malicious geometry, malformed UTF-8 or rejected credits', async () => {
  const original = await valid();
  const edits: ((m: Manifest, e: Map<string, Uint8Array>) => void)[] = [
    (m, e) => {
      const data = JSON.parse(decodeUtf8(e.get(path) ?? new Uint8Array()));
      data.definitions[0].artwork = {
        viewBox: { x: 0, y: 0, width: 10, height: 10 },
        root: { name: 'path', attributes: { d: 'M0 0L10 10', onload: 'alert(1)' }, children: [] },
      };
      e.set(path, encodeUtf8(JSON.stringify(data)));
      refresh(m, e);
    },
    (m, e) => {
      const data = JSON.parse(decodeUtf8(e.get(path) ?? new Uint8Array()));
      data.credits[0].license = 'GPL-3.0-only';
      e.set(path, encodeUtf8(JSON.stringify(data)));
      refresh(m, e);
    },
    (m, e) => {
      const data = JSON.parse(decodeUtf8(e.get(path) ?? new Uint8Array()));
      data.definitions.push(data.definitions[0]);
      e.set(path, encodeUtf8(JSON.stringify(data)));
      refresh(m, e);
    },
    (m, e) => {
      const data = JSON.parse(decodeUtf8(e.get(path) ?? new Uint8Array()));
      data.version = '2.0.0';
      e.set(path, encodeUtf8(JSON.stringify(data)));
      refresh(m, e);
    },
    (m, e) => {
      const bytes = encodeUtf8(decodeUtf8(e.get(path) ?? new Uint8Array()).replace('Fluxion', 'Xluxion'));
      const at = bytes.indexOf(88);
      bytes[at] = 255;
      e.set(path, bytes);
      refresh(m, e);
    },
    (m, e) => {
      e.set(path, encodeUtf8('{not json'));
      refresh(m, e);
    },
  ];
  for (const edit of edits)
    for (const load of [loadFlux, loadFluxLean])
      expect(await load(rewrite(original, edit), options)).toMatchObject({ ok: false, error: { code: 'FILE_SHAPE_PACK_INVALID' } });
});

it('FR-LIB-009: a malformed manifest entries table cannot hide declared known locks; archive limits remain enforced', async () => {
  const original = await valid();
  const broken = rewrite(original, (m) => {
    Object.assign(m, { entries: null });
  });
  expect(await loadFlux(broken, options)).toMatchObject({ ok: false, error: { code: 'FILE_SHAPE_PACK_INVALID' } });
  expect(await loadFlux(original, { ...options, limits: { maxEntryBytes: 32 } })).toMatchObject({ ok: false, error: { code: 'FILE_TOO_LARGE' } });
});

it('NFR-SEC-001: strict UTF-8 distinguishes a literal replacement character from malformed, truncated and overlong sequences', () => {
  for (const text of ['', 'ASCII', 'é', '😀', '\uFFFD']) expect(decodeUtf8Strict(encodeUtf8(text))).toBe(text);
  for (const bytes of [[255], [0xc0, 0x80], [0xe2, 0x82], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0x80]]) {
    expect(decodeUtf8Strict(Uint8Array.from(bytes))).toBeUndefined();
    expect(decodeUtf8(Uint8Array.from(bytes))).toContain('\uFFFD');
  }
});

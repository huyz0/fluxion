import { type AnyRecord, type DocumentFile, parseDocument, type RecordId } from '@fluxion/schema';
import { describe, expect, it } from 'vitest';
import { writeFlux } from './flux-writer.js';
import { type LoadedFlux, loadFlux } from './loader.js';
import { sha256Hex as sha256 } from './sha256.js';
import { decodeUtf8 } from './utf8.js';
import { readZip } from './zip.js';

declare global {
  interface ImportMeta {
    /** Vite's build-time glob import. */
    glob(pattern: string, options: { readonly query: '?raw'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

// the goldens (scripts/format/goldens.mjs writes them: base64 text of a `.flux`) and the document fixtures they are made from
const GOLDEN_TEXT = import.meta.glob('../__fixtures__/v1.0/*.flux.b64', { query: '?raw', import: 'default', eager: true });
const DOC_TEXT = import.meta.glob('../../../fixtures/docs/{minimal,two-rects-line,shapes-gallery,rich-text}.flux.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** The bytes of base64 text (this package's `lib` has no `atob`). */
function fromBase64(b64: string): Uint8Array {
  const out: number[] = [];
  let bits = 0;
  let count = 0;
  for (const ch of b64.trim().replace(/=+$/, '')) {
    bits = (bits << 6) | ALPHABET.indexOf(ch);
    count += 6;
    if (count >= 8) {
      count -= 8;
      out.push((bits >> count) & 0xff);
      bits &= (1 << count) - 1;
    }
  }
  return Uint8Array.from(out);
}
const nameOf = (path: string, suffix: string) => path.split('/').at(-1)?.replace(suffix, '') ?? path;
const goldens = new Map(Object.entries(GOLDEN_TEXT).map(([path, text]) => [nameOf(path, '.flux.b64'), fromBase64(text)]));
const documentOf = (name: string): DocumentFile => {
  const text = Object.entries(DOC_TEXT).find(([path]) => nameOf(path, '.flux.json') === name)?.[1] ?? '';
  const parsed = parseDocument(text);
  if (!parsed.ok) throw new Error(`fixture ${name} does not parse`);
  return parsed.value.document;
};
const hasher = { sha256: (bytes: Uint8Array) => Promise.resolve(sha256(bytes)) };
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Save a loaded file again with everything the loader handed back. */
function resave(l: LoadedFlux): ReturnType<typeof writeFlux> {
  return writeFlux({
    document: l.document,
    appVersion: l.manifest?.appVersion ?? '0',
    hasher,
    assets: l.assets,
    extraEntries: l.extraEntries,
    manifestExtras: l.manifestExtras,
    ...(l.manifest?.plugins === undefined ? {} : { plugins: l.manifest.plugins }),
    ...(l.manifest?.bakes === undefined ? {} : { bakes: l.manifest.bakes }),
    ...(l.manifest?.generator === undefined ? {} : { generator: l.manifest.generator }),
    ...(l.source === undefined ? {} : { source: l.source }),
    ...(l.preview === undefined ? {} : { preview: l.preview }),
  });
}
const load = async (bytes: Uint8Array): Promise<LoadedFlux> => {
  const r = await loadFlux(bytes, { hasher });
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};

describe('the v1.0 goldens', () => {
  it('NFR-PORT-003: every v1.0 golden loads, migrates and round-trips byte-identically', async () => {
    expect([...goldens.keys()].sort()).toEqual(['assets-and-extras', 'minimal', 'rich-text', 'schema-1.0', 'shapes-gallery', 'two-rects-line']);
    for (const [name, bytes] of goldens) {
      const loaded = await load(bytes);
      expect(loaded.notes, name).toEqual([]);
      expect(loaded.readOnly, name).toBe(false);
      expect(loaded.salvage, name).toBeUndefined();
      const again = await resave(loaded);
      if (!again.ok) throw new Error(again.error.reason);
      // a file still at schema 1.0 opens migrated: its document is saved at 1.2, so it is not the same bytes
      if (name === 'schema-1.0') {
        expect(loaded.document.schemaVersion).toBe('1.2');
        expect(same(again.value, bytes)).toBe(false);
      } else expect(same(again.value, bytes), name).toBe(true);
    }
  });

  it('NFR-PORT-003: the writer still produces the goldens from the shared document fixtures', async () => {
    for (const name of ['minimal', 'two-rects-line', 'shapes-gallery', 'rich-text']) {
      const zip = await writeFlux({ document: documentOf(name), appVersion: '1.0.0', generator: 'fluxion goldens', hasher });
      expect(zip.ok && same(zip.value, goldens.get(name) as Uint8Array), name).toBe(true);
    }
  });

  it('NFR-PORT-003: unknown entries and unknown fields survive a re-save', async () => {
    const loaded = await load(goldens.get('assets-and-extras') as Uint8Array);
    expect([...loaded.extraEntries.keys()]).toEqual([
      'plugins/acme.chart@1.0.0/fluxion-plugin.json',
      'plugins/acme.chart@1.0.0/player.js',
      'x-newer/notes.txt',
    ]);
    expect(loaded.manifestExtras).toEqual({ 'x-newer': { flag: true, level: 3 } });
    expect(loaded.source).toBe('flux: 1\nscreens: []\n');
    expect(loaded.preview?.length).toBeGreaterThan(0);
    expect(loaded.assets.size).toBe(1);
    const again = await resave(loaded);
    if (!again.ok) throw new Error(again.error.reason);
    const read = readZip(again.value);
    if (!read.ok) throw new Error(read.error.reason);
    const names = read.value.map((e) => e.name);
    for (const name of loaded.extraEntries.keys()) expect(names).toContain(name);
    const manifest = JSON.parse(decodeUtf8(read.value.find((e) => e.name === 'manifest.json')?.bytes ?? new Uint8Array())) as {
      'x-newer'?: unknown;
      entries: object;
    };
    expect(manifest['x-newer']).toEqual({ flag: true, level: 3 });
    expect(Object.keys(manifest.entries)).toContain('x-newer/notes.txt');

    // unknown fields of a record and a record of a type this version does not know: kept by the schema, carried by the container
    const base = documentOf('two-rects-line');
    const first = Object.values(base.records).find((r) => r.type === 'screen') as AnyRecord;
    const future = {
      ...base,
      records: {
        ...base.records,
        [first.id]: { ...first, 'x-future': { deep: [1, 2, 3] } },
        ZZZZZZZZZZZZZZZZ: { id: 'ZZZZZZZZZZZZZZZZ' as RecordId, type: 'hologram', depth: 9 },
      },
    } as DocumentFile;
    const zip = await writeFlux({ document: future, appVersion: '1', hasher });
    if (!zip.ok) throw new Error(zip.error.reason);
    const reloaded = await load(zip.value);
    expect(reloaded.document.records[first.id as RecordId]).toMatchObject({ 'x-future': { deep: [1, 2, 3] } });
    expect(reloaded.document.records['ZZZZZZZZZZZZZZZZ' as RecordId]).toMatchObject({ type: 'hologram', depth: 9 });
    const second = await resave(reloaded);
    expect(second.ok && same(second.value, zip.value)).toBe(true);
  });

  it('NFR-PORT-003: the plugin lock and the baked flags of the manifest survive a re-save, and a manifest extra cannot override what the writer writes', async () => {
    const doc = documentOf('minimal');
    const plugins = [{ id: 'acme.chart', version: '1.0.0', sdk: '1', integrity: 'sha256-x', entry: 'player.js', trust: 'trusted' }];
    const zip = await writeFlux({
      document: doc,
      appVersion: '1',
      hasher,
      plugins,
      bakes: { routes: true, snapshots: true },
      // every key here is one the writer owns: none may take effect
      manifestExtras: { title: 'evil', entries: {}, source: 'x.yaml', preview: 'p.webp', generator: 'evil', format: 'other', app: {}, keep: 1 },
    });
    if (!zip.ok) throw new Error(zip.error.reason);
    const loaded = await load(zip.value);
    expect(loaded.notes).toEqual([]);
    expect(loaded.manifest).toMatchObject({ plugins, bakes: { routes: true, snapshots: true }, appVersion: '1' });
    expect(loaded.manifest?.generator).toBeUndefined();
    expect(loaded.manifestExtras).toEqual({ keep: 1 });
    const read = readZip(zip.value);
    const manifest = JSON.parse(
      decodeUtf8(read.ok ? (read.value.find((e) => e.name === 'manifest.json')?.bytes ?? new Uint8Array()) : new Uint8Array()),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({ format: 'fluxion', title: 'Minimal' });
    expect(manifest).not.toHaveProperty('source');
    expect(manifest).not.toHaveProperty('preview');
    const again = await resave(loaded);
    expect(again.ok && same(again.value, zip.value)).toBe(true);
  });

  it('FR-FIL-009: the writer refuses extra entries the loader would refuse', async () => {
    const doc = documentOf('minimal');
    for (const name of ['../x', '/abs', 'a//b', '', 'dir/', 'a\\b', 'C:/x', 'ok/./x']) {
      const r = await writeFlux({ document: doc, appVersion: '1', hasher, extraEntries: new Map([[name, new Uint8Array([1])]]) });
      expect(r.ok, name).toBe(false);
    }
    // two names that are one path on a case-insensitive file system
    const twins = new Map([
      ['x/Notes.txt', new Uint8Array([1])],
      ['x/notes.txt', new Uint8Array([2])],
    ]);
    expect((await writeFlux({ document: doc, appVersion: '1', hasher, extraEntries: twins })).ok).toBe(false);
  });

  it('NFR-PORT-003: an asset with an extension this version does not know is written back under its own name', async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const hash = sha256(bytes);
    const zip = await writeFlux({
      document: documentOf('minimal'),
      appVersion: '1',
      hasher,
      assets: new Map([[hash, { bytes, mime: 'application/octet-stream', ext: 'jxl' }]]),
    });
    if (!zip.ok) throw new Error(zip.error.reason);
    const loaded = await load(zip.value);
    expect(loaded.assets.get(hash)).toMatchObject({ mime: 'application/octet-stream', ext: 'jxl' });
    const again = await resave(loaded);
    expect(again.ok && same(again.value, zip.value)).toBe(true);
    const names = again.ok && readZip(again.value).ok ? (readZip(again.value) as { value: { name: string }[] }).value.map((e) => e.name) : [];
    expect(names).toContain(`assets/${hash}.jxl`);
  });

  it('NFR-PORT-003: an extra entry may not shadow one the writer writes, nor an asset path', async () => {
    const doc = documentOf('minimal');
    for (const name of ['document.json', 'manifest.json', 'mimetype', 'preview.webp', 'assets/x']) {
      const r = await writeFlux({ document: doc, appVersion: '1', hasher, extraEntries: new Map([[name, new Uint8Array([1])]]) });
      expect(r.ok, name).toBe(false);
    }
  });
});

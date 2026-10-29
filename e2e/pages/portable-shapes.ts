import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
type Saved = {
  shapePacks: { definitions: { id: string }[]; credits: unknown[] }[];
  manifest?: { plugins?: unknown[] };
  extraEntries: ReadonlyMap<string, Uint8Array>;
};
type FormatApi = {
  writeFlux(input: unknown): Promise<Result<Uint8Array>>;
  writePortableFlux(input: unknown): Promise<Result<{ bytes: Uint8Array }>>;
  loadFlux(bytes: Uint8Array, options: unknown): Promise<Result<Saved>>;
  sha256Hex(bytes: Uint8Array): string;
  readZip(bytes: Uint8Array): Result<{ name: string; bytes: Uint8Array }[]>;
  writeZip(entries: { name: string; bytes: Uint8Array }[]): Result<Uint8Array>;
  importSvgShape(svg: string, options: unknown): Promise<Result<{ definition: unknown; fonts: unknown[] }>>;
  importedShapePack(options: unknown): Result<{ source: unknown }>;
};
type CoreApi = { allowsShapePackContentLicense(license: string): boolean };
type SchemaApi = { parseDocument(text: string): Result<{ document: unknown }> };
const load = <T>(file: string): Promise<T> => import(pathToFileURL(resolve(file)).href) as Promise<T>;
const value = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
async function format() {
  const api = await load<FormatApi>('packages/format/dist/index.js');
  return { api, hasher: { sha256: async (bytes: Uint8Array) => api.sha256Hex(bytes) } };
}

/** Real portable artwork or a legacy unresolved reference, built without registry injection. */
export async function portableShapeFile(unresolved = false): Promise<Uint8Array> {
  const { api, hasher } = await format();
  const core = await load<CoreApi>('packages/core/dist/index.js');
  const schema = await load<SchemaApi>('packages/schema/dist/index.js');
  const json = JSON.parse(readFileSync('fixtures/docs/minimal.flux.json', 'utf8')) as { records: Record<string, { type: string; id: string }> };
  const screen = Object.values(json.records).find((record) => record.type === 'screen');
  if (!screen) throw new Error('fixture has no screen');
  const record = {
    id: 'PortableShape01',
    type: 'element',
    kind: 'shape',
    screenId: screen.id,
    index: 'a0',
    defId: unresolved ? 'legacy:missing' : 'sample:box',
    transform: { x: 150, y: 150, w: 100, h: 100 },
  };
  const document = value(schema.parseDocument(JSON.stringify({ ...json, records: { ...json.records, [record.id]: record } }))).document;
  const input = { document, appVersion: '0', hasher };
  if (unresolved) return value(await api.writeFlux(input));
  const pack = JSON.parse(readFileSync('fixtures/shape-pack/subset.json', 'utf8'));
  const artwork = JSON.parse(readFileSync('fixtures/artwork/paint.shape.json', 'utf8'));
  const subset = { ...pack, definitions: [{ ...artwork, id: 'sample:box' }] };
  return value(
    await api.writePortableFlux({
      ...input,
      plugins: [{ kind: 'future', id: 'opaque' }],
      extraEntries: new Map([['future/data.bin', new Uint8Array([0, 255, 1])]]),
      shapePacks: { sources: [{ kind: 'embedded', subset }], builtinIds: new Set(), licensePolicy: core.allowsShapePackContentLicense },
    }),
  ).bytes;
}

/** Inspect actual Studio output with the same strict public reader. */
export async function savedShapeData(bytes: Uint8Array) {
  const { api, hasher } = await format();
  const core = await load<CoreApi>('packages/core/dist/index.js');
  const loaded = value(await api.loadFlux(bytes, { hasher, shapePackLicensePolicy: core.allowsShapePackContentLicense }));
  return {
    ids: loaded.shapePacks.flatMap((pack) => pack.definitions.map((def) => def.id)),
    credits: loaded.shapePacks.flatMap((pack) => pack.credits),
    opaque: loaded.manifest?.plugins?.some((lock) => typeof lock === 'object' && lock !== null && 'id' in lock && lock.id === 'opaque'),
    bytes: [...(loaded.extraEntries.get('future/data.bin') ?? [])],
  };
}

/** Malicious geometry with valid hashes: rejection must come from semantic validation. */
export async function malformedShapeFile(): Promise<Uint8Array> {
  const { api } = await format();
  const entries = new Map(value(api.readZip(await portableShapeFile())).map((entry) => [entry.name, entry.bytes]));
  const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
  const lock = manifest.plugins.find((item: { kind?: string }) => item.kind === 'declarative-shapes');
  if (!lock) throw new Error('fixture has no known lock');
  const pack = JSON.parse(new TextDecoder().decode(entries.get(lock.entry)));
  pack.definitions[0].artwork.root.attributes.onload = 'globalThis.__unsafe = true';
  const bytes = new TextEncoder().encode(JSON.stringify(pack));
  const hash = api.sha256Hex(bytes);
  entries.set(lock.entry, bytes);
  manifest.entries[lock.entry] = { sha256: hash, size: bytes.length };
  lock.integrity = `sha256-${Buffer.from(hash, 'hex').toString('base64')}`;
  entries.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)));
  return value(api.writeZip([...entries].map(([name, data]) => ({ name, bytes: data }))));
}

/** A real full 5000-definition pack file; Studio's actual Save must reduce it to three. */
export async function fullDistributionFile(): Promise<Uint8Array> {
  type Source = { index: { id: string; version: string; license: string; attribution: string; credits: unknown[] }; definitions: unknown[] };
  const fixtures = await load<{ portableDistribution(): Source; portableDocument(): unknown }>('packages/format/src/portable-shape-fixture.ts');
  const { api, hasher } = await format();
  const core = await load<CoreApi>('packages/core/dist/index.js');
  const source = fixtures.portableDistribution();
  if (source.definitions.length !== 5000) throw new Error('full distribution fixture must contain 5000 definitions');
  const { id, version, license, attribution, credits } = source.index;
  const subset = { format: 'fluxion-shape-pack', formatVersion: '1.0', id, version, license, attribution, credits, definitions: source.definitions };
  const bytes = new TextEncoder().encode(JSON.stringify(subset));
  const entry = `plugins/${id}@${version}/defs.json`;
  const lock = {
    kind: 'declarative-shapes',
    id,
    version,
    packFormat: '1.0',
    entry,
    integrity: `sha256-${Buffer.from(api.sha256Hex(bytes), 'hex').toString('base64')}`,
  };
  return value(
    await api.writeFlux({
      document: fixtures.portableDocument(),
      hasher,
      appVersion: '0',
      plugins: [lock],
      extraEntries: new Map([[entry, bytes]]),
      shapePackLicensePolicy: core.allowsShapePackContentLicense,
    }),
  );
}

/** A real `.flux` whose saved 1.1 pack draws `sample:label`'s text in exact Inter, retained as `assets/<sha>.woff2` (ADR-0192). */
export async function artworkFontFile(): Promise<{ readonly bytes: Uint8Array; readonly sha256: string }> {
  const { api, hasher } = await format();
  const core = await load<CoreApi>('packages/core/dist/index.js');
  const schema = await load<SchemaApi>('packages/schema/dist/index.js');
  const json = JSON.parse(readFileSync('fixtures/docs/minimal.flux.json', 'utf8')) as { records: Record<string, { type: string; id: string }> };
  const screen = Object.values(json.records).find((record) => record.type === 'screen');
  if (!screen) throw new Error('fixture has no screen');
  const record = {
    id: 'ArtworkLabel01',
    type: 'element',
    kind: 'shape',
    screenId: screen.id,
    index: 'a0',
    defId: 'sample:label',
    transform: { x: 150, y: 150, w: 240, h: 120 },
  };
  const document = value(schema.parseDocument(JSON.stringify({ ...json, records: { ...json.records, [record.id]: record } }))).document;
  const subset = JSON.parse(readFileSync('fixtures/shape-pack/v1.1/subset.json', 'utf8'));
  const inter = new Uint8Array(readFileSync('packs/fonts-core/fonts/inter-latin-400-normal.woff2'));
  const sha256 = api.sha256Hex(inter);
  const written = await api.writePortableFlux({
    document,
    appVersion: '0',
    hasher,
    shapePacks: {
      sources: [{ kind: 'embedded', subset, fonts: new Map([[sha256, inter]]) }],
      builtinIds: new Set(),
      licensePolicy: core.allowsShapePackContentLicense,
    },
  });
  return { bytes: value(written).bytes, sha256 };
}

/** The saved packs' format versions and the bytes of `sha256` in Studio output, read with the strict public reader. */
export async function savedArtworkFont(bytes: Uint8Array, sha256: string) {
  const { api, hasher } = await format();
  const core = await load<CoreApi>('packages/core/dist/index.js');
  const loaded = value(await api.loadFlux(bytes, { hasher, shapePackLicensePolicy: core.allowsShapePackContentLicense })) as unknown as {
    shapePacks: { formatVersion: string }[];
    assets: ReadonlyMap<string, { bytes: Uint8Array }>;
  };
  return { versions: loaded.shapePacks.map((pack) => pack.formatVersion), font: loaded.assets.get(sha256)?.bytes };
}

/**
 * A `.flux` holding an imported SVG whose text needs exact Inter, saved as a 1.1 pack with the bytes (M18.81), and an ordinary
 * text element drawn in the document's own Inter: the same family, which the artwork's bytes must never take.
 */
export async function importedArtworkFontFile(): Promise<{ readonly bytes: Uint8Array; readonly sha256: string }> {
  const { api, hasher } = await format();
  const core = await load<CoreApi>('packages/core/dist/index.js');
  const schema = await load<SchemaApi>('packages/schema/dist/index.js');
  const inter = new Uint8Array(readFileSync('packs/fonts-core/fonts/inter-latin-400-normal.woff2'));
  const sha256 = api.sha256Hex(inter);
  const face = { family: 'Inter', weight: 400, style: 'normal', sha256 };
  // a deterministic paint port: this file exercises retention, not the witness (M18.80 qualifies that)
  const witness = async (r: { identity: string; fonts: { sha256: string }[] }) => ({
    identity: r.identity,
    status: 'painted',
    fontHashes: r.fonts.map((f) => f.sha256),
  });
  const svg = value(
    await api.importSvgShape('<svg viewBox="0 0 80 40"><text x="4" y="24" font-family="Inter">API</text></svg>', { id: 'mine:api', witness, fonts: [face] }),
  );
  const pack = value(
    api.importedShapePack({
      namespace: 'mine',
      version: '1.0.0',
      name: 'My shapes',
      license: 'CC0-1.0',
      attribution: 'Document author',
      notice: 'Drawn by the document author and dedicated to the public domain.',
      source: { kind: 'original', author: 'Document author', statement: 'Original work of the document author.' },
      licensePolicy: core.allowsShapePackContentLicense,
      entries: [{ definition: svg.definition, name: 'API', fonts: svg.fonts }],
      fonts: [
        {
          bytes: inter,
          license: 'OFL-1.1',
          attribution: 'Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)',
          notice: 'Inter is licensed under the SIL Open Font License, Version 1.1.',
          source: { kind: 'upstream', reference: 'npm:@fontsource/inter@5.3.0/files/inter-latin-400-normal.woff2', sha256 },
        },
      ],
    }),
  );
  const json = JSON.parse(readFileSync('fixtures/docs/minimal.flux.json', 'utf8')) as { records: Record<string, { type: string; id: string }> };
  const screen = Object.values(json.records).find((record) => record.type === 'screen');
  if (!screen) throw new Error('fixture has no screen');
  const shape = {
    id: 'ImportedText001',
    type: 'element',
    kind: 'shape',
    screenId: screen.id,
    index: 'a0',
    defId: 'mine:api',
    transform: { x: 150, y: 150, w: 240, h: 120 },
  };
  const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'Ordinary Inter' }] };
  const text = {
    id: 'OrdinaryText001',
    type: 'element',
    kind: 'text',
    screenId: screen.id,
    index: 'a1',
    text: { type: 'doc', content: [paragraph] },
    transform: { x: 150, y: 320, w: 400, h: 60 },
  };
  const records = { ...json.records, [shape.id]: shape, [text.id]: text };
  const document = value(schema.parseDocument(JSON.stringify({ ...json, records }))).document;
  const shapePacks = { sources: [pack.source], builtinIds: new Set(), licensePolicy: core.allowsShapePackContentLicense };
  return { bytes: value(await api.writePortableFlux({ document, appVersion: '0', hasher, shapePacks })).bytes, sha256 };
}

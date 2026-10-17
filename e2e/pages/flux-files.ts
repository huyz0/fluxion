import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

// `.flux` files for the open and save specs, made from the built packages (the specs are type-checked before the build, so the packages are
// loaded by path at run time).
type Hasher = { readonly sha256: (bytes: Uint8Array) => Promise<string> };
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
type FormatApi = {
  readonly writeFlux: (input: { document: unknown; appVersion: string; hasher: Hasher }) => Promise<Result<Uint8Array>>;
  readonly loadFlux: (
    bytes: Uint8Array,
    options: { hasher: Hasher },
  ) => Promise<
    Result<{
      document: {
        records: {
          [id: string]: {
            type: string;
            title?: string;
            description?: string;
            tags?: string[];
            custom?: { [key: string]: string };
            created?: string;
            modified?: string;
            w?: number;
            h?: number;
            mime?: string;
            hash?: string;
          };
        };
      };
      assets: ReadonlyMap<string, { bytes: Uint8Array }>;
    }>
  >;
  readonly sha256Hex: (bytes: Uint8Array) => string;
};
type SchemaApi = { readonly parseDocument: (text: string) => Result<{ document: unknown }> };

const load = <T>(file: string): Promise<T> => import(pathToFileURL(resolve(file)).href) as Promise<T>;
const value = <T>(r: Result<T>, what: string): T => {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r.error)}`);
  return r.value;
};
const format = () => load<FormatApi>('packages/format/dist/index.js');
const hasherOf = (api: FormatApi): Hasher => ({ sha256: (bytes) => Promise.resolve(api.sha256Hex(bytes)) });

/** The bytes of a `.flux` of the document fixture `name` (fixtures/docs/<name>.flux.json). */
export async function fluxFileOf(name: string): Promise<Uint8Array> {
  const api = await format();
  const schema = await load<SchemaApi>('packages/schema/dist/index.js');
  const parsed = value(schema.parseDocument(readFileSync(resolve(`fixtures/docs/${name}.flux.json`), 'utf8')), 'parseDocument');
  return value(await api.writeFlux({ document: parsed.document, appVersion: '1.0.0', hasher: hasherOf(api) }), 'writeFlux');
}

/** The text of the fixture `name` with a schema version from the future, which the studio may show but never save over. */
export function newerMajorJson(name: string): string {
  return readFileSync(resolve(`fixtures/docs/${name}.flux.json`), 'utf8').replace(/"schemaVersion":\s*"[^"]*"/, '"schemaVersion": "9.0"');
}

/** The title of the document inside saved `.flux` bytes. */
export async function titleOf(bytes: Uint8Array): Promise<string> {
  const api = await format();
  const loaded = value(await api.loadFlux(bytes, { hasher: hasherOf(api) }), 'loadFlux');
  const doc = Object.values(loaded.document.records).find((r) => r.type === 'document');
  return doc?.title ?? '';
}

/** The image assets of saved `.flux` bytes: their pixel size and type, and whether the file holds their bytes. */
export async function imageAssetsOf(
  bytes: Uint8Array,
): Promise<{ w: number | undefined; h: number | undefined; mime: string | undefined; embedded: boolean }[]> {
  const api = await format();
  const loaded = value(await api.loadFlux(bytes, { hasher: hasherOf(api) }), 'loadFlux');
  return Object.values(loaded.document.records)
    .filter((r) => r.type === 'asset' && r.mime?.startsWith('image/'))
    .map((r) => ({ w: r.w, h: r.h, mime: r.mime, embedded: r.hash !== undefined && loaded.assets.has(r.hash) }));
}

/** The document record inside saved `.flux` bytes: its metadata and times. */
export async function documentRecordOf(bytes: Uint8Array): Promise<{
  title?: string;
  description?: string;
  tags?: string[];
  custom?: { [key: string]: string };
  created?: string;
  modified?: string;
}> {
  const api = await format();
  const loaded = value(await api.loadFlux(bytes, { hasher: hasherOf(api) }), 'loadFlux');
  return Object.values(loaded.document.records).find((r) => r.type === 'document') ?? {};
}

/** The bytes of a `.flux` with one screen and one image element whose asset is the external `url` (hash unpinned, no bytes in the file). */
export async function fluxWithExternalImage(url: string): Promise<Uint8Array> {
  const api = await format();
  const schema = await load<SchemaApi>('packages/schema/dist/index.js');
  const records = {
    docExt00000000a1: { id: 'docExt00000000a1', type: 'document', title: 'External image' },
    scrExt00000000a1: { id: 'scrExt00000000a1', type: 'screen', index: 'a0', name: 'Main' },
    astExt00000000a1: { id: 'astExt00000000a1', type: 'asset', hash: '0'.repeat(64), mime: 'image/png', size: 0, name: 'pic.png', source: url },
    elExt000000000a1: {
      id: 'elExt000000000a1',
      type: 'element',
      kind: 'image',
      screenId: 'scrExt00000000a1',
      index: 'a0',
      assetId: 'astExt00000000a1',
      transform: { x: 200, y: 200, w: 400, h: 300 },
    },
  };
  const parsed = value(schema.parseDocument(JSON.stringify({ schemaVersion: '1.3', records })), 'parseDocument');
  return value(await api.writeFlux({ document: parsed.document, appVersion: '1.0.0', hasher: hasherOf(api) }), 'writeFlux');
}

/** A valid PNG of a solid `w` x `h` colour, made here so a page can decode it. */
export function solidPng(w: number, h: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array): number => (b.reduce((c, byte) => (crcTable[(c ^ byte) & 255] as number) ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [200, 40, 40]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

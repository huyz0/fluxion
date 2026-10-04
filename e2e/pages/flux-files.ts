import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// `.flux` files for the open and save specs, made from the built packages (the specs are type-checked before the build, so the packages are
// loaded by path at run time).
type Hasher = { readonly sha256: (bytes: Uint8Array) => Promise<string> };
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
type FormatApi = {
  readonly writeFlux: (input: { document: unknown; appVersion: string; hasher: Hasher }) => Promise<Result<Uint8Array>>;
  readonly loadFlux: (
    bytes: Uint8Array,
    options: { hasher: Hasher },
  ) => Promise<Result<{ document: { records: { [id: string]: { type: string; title?: string } } } }>>;
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

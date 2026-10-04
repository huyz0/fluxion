import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Makes a `.flux.html` from the built packages (`pnpm build` writes their dist, as CI's dist artifact carries it): the document fixture
// as a `.flux`, embedded with the built one-file player. The packages are loaded by path at run time because the specs are type-checked
// before the build.
type FormatApi = {
  readonly writeFlux: (input: { document: unknown; appVersion: string; generator: string; hasher: Hasher }) => Promise<Result<Uint8Array>>;
  readonly writeFluxHtml: (input: { flux: Uint8Array; playerScript: string; title: string; hasher: Hasher; noscriptSvg?: string }) => Promise<Result<string>>;
  readonly sha256Hex: (bytes: Uint8Array) => string;
};
type SchemaApi = { readonly parseDocument: (text: string) => Result<{ document: unknown }> };
type Hasher = { readonly sha256: (bytes: Uint8Array) => Promise<string> };
type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

const load = <T>(file: string): Promise<T> => import(pathToFileURL(resolve(file)).href) as Promise<T>;
const value = <T>(r: Result<T>, what: string): T => {
  if (!r.ok) throw new Error(`${what}: ${JSON.stringify(r.error)}`);
  return r.value;
};

/** The text of a `.flux.html` of the document fixture `name` (fixtures/docs/<name>.flux.json). */
export async function fluxHtmlOf(name: string, extra: { title?: string; noscriptSvg?: string } = {}): Promise<string> {
  const format = await load<FormatApi>('packages/format/dist/index.js');
  const schema = await load<SchemaApi>('packages/schema/dist/index.js');
  const hasher: Hasher = { sha256: (bytes) => Promise.resolve(format.sha256Hex(bytes)) };
  const parsed = value(schema.parseDocument(readFileSync(resolve(`fixtures/docs/${name}.flux.json`), 'utf8')), 'parseDocument');
  const flux = value(await format.writeFlux({ document: parsed.document, appVersion: '1.0.0', generator: 'e2e', hasher }), 'writeFlux');
  const playerScript = readFileSync(resolve('packages/player-inline/dist/player.inline.js'), 'utf8');
  return value(
    await format.writeFluxHtml({
      flux,
      playerScript,
      title: extra.title ?? name,
      hasher,
      ...(extra.noscriptSvg === undefined ? {} : { noscriptSvg: extra.noscriptSvg }),
    }),
    'writeFluxHtml',
  );
}

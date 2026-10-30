// `fluxion convert <input> <output>` (FR-FIL-003, FR-CLI-001, ADR-0155): a `.flux` becomes a `.flux.html` and a `.flux.html` becomes the `.flux` it
// holds. The archive is moved unchanged, so the round trip is byte-identical. Nothing in the input executes or is trusted: the archive is
// verified by its recorded hash (`readFluxHtml`) or opened by the loader (`loadFlux`) before it is embedded. A `.flux` also becomes a
// `.flux.json` and back (FR-FIL-005, ADR-0162), with `--assets external` writing the assets beside the JSON. Saved shape packs are
// opened under the shape content policy (ADR-0184), as every host opens them.

import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ContentHasher,
  type FontSubsetLine,
  loadFlux,
  readFluxHtml,
  readFluxJson,
  sha256Hex,
  writeFlux,
  writeFluxHtml,
  writeFluxJson,
} from '@fluxion/format';
import { allowsShapePackContentLicense } from '@fluxion/sdk';
import { type Command, internal, io, type Outcome, usage } from './command.js';
import { cliSubsetDeps, subsetFlux } from './font-subset.js';
import { CLI_VERSION } from './version.js';

const hasher: ContentHasher = { sha256: (bytes) => Promise.resolve(sha256Hex(bytes)) };

/** What a path's name says it is. */
const kindOf = (path: string): 'flux' | 'html' | 'json' | undefined => {
  const name = path.toLowerCase();
  return name.endsWith('.flux.html') ? 'html' : name.endsWith('.flux.json') ? 'json' : name.endsWith('.flux') ? 'flux' : undefined;
};
const DIRECTION = { html: 'to-html', flux: 'to-flux', json: 'to-json' } as const;

/**
 * The text of the build output `file` of the `@fluxion/player-inline` package next to its entry (`player.inline.js`, the one-file player;
 * `fluxion-routing.js`, its routing chunk), or undefined when it is not built.
 */
async function playerScript(file = 'player.inline.js'): Promise<string | undefined> {
  const entry = import.meta.resolve('@fluxion/player-inline');
  for (const candidate of [`./${file}`, `../dist/${file}`]) {
    try {
      return await readFile(fileURLToPath(new URL(candidate, entry)), 'utf8');
    } catch {
      // not there: try the next place
    }
  }
  return undefined;
}

/** The document title of an opened `.flux`, if it has a non-empty one. */
function titleOf(records: { readonly [id: string]: unknown }): string | undefined {
  const document = Object.values(records).find((r) => (r as { type?: unknown }).type === 'document') as { title?: unknown } | undefined;
  return typeof document?.title === 'string' && document.title !== '' ? document.title : undefined;
}

/** The reason as one line. */
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `.flux` bytes → the text of a `.flux.html` that embeds them. */
async function toHtml(flux: Uint8Array, fallbackTitle: string, input: string): Promise<{ readonly html: string } | Outcome> {
  const loaded = await loadFlux(flux, { hasher, shapePackLicensePolicy: allowsShapePackContentLicense });
  if (!loaded.ok) return io(`cannot convert ${input}: ${loaded.error.message}`, ['argv']);
  const player = await playerScript();
  if (player === undefined) return internal('the one-file player is not built: run the build of @fluxion/player-inline');
  const routing = await playerScript('fluxion-routing.js');
  if (routing === undefined) return internal('the routing chunk of the one-file player is not built: run the build of @fluxion/player-inline');
  const written = await writeFluxHtml({
    flux,
    playerScript: player,
    routingScript: routing,
    title: titleOf(loaded.value.document.records) ?? fallbackTitle,
    generator: 'fluxion convert',
    hasher,
  });
  return written.ok ? { html: written.value } : io(`cannot convert ${input}: ${written.error.reason}`, ['argv']);
}

/** `.flux` bytes → a `.flux.json` text and the asset files to write beside it. */
async function toJson(flux: Uint8Array, input: string, output: string, assets: 'inline' | 'external'): Promise<Produced | Outcome> {
  const loaded = await loadFlux(flux, { hasher, shapePackLicensePolicy: allowsShapePackContentLicense });
  if (!loaded.ok) return io(`cannot convert ${input}: ${loaded.error.message}`, ['argv']);
  // a .flux.json has no place for saved shape packs or their retained fonts: refused rather than written without them
  if (loaded.value.shapePacks.length > 0)
    return io(`cannot convert ${input}: its saved shape packs cannot be kept in a .flux.json; convert it to a .flux.html instead`, ['argv']);
  const { document, source } = loaded.value;
  const name = output.replace(/^.*[\\/]/, '').replace(/\.flux\.json$/i, '');
  const written = await writeFluxJson({
    document,
    assets: loaded.value.assets,
    ...(source === undefined ? {} : { source }),
    appVersion: CLI_VERSION,
    generator: 'fluxion convert',
    assetsMode: assets,
    name,
    hasher,
  });
  if (!written.ok) return io(`cannot convert ${input}: ${written.error.reason}`, ['argv']);
  return { bytes: new TextEncoder().encode(written.value.text), files: written.value.files };
}

/** `.flux.json` text → `.flux` bytes, external assets read from the JSON's folder. */
async function fromJson(text: string, input: string): Promise<Produced | Outcome> {
  const folder = dirname(input);
  const read = readFluxJson(text, (path) => {
    try {
      return new Uint8Array(readFileSync(join(folder, path)));
    } catch {
      return undefined;
    }
  });
  if (!read.ok) return io(`cannot convert ${input}: ${read.error.reason}`, ['argv']);
  const { document, source, assets } = read.value;
  const written = await writeFlux({
    document,
    assets,
    ...(source === undefined ? {} : { source }),
    appVersion: CLI_VERSION,
    generator: 'fluxion convert',
    hasher,
  });
  return written.ok ? { bytes: written.value, files: [] } : io(`cannot convert ${input}: ${written.error.reason}`, ['argv']);
}

type Produced = {
  readonly bytes: Uint8Array;
  readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[];
  readonly fonts?: readonly FontSubsetLine[];
};

/** The bytes (and side files) `input` converts to. */
type Request = {
  readonly input: string;
  readonly output: string;
  readonly from: string;
  readonly to: string;
  readonly assets: 'inline' | 'external';
  readonly subsetFonts: boolean;
};

/** `.flux` bytes with their eligible fonts subset (ADR-0201), and what happened to each font. */
async function subset(flux: Uint8Array, input: string): Promise<Required<Pick<Produced, 'bytes' | 'fonts'>> | Outcome> {
  const done = await subsetFlux(flux, cliSubsetDeps(hasher), hasher);
  return 'error' in done ? io(`cannot subset the fonts of ${input}: ${done.error}`, ['argv']) : done;
}

/** The conversion, with `--subset-fonts` applied to the `.flux` it reads (into a `.flux.html` or a `.flux`) or writes (from either). */
async function produce(bytes: Uint8Array, request: Request): Promise<Produced | Outcome> {
  if (!request.subsetFonts) return produceAs(bytes, request);
  if (request.from === 'flux') {
    const cut = await subset(bytes, request.input);
    if (!('bytes' in cut)) return cut;
    const made = request.to === 'flux' ? { bytes: cut.bytes, files: [] } : await produceAs(cut.bytes, request);
    return 'bytes' in made ? { ...made, fonts: cut.fonts } : made;
  }
  const made = await produceAs(bytes, request);
  if (!('bytes' in made)) return made;
  const cut = await subset(made.bytes, request.input);
  return 'bytes' in cut ? { bytes: cut.bytes, files: [], fonts: cut.fonts } : cut;
}

async function produceAs(bytes: Uint8Array, { input, output, from, to, assets }: Request): Promise<Produced | Outcome> {
  if (to === 'json') return toJson(bytes, input, output, assets);
  if (from === 'json') return fromJson(new TextDecoder().decode(bytes), input);
  if (from === 'flux') {
    const made = await toHtml(bytes, input.replace(/^.*[\\/]/, '').replace(/\.flux$/i, ''), input);
    return 'html' in made ? { bytes: new TextEncoder().encode(made.html), files: [] } : made;
  }
  const found = await readFluxHtml(new TextDecoder().decode(bytes), hasher);
  return found.ok ? { bytes: found.value, files: [] } : io(`cannot convert ${input}: ${found.error.message}`, ['argv']);
}

/** Write the output and its side files. */
async function writeAll(output: string, produced: Produced): Promise<Outcome | undefined> {
  try {
    for (const f of produced.files) {
      const path = join(dirname(output), f.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, f.bytes);
    }
    await writeFile(output, produced.bytes);
  } catch (e) {
    return io(`cannot write ${output}: ${why(e)}`, ['argv']);
  }
  return undefined;
}

type Kind = NonNullable<ReturnType<typeof kindOf>>;

/** The kinds of `input` and `output` when they are a pair `convert` handles, else the usage error. */
function pairOf(input: string, output: string, subsetFonts: boolean): { readonly from: Kind; readonly to: Kind } | Outcome {
  const [from, to] = [kindOf(input), kindOf(output)];
  // one .flux on either side of a .flux.html or a .flux.json (ADR-0155, ADR-0162); a .flux to a .flux only to subset its fonts (ADR-0201)
  const rewrite = subsetFonts && from === 'flux' && to === 'flux';
  if (from === undefined || to === undefined || (from === to && !rewrite) || (from !== 'flux' && to !== 'flux'))
    return usage('convert needs a .flux and a .flux.html or a .flux.json, as <input> <output>');
  if (subsetFonts && to === 'json') return usage('--subset-fonts applies to a .flux or a .flux.html output only');
  return { from, to };
}

/** The log line of one font of `--subset-fonts`. */
const fontLog = (f: FontSubsetLine): string =>
  f.status === 'subset' ? `font ${f.name}: subset, ${f.before} -> ${f.after} bytes\n` : `font ${f.name}: kept whole (${f.reason}): ${f.message}\n`;

/** Converts `input` to `output`. */
async function convert(input: string, output: string, options: Pick<Request, 'assets' | 'subsetFonts'>, log: (text: string) => void): Promise<Outcome> {
  const pair = pairOf(input, output, options.subsetFonts);
  if ('exitCode' in pair) return pair;
  const { from, to } = pair;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(input));
  } catch (e) {
    return io(`cannot read ${input}: ${why(e)}`, ['argv']);
  }
  const produced = await produce(bytes, { input, output, from, to, ...options });
  if (!('bytes' in produced)) return produced;
  const failed = await writeAll(output, produced);
  if (failed) return failed;
  log(`${input} -> ${output}: ${produced.bytes.byteLength} bytes\n`);
  for (const f of produced.fonts ?? []) log(fontLog(f));
  const direction = from === 'json' ? 'from-json' : DIRECTION[to];
  const fonts = produced.fonts === undefined ? {} : { fonts: produced.fonts.map(fontLine) };
  return { exitCode: 0, diagnostics: [], result: { from: input, to: output, direction, bytes: produced.bytes.byteLength, ...fonts } };
}

/** One font's line of the `--json` result (ADR-0201): the report without its record-id branding. */
const fontLine = (f: FontSubsetLine): Record<string, unknown> =>
  f.status === 'subset'
    ? { asset: f.asset, name: f.name, before: f.before, after: f.after, status: f.status }
    : { asset: f.asset, name: f.name, before: f.before, after: f.after, status: f.status, reason: f.reason, message: f.message };

/** The `convert` command. */
export const CONVERT: Command = {
  summary: 'Turn a .flux into a .flux.html or a .flux.json, and back',
  usage: 'convert <input> <output> [--assets inline|external] [--subset-fonts]',
  options: { assets: { type: 'string' }, 'subset-fonts': { type: 'boolean' } },
  run: ({ values, positionals }, out) => {
    const [input, output, ...extra] = positionals;
    if (input === undefined || output === undefined) return usage('convert needs <input> and <output>');
    if (extra.length > 0) return usage(`convert takes two files, got ${positionals.length}`);
    const assets = values['assets'] ?? 'inline';
    if (assets !== 'inline' && assets !== 'external') return usage('--assets is inline or external');
    if (values['assets'] !== undefined && kindOf(output) !== 'json') return usage('--assets applies to a .flux.json output only');
    return convert(input, output, { assets, subsetFonts: values['subset-fonts'] === true }, out.stderr);
  },
};

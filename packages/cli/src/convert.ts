// `fluxion convert <input> <output>` (FR-FIL-003, FR-CLI-001, ADR-0155): a `.flux` becomes a `.flux.html` and a `.flux.html` becomes the `.flux` it
// holds. The archive is moved unchanged, so the round trip is byte-identical. Nothing in the input executes or is trusted: the archive is
// verified by its recorded hash (`readFluxHtml`) or opened by the loader (`loadFlux`) before it is embedded. A `.flux` also becomes a
// `.flux.json` and back (FR-FIL-005, ADR-0162), with `--assets external` writing the assets beside the JSON.

import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ContentHasher, loadFlux, readFluxHtml, readFluxJson, sha256Hex, writeFlux, writeFluxHtml, writeFluxJson } from '@fluxion/format';
import { type Command, internal, io, type Outcome, usage } from './command.js';

const hasher: ContentHasher = { sha256: (bytes) => Promise.resolve(sha256Hex(bytes)) };

/** What a path's name says it is. */
const kindOf = (path: string): 'flux' | 'html' | 'json' | undefined => {
  const name = path.toLowerCase();
  return name.endsWith('.flux.html') ? 'html' : name.endsWith('.flux.json') ? 'json' : name.endsWith('.flux') ? 'flux' : undefined;
};
const DIRECTION = { html: 'to-html', flux: 'to-flux', json: 'to-json' } as const;
const CLI_APP = '0.0.0';

/** The text of the one-file player next to the `@fluxion/player-inline` package's entry (its build output), or undefined when it is not built. */
async function playerScript(): Promise<string | undefined> {
  const entry = import.meta.resolve('@fluxion/player-inline');
  for (const candidate of ['./player.inline.js', '../dist/player.inline.js']) {
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
  const loaded = await loadFlux(flux, { hasher });
  if (!loaded.ok) return io(`cannot convert ${input}: ${loaded.error.message}`, ['argv']);
  const player = await playerScript();
  if (player === undefined) return internal('the one-file player is not built: run the build of @fluxion/player-inline');
  const written = await writeFluxHtml({
    flux,
    playerScript: player,
    title: titleOf(loaded.value.document.records) ?? fallbackTitle,
    generator: 'fluxion convert',
    hasher,
  });
  return written.ok ? { html: written.value } : io(`cannot convert ${input}: ${written.error.reason}`, ['argv']);
}

/** `.flux` bytes → a `.flux.json` text and the asset files to write beside it. */
async function toJson(flux: Uint8Array, input: string, output: string, assets: 'inline' | 'external'): Promise<Produced | Outcome> {
  const loaded = await loadFlux(flux, { hasher });
  if (!loaded.ok) return io(`cannot convert ${input}: ${loaded.error.message}`, ['argv']);
  const { document, source } = loaded.value;
  const name = output.replace(/^.*[\\/]/, '').replace(/\.flux\.json$/i, '');
  const written = await writeFluxJson({
    document,
    assets: loaded.value.assets,
    ...(source === undefined ? {} : { source }),
    appVersion: CLI_APP,
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
  const written = await writeFlux({ document, assets, ...(source === undefined ? {} : { source }), appVersion: CLI_APP, generator: 'fluxion convert', hasher });
  return written.ok ? { bytes: written.value, files: [] } : io(`cannot convert ${input}: ${written.error.reason}`, ['argv']);
}

type Produced = { readonly bytes: Uint8Array; readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[] };

/** The bytes (and side files) `input` converts to. */
type Request = { readonly input: string; readonly output: string; readonly from: string; readonly to: string; readonly assets: 'inline' | 'external' };

async function produce(bytes: Uint8Array, { input, output, from, to, assets }: Request): Promise<Produced | Outcome> {
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

/** Converts `input` to `output`. */
async function convert(input: string, output: string, assets: 'inline' | 'external', log: (text: string) => void): Promise<Outcome> {
  const [from, to] = [kindOf(input), kindOf(output)];
  // one .flux on either side of a .flux.html or a .flux.json (ADR-0155, ADR-0162)
  const pair = from !== undefined && to !== undefined && from !== to && (from === 'flux' || to === 'flux');
  if (!pair) return usage('convert needs a .flux and a .flux.html or a .flux.json, as <input> <output>');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(input));
  } catch (e) {
    return io(`cannot read ${input}: ${why(e)}`, ['argv']);
  }
  const produced = await produce(bytes, { input, output, from, to, assets });
  if (!('bytes' in produced)) return produced;
  const failed = await writeAll(output, produced);
  if (failed) return failed;
  log(`${input} -> ${output}: ${produced.bytes.byteLength} bytes\n`);
  const direction = from === 'json' ? 'from-json' : DIRECTION[to];
  return { exitCode: 0, diagnostics: [], result: { from: input, to: output, direction, bytes: produced.bytes.byteLength } };
}

/** The `convert` command. */
export const CONVERT: Command = {
  summary: 'Turn a .flux into a .flux.html or a .flux.json, and back',
  usage: 'convert <input> <output> [--assets inline|external]',
  options: { assets: { type: 'string' } },
  run: ({ values, positionals }, out) => {
    const [input, output, ...extra] = positionals;
    if (input === undefined || output === undefined) return usage('convert needs <input> and <output>');
    if (extra.length > 0) return usage(`convert takes two files, got ${positionals.length}`);
    const assets = values['assets'] ?? 'inline';
    if (assets !== 'inline' && assets !== 'external') return usage('--assets is inline or external');
    if (values['assets'] !== undefined && kindOf(output) !== 'json') return usage('--assets applies to a .flux.json output only');
    return convert(input, output, assets, out.stderr);
  },
};

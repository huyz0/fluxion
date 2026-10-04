// `fluxion convert <input> <output>` (FR-FIL-003, FR-CLI-001, ADR-0155): a `.flux` becomes a `.flux.html` and a `.flux.html` becomes the `.flux` it
// holds. The archive is moved unchanged, so the round trip is byte-identical. Nothing in the input executes or is trusted: the archive is
// verified by its recorded hash (`readFluxHtml`) or opened by the loader (`loadFlux`) before it is embedded.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { type ContentHasher, loadFlux, readFluxHtml, sha256Hex, writeFluxHtml } from '@fluxion/format';
import { type Command, internal, io, type Outcome, usage } from './command.js';

const hasher: ContentHasher = { sha256: (bytes) => Promise.resolve(sha256Hex(bytes)) };

/** What a path's name says it is. */
const kindOf = (path: string): 'flux' | 'html' | undefined => {
  const name = path.toLowerCase();
  return name.endsWith('.flux.html') ? 'html' : name.endsWith('.flux') ? 'flux' : undefined;
};

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

/** Converts `input` to `output`. */
async function convert(input: string, output: string, log: (text: string) => void): Promise<Outcome> {
  const [from, to] = [kindOf(input), kindOf(output)];
  if (from === undefined || to === undefined || from === to) return usage('convert needs one .flux and one .flux.html, as <input> <output>');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(input));
  } catch (e) {
    return io(`cannot read ${input}: ${why(e)}`, ['argv']);
  }
  let produced: Uint8Array;
  if (from === 'flux') {
    const made = await toHtml(bytes, input.replace(/^.*[\\/]/, '').replace(/\.flux$/i, ''), input);
    if (!('html' in made)) return made;
    produced = new TextEncoder().encode(made.html);
  } else {
    const found = await readFluxHtml(new TextDecoder().decode(bytes), hasher);
    if (!found.ok) return io(`cannot convert ${input}: ${found.error.message}`, ['argv']);
    produced = found.value;
  }
  try {
    await writeFile(output, produced);
  } catch (e) {
    return io(`cannot write ${output}: ${why(e)}`, ['argv']);
  }
  log(`${input} -> ${output}: ${produced.byteLength} bytes\n`);
  return { exitCode: 0, diagnostics: [], result: { from: input, to: output, direction: from === 'flux' ? 'to-html' : 'to-flux', bytes: produced.byteLength } };
}

/** The `convert` command. */
export const CONVERT: Command = {
  summary: 'Turn a .flux into a .flux.html and back',
  usage: 'convert <input> <output>',
  options: {},
  run: ({ positionals }, out) => {
    const [input, output, ...extra] = positionals;
    if (input === undefined || output === undefined) return usage('convert needs <input> and <output>');
    if (extra.length > 0) return usage(`convert takes two files, got ${positionals.length}`);
    return convert(input, output, out.stderr);
  },
};

// The font subset worker thread of `fluxion convert --subset-fonts` (FR-AST-003, ADR-0051, M18.40): started fresh for each font job, it reads
// the pinned engine modules shipped with `@fluxion/format`, instantiates them, answers once and is terminated by the command.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';
import { type FontJobScope, serveFontSubsetJob } from '@fluxion/format';

/** The engine module `file` in the assets of the installed `@fluxion/format`. */
const engine = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(fileURLToPath(new URL(`../assets/font-engine/${file}`, import.meta.resolve('@fluxion/format')))));

/** Node's WebAssembly global; the CLI compiles without the DOM library that types it. */
type Wasm = { instantiate(bytes: Uint8Array, imports: unknown): Promise<{ readonly instance: { readonly exports: unknown } }> };
const wasm = (globalThis as unknown as { readonly WebAssembly: Wasm }).WebAssembly;

if (parentPort !== null) {
  const port = parentPort;
  const scope: FontJobScope = { onmessage: null, postMessage: (message) => port.postMessage(message) };
  port.on('message', (data: unknown) => scope.onmessage?.({ data: data as Parameters<NonNullable<FontJobScope['onmessage']>>[0]['data'] }));
  serveFontSubsetJob(scope, async () => ({ harfbuzz: await engine('harfbuzz-subset.wasm'), codec: await engine('woff2-codec.wasm') }), {
    sha256: (bytes) => Promise.resolve(createHash('sha256').update(bytes).digest('hex')),
    instantiate: async (bytes, imports) => (await wasm.instantiate(bytes, imports)).instance,
  });
}

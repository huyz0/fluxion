// Pinned font engine instantiation (ADR-0051, M18.39): fresh HarfBuzz and WOFF2 codec instances for one font job, from
// module bytes the host loaded and whose hashes are pinned. Pure: the host injects how WebAssembly is instantiated.
import type { FontEngines, HarfBuzzSubsetExports, Woff2CodecExports } from './font-subset.js';

/** SHA-256 of the pinned engine modules (packages/format/assets/font-engine/manifest.json); other bytes are refused. @public */
export const FONT_ENGINE_HASHES = {
  /** `harfbuzz-subset.wasm`. */
  harfbuzz: '62415fe6bad92ef16f3e5d2dbed6c66a4adec7f5a59c6d27084811c92cce1ba5',
  /** `woff2-codec.wasm`. */
  codec: '3829e158c6a14f186b7514dd6bcdf195c5dfd0f9c57e7082e9850e642067cb6f',
} as const;

/** The pinned modules' bytes, as the host loaded them (worker asset fetch, CLI file read). @public */
export type FontEngineModules = {
  /** Bytes of `harfbuzz-subset.wasm`. */
  readonly harfbuzz: Uint8Array;
  /** Bytes of `woff2-codec.wasm`. */
  readonly codec: Uint8Array;
};

/** Host hooks the engines import: none for HarfBuzz; memory-growth notice and exit for the codec. */
class EngineExit extends Error {}
const CODEC_IMPORTS = {
  env: { emscripten_notify_memory_growth: () => undefined },
  wasi_snapshot_preview1: {
    proc_exit: (code: number) => {
      throw new EngineExit(`font codec exited with ${code}`);
    },
  },
};

/** How the host instantiates a module (`WebAssembly.instantiate(bytes, imports)` then its `instance`). @public */
export type WasmInstantiate = (
  bytes: Uint8Array,
  imports: { readonly [module: string]: { readonly [name: string]: unknown } },
) => Promise<{
  /** The instance's exports. */
  readonly exports: unknown;
}>;

/** What instantiation needs from the host. @public */
export type FontEnginePorts = {
  /** Lower-case hex SHA-256. */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
  /** The host's WebAssembly instantiation. */
  readonly instantiate: WasmInstantiate;
};

/**
 * Fresh engine instances from pinned module bytes; bytes whose hash is not pinned are refused, so a user font can
 * never be loaded as a module. Call once per font job and drop the result afterwards.
 * @public
 */
export async function instantiateFontEngines(modules: FontEngineModules, ports: FontEnginePorts): Promise<FontEngines> {
  const [hb, codec] = await Promise.all([ports.sha256(modules.harfbuzz), ports.sha256(modules.codec)]);
  if (hb !== FONT_ENGINE_HASHES.harfbuzz || codec !== FONT_ENGINE_HASHES.codec) throw new Error('font engine modules do not match the pinned hashes');
  const [harfbuzz, woff2] = await Promise.all([ports.instantiate(modules.harfbuzz.slice(), {}), ports.instantiate(modules.codec.slice(), CODEC_IMPORTS)]);
  // both are WASI reactors: their constructors run once, before any other call
  const hbExports = harfbuzz.exports as unknown as HarfBuzzSubsetExports & { _initialize(): void };
  const codecExports = woff2.exports as unknown as Woff2CodecExports & { _initialize(): void };
  hbExports._initialize();
  codecExports._initialize();
  return { harfbuzz: hbExports, codec: codecExports, identity: { harfbuzz: hb, codec } };
}

// The font subset worker (FR-AST-003, ADR-0051, M18.40): the module the studio starts with `new Worker` for each font job of a subset-on-save.
// It fetches the pinned engine modules the build serves, instantiates them fresh, answers once and is terminated by the page. Bundled by Vite
// as its own chunk, so the player and saved files never carry it.
import { serveFontSubsetJob } from '@fluxion/format';
import { FONT_ENGINE_URLS } from './font-engine-urls.js';

const bytesOf = async (url: string): Promise<Uint8Array> => new Uint8Array(await (await fetch(url)).arrayBuffer());
const hex = (digest: ArrayBuffer): string => Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');

serveFontSubsetJob(
  self as unknown as Parameters<typeof serveFontSubsetJob>[0],
  async () => ({ harfbuzz: await bytesOf(FONT_ENGINE_URLS.harfbuzz), codec: await bytesOf(FONT_ENGINE_URLS.codec) }),
  {
    sha256: async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)),
    instantiate: async (bytes, imports) => (await WebAssembly.instantiate(bytes as BufferSource, imports as WebAssembly.Imports)).instance,
  },
);

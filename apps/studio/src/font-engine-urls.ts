// Where the build serves the pinned font engine modules (M18.48, M18.40); the font worker checks their hashes before it runs them. Its own
// module so the worker chunk carries nothing else.

const url = (glob: Record<string, string>): string => Object.values(glob)[0] ?? '';

/** The URLs of `harfbuzz-subset.wasm` and `woff2-codec.wasm`. */
export const FONT_ENGINE_URLS: { readonly harfbuzz: string; readonly codec: string } = {
  harfbuzz: url(import.meta.glob('../../../packages/format/assets/font-engine/harfbuzz-subset.wasm', { query: '?url', import: 'default', eager: true })),
  codec: url(import.meta.glob('../../../packages/format/assets/font-engine/woff2-codec.wasm', { query: '?url', import: 'default', eager: true })),
};

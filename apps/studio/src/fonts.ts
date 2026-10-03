// The bundled fonts in the studio (FR-THM-008, ADR-0022): the faces of packs/fonts-core registered, their files served by the
// studio's build (Vite emits each woff2 and gives its URL), and loaded into the page so text drawn in Inter, Source Serif 4 or
// JetBrains Mono is drawn with the real face and measured with it.

import { type LoadableFace, loadFontFaces } from '@fluxion/editor';
import { FONTS_CORE } from '@fluxion/pack-fonts-core';

// the files of the pack, by path under it (`fonts/<file>.woff2`): a glob, because a bundler only follows URLs it can see
declare global {
  interface ImportMeta {
    glob(pattern: string, options: { readonly query: '?url'; readonly import: 'default'; readonly eager: true }): Record<string, string>;
  }
}

const FILES = import.meta.glob('../../../packs/fonts-core/fonts/*.woff2', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** The URL the studio serves a bundled face's file at, or undefined for a file the build does not have. */
export function bundledFontUrl(file: string): string | undefined {
  return FILES[`../../../packs/fonts-core/${file}`];
}

/** The bundled faces with their URLs. */
export function bundledFaces(): readonly LoadableFace[] {
  return FONTS_CORE.flatMap((face) => {
    const url = bundledFontUrl(face.file ?? '');
    return url === undefined ? [] : [{ family: face.family, weight: face.weight, style: face.style, url }];
  });
}

let loading: Promise<void> | undefined;

/** Load the bundled faces into the page, once per page (a document opened later reuses them); a face that fails to load is left out, not fatal. */
export function loadBundledFonts(): Promise<void> {
  loading ??= Promise.allSettled(bundledFaces().map((face) => loadFontFaces([face]))).then(() => undefined);
  return loading;
}

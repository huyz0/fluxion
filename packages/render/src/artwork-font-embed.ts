// Exact artwork fonts in a static page (ADR-0192, M18.116): where no `FontFace` exists (a server rendering HTML), saved packs are
// registered with their verified bytes, and the page carries each byte identity once as an `@font-face` under its private alias, its
// bytes inline. Missing or changed bytes refuse the packs before any effect, so no text is drawn in another face.

import type { ShapePackLicensePolicy } from '@fluxion/core';
import {
  type ArtworkFontBinding,
  artworkFontRequirements,
  checkVersionedShapePackSubsets,
  createRegistry,
  type Disposable,
  type Registry,
  registerVersionedShapePackSubsets,
  type ShapeDef,
  type VersionedShapePackSubset,
} from '@fluxion/core';
import { type Diagnostic, err, ok, type Result } from '@fluxion/schema';
import { type ArtworkFontBytes, refusal } from './artwork-font-registration.js';

/**
 * One exact font a static page embeds: verified bytes under their private alias.
 *
 * @public
 */
export type EmbeddedArtworkFont = {
  /** The private family, `fx-artwork-<sha256>`. */
  readonly alias: string;
  /** Static weight. */
  readonly weight: number;
  /** Static style. */
  readonly style: 'normal' | 'italic';
  /** The exact verified bytes (WOFF2). */
  readonly bytes: Uint8Array;
};

/**
 * Saved packs registered for a static page, and the exact fonts it must embed.
 *
 * @public
 */
export type EmbeddedShapePacks = Disposable & {
  /** One per byte identity, sorted by hash; pass to `renderDocumentToHtml` as `artworkFonts`. */
  readonly fonts: readonly EmbeddedArtworkFont[];
  /** The alias bindings by definition id, for the render registries (`builtinRegistries`). */
  readonly artworkFonts: Registry<string, readonly ArtworkFontBinding[]>;
};

/**
 * What embedding saved shape packs needs from its host.
 *
 * @public
 */
export type EmbedShapePackPorts = {
  /** The bytes of a byte identity (a loader's verified assets by hash), or undefined. */
  readonly bytesOf: (sha256: string) => Uint8Array | undefined;
  /** The content license policy the subsets are validated under. */
  readonly policy: ShapePackLicensePolicy;
  /** Lowercase SHA-256 hex of bytes. */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
};

const problem = (message: string): Diagnostic => ({ code: 'FLX_PACK_INVALID', severity: 'error', path: '/shapePacks', message });

/**
 * Register saved 1.0 and 1.1 packs for a static page: checked (parse, rights, free namespaces), then every bound font's bytes from
 * `bytesOf` present with their exact size and SHA-256, then geometry into `shapeDefs` and bindings into a new `artworkFonts`
 * registry. Any refusal leaves no definition behind. The bytes returned are copies made before the first await.
 *
 * @public
 */
export async function embedSavedShapePacks(
  shapeDefs: Registry<string, ShapeDef>,
  packs: readonly VersionedShapePackSubset[],
  ports: EmbedShapePackPorts,
): Promise<Result<EmbeddedShapePacks, readonly Diagnostic[]>> {
  const checked = checkVersionedShapePackSubsets(shapeDefs, packs, ports.policy);
  if (!checked.ok) return checked;
  const fonts: ArtworkFontBytes[] = artworkFontRequirements(checked.value).map((font) => ({ ...font, bytes: ports.bytesOf(font.sha256)?.slice() }));
  const refused: string[] = [];
  for (const font of fonts) {
    const reason = await refusal(font, font.bytes, ports.sha256);
    if (reason !== undefined) refused.push(reason);
  }
  if (refused.length) return err(refused.map(problem));
  const artworkFonts = createRegistry<string, readonly ArtworkFontBinding[]>('artworkFonts');
  const shapes = registerVersionedShapePackSubsets({ shapeDefs, artworkFonts }, checked.value, ports.policy, new Set(fonts.map((f) => f.sha256)));
  if (!shapes.ok) return shapes;
  return ok({
    fonts: fonts.map(({ alias, weight, style, bytes }) => ({ alias, weight, style, bytes: bytes as Uint8Array })),
    artworkFonts,
    dispose: () => shapes.value.dispose(),
  });
}

/** `bytes` as base64, in chunks small enough for `String.fromCharCode`. */
function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The `@font-face` rules of `fonts`, generated from their alias, descriptors and bytes only (never caller CSS): an alias outside the
 * reserved namespace, or any other character that could leave the rule, is refused by throwing.
 *
 * @internal
 */
export function artworkFontFaceCss(fonts: readonly EmbeddedArtworkFont[]): string {
  return fonts
    .map(({ alias, weight, style, bytes }) => {
      if (!/^fx-artwork-[0-9a-f]{64}$/.test(alias) || !Number.isInteger(weight) || !['normal', 'italic'].includes(style))
        throw new Error('not an artwork font');
      return `@font-face { font-family: "${alias}"; src: url(data:font/woff2;base64,${base64(bytes)}) format("woff2"); font-weight: ${weight}; font-style: ${style}; font-display: block; }`;
    })
    .join('\n');
}
